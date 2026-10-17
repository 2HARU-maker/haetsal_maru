#!/usr/bin/env python3
"""Fail-closed GitHub PR gate for an official Codex review of the exact head SHA.

Uses the existing official Codex bot summary comment format. This is a
conservative integration: if the bot format or GitHub API changes, the gate
must fail closed rather than claim the PR was reviewed.

Never checks out or executes untrusted PR application code. It reads only
GitHub's issue-comments REST endpoint with a read-only GITHUB_TOKEN.
"""
import json
import os
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

BOT_LOGIN = "chatgpt-codex-connector[bot]"
BOT_ID = 199175422  # Official GitHub App bot identity verified in PR #48.
SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->"
STATE_PATTERN = re.compile(r"<!-- codex-review-state:v1 (\{[^\r\n]*\}) -->")
REPO_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$")
SHA_PATTERN = re.compile(r"^[a-f0-9]{40}$")
WAIT_SECONDS = 24 * 60
INTERVAL_SECONDS = 24
MAX_PAGES = 20


class ReviewEvidenceError(Exception):
    """Untrusted, incomplete or inconsistent review evidence."""


def is_official_bot(comment):
    actor = comment.get("user") or {}
    return (
        actor.get("login") == BOT_LOGIN
        and actor.get("id") == BOT_ID
        and actor.get("type") == "Bot"
    )


def extract_summary(comments):
    summaries = [
        c.get("body", "") for c in comments
        if is_official_bot(c) and SUMMARY_MARKER in (c.get("body") or "")
    ]
    if not summaries:
        return None
    if len(summaries) != 1:
        raise ReviewEvidenceError("Ambiguous official Codex summary comments")
    matched = STATE_PATTERN.search(summaries[0])
    if not matched:
        raise ReviewEvidenceError("Official Codex summary schema missing or changed")
    try:
        state = json.loads(matched.group(1))
    except json.JSONDecodeError as exc:
        raise ReviewEvidenceError("Official Codex summary JSON invalid") from exc
    if not isinstance(state, dict):
        raise ReviewEvidenceError("Official Codex summary is not an object")
    return state


def evaluate(comments, head_sha):
    """Return (PASS|WAIT|FAIL, safe explanation)."""
    if not SHA_PATTERN.fullmatch(head_sha):
        return "FAIL", "Expected head commit SHA is malformed"
    try:
        summary = extract_summary(comments)
    except ReviewEvidenceError as exc:
        return "FAIL", str(exc)
    if summary is None:
        return "WAIT", "Official Codex summary has not appeared yet"
    review = summary.get("code_review")
    if not isinstance(review, dict):
        return "FAIL", "Code review result is absent or malformed"
    if review.get("commit_sha") != head_sha:
        return "WAIT", "Codex result is not yet for the current PR head"
    state = review.get("status")
    if state in {"running", "queued", "pending"}:
        return "WAIT", "Codex review of this SHA is still running"
    if state != "completed":
        return "FAIL", "Code review did not complete successfully"
    if review.get("has_any_findings") is not False:
        return "FAIL", "Codex found issues or result is incomplete"
    if review.get("has_unresolved_findings") is not False:
        return "FAIL", "Codex has unresolved issues or result is incomplete"

    security = summary.get("security_review")
    if security is not None:
        if not isinstance(security, dict):
            return "FAIL", "Security review metadata is malformed"
        sec_status = security.get("status")
        if sec_status in {"running", "queued", "pending"}:
            return "WAIT", "Security review is still running"
        if sec_status is None:
            if any(value is not None for value in security.values()):
                return "FAIL", "Security review has inconsistent metadata"
        else:
            if security.get("commit_sha") != head_sha:
                return "WAIT", "Security review is not yet for the current PR head"
            if sec_status != "completed":
                return "FAIL", "Security review did not complete successfully"
            if security.get("has_any_findings") is not False or security.get("has_unresolved_findings") is not False:
                return "FAIL", "Security review found issues or result is incomplete"
    return "PASS", "Official Codex review completed cleanly for the exact PR head"


def fetch_comments(repo, number, token):
    owner, name = repo.split("/", 1)
    all_comments = []
    for page in range(1, MAX_PAGES + 1):
        url = (
            f"https://api.github.com/repos/{quote(owner)}/{quote(name)}/issues/{number}/comments"
            f"?per_page=100&page={page}"
        )
        request = Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "haetsalmaru-codex-review-gate",
        })
        with urlopen(request, timeout=25) as response:
            block = json.load(response)
        if not isinstance(block, list):
            raise ReviewEvidenceError("Unexpected GitHub issue comments response")
        all_comments.extend(block)
        if len(block) < 100:
            return all_comments
    raise ReviewEvidenceError("Comment pagination exceeded safe bound")


def main():
    repo = os.getenv("GITHUB_REPOSITORY", "")
    number = os.getenv("PR_NUMBER", "")
    sha = os.getenv("PR_HEAD_SHA", "")
    token = os.getenv("GH_REVIEW_READ_TOKEN", "")
    if not REPO_PATTERN.fullmatch(repo) or not number.isdecimal() or int(number) < 1 or not SHA_PATTERN.fullmatch(sha) or not token:
        print("FAIL: invalid or missing GitHub review gate inputs", file=sys.stderr)
        return 1

    deadline = time.monotonic() + WAIT_SECONDS
    last_state = None
    while True:
        try:
            comments = fetch_comments(repo, int(number), token)
            state, reason = evaluate(comments, sha)
        except (HTTPError, URLError, TimeoutError, ValueError, ReviewEvidenceError) as exc:
            print(f"FAIL: Codex evidence could not be verified ({type(exc).__name__})", file=sys.stderr)
            return 1
        if (state, reason) != last_state:
            print(f"{state}: {reason}", flush=True)
            last_state = (state, reason)
        if state == "PASS":
            return 0
        if state == "FAIL":
            return 1
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            print("FAIL: Codex review did not finish for this PR head within the time limit", file=sys.stderr)
            return 1
        time.sleep(min(INTERVAL_SECONDS, remaining))


if __name__ == "__main__":
    raise SystemExit(main())
