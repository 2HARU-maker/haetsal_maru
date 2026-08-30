"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { scrypt, timingSafeEqual, randomBytes, createHash } = require("node:crypto");
const { promisify } = require("node:util");

initializeApp();
const db = getFirestore();
const derive = promisify(scrypt);
const PARAMETERS = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 });
const DUMMY_SALT = randomBytes(16);
const DUMMY_VERIFIER = randomBytes(PARAMETERS.keyLength);
const WINDOW_MS = 5 * 60 * 1000;
const LOCK_MS = 60 * 1000;
const FAILURE_LIMIT = 5;

function credentialFailure() {
  return new HttpsError("permission-denied", "Credential verification failed.");
}

function limited() {
  return new HttpsError("resource-exhausted", "Verification temporarily unavailable.");
}

function decodeFixedBase64(value, bytes) {
  if (typeof value !== "string" || value.length !== 4 * Math.ceil(bytes / 3)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === bytes && decoded.toString("base64") === value ? decoded : null;
}

function usableVerifier(data, userId) {
  if (!data || data.userId !== userId || data.verifierVersion !== 1 ||
      data.algorithm !== "scrypt-v1" || data.schemaVersion !== 1 || data.disabled !== false) return null;
  const params = data.parameters;
  if (!params || Object.keys(params).length !== Object.keys(PARAMETERS).length ||
      !Object.keys(PARAMETERS).every((key) => params[key] === PARAMETERS[key])) return null;
  const salt = decodeFixedBase64(data.salt, 16);
  const verifier = decodeFixedBase64(data.passwordVerifier, PARAMETERS.keyLength);
  return salt && verifier ? { salt, verifier } : null;
}

function millis(value) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

exports.verifyOrderUserPassword = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, concurrency: 1, maxInstances: 10 },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const data = request.data;
    if (!data || typeof data.userId !== "string" || !data.userId.length ||
        data.userId.length > 128 || data.userId.includes("/") ||
        data.userId === "." || data.userId === ".." || /^__.*__$/.test(data.userId) ||
        typeof data.password !== "string" ||
        typeof data.requestId !== "string" || !data.requestId.length || data.requestId.length > 128 ||
        !Number.isSafeInteger(data.appBuildNumber) || data.verifierProtocolVersion !== 1) {
      throw new HttpsError("invalid-argument", "Invalid verification request.");
    }

    const { userId, password, requestId } = data;
    const compoundKeyHash = createHash("sha256")
      .update(JSON.stringify([request.auth.uid, userId])).digest("hex");
    const rateRef = db.collection("haetsalUserCredentialRateLimits").doc(compoundKeyHash);
    try {
      const before = await rateRef.get();
      if (millis(before.data()?.lockUntil) > Date.now()) throw limited();

      const snapshot = await db.collection("haetsalUserCredentialVerifiers").doc(userId).get();
      const verifier = usableVerifier(snapshot.data(), userId);
      // Missing, disabled and malformed records take the same fixed-cost KDF path.
      const derived = await derive(password, verifier ? verifier.salt : DUMMY_SALT,
        PARAMETERS.keyLength, PARAMETERS);
      const matches = timingSafeEqual(derived, verifier ? verifier.verifier : DUMMY_VERIFIER);
      const verified = Boolean(verifier) && matches;
      derived.fill(0);

      // Serialize result accounting and recheck the lock after the expensive KDF.
      // No failed update is swallowed, and success resets only this uid/user pair.
      const outcome = await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(rateRef)).data() || {};
        const now = Date.now();
        if (millis(current.lockUntil) > now) return "limited";
        const previousStart = millis(current.windowStartedAt);
        const inWindow = previousStart > 0 && now - previousStart < WINDOW_MS;
        const previousCount = Number.isSafeInteger(current.failedCount) && current.failedCount >= 0
          ? current.failedCount : 0;
        const failedCount = verified ? 0 : (inWindow ? previousCount : 0) + 1;
        transaction.set(rateRef, {
          compoundKeyHash,
          failedCount,
          windowStartedAt: Timestamp.fromMillis(verified || !inWindow ? now : previousStart),
          lastAttemptAt: Timestamp.fromMillis(now),
          lockUntil: Timestamp.fromMillis(!verified && failedCount >= FAILURE_LIMIT ? now + LOCK_MS : 0),
          schemaVersion: 1
        });
        return verified ? "verified" : "failed";
      });
      if (outcome === "limited") throw limited();
      if (outcome !== "verified") throw credentialFailure();
      return { verified: true, requestId, verifierProtocolVersion: 1 };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      // Do not log request data or propagate SDK errors containing request context.
      throw new HttpsError("unavailable", "Verification temporarily unavailable.");
    }
  }
);
