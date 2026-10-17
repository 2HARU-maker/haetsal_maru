"""Isolated tests for official Codex review evidence and fail-closed decisions."""
import unittest
from check_codex_review import BOT_ID, BOT_LOGIN, SUMMARY_MARKER, ReviewEvidenceError, evaluate, fetch_comments
from unittest import mock
import json

SHA = "a" * 40
OLD = "b" * 40


def bot_comment(head=SHA, status="completed", findings=False, unresolved=False,
                security=None, actor=None, malformed=False):
    body = {"code_review": {
        "commit_sha": head, "status": status,
        "has_any_findings": findings, "has_unresolved_findings": unresolved,
    }, "security_review": security}
    state = "{broken-json" if malformed else json.dumps(body)
    return {"user": actor or {"login": BOT_LOGIN, "id": BOT_ID, "type": "Bot"},
            "body": SUMMARY_MARKER + "\n<!-- codex-review-state:v1 " + state + " -->"}


class GateTests(unittest.TestCase):
    def test_clean_current_head_passes(self):
        self.assertEqual(evaluate([bot_comment()], SHA)[0], "PASS")

    def test_no_summary_waits(self):
        self.assertEqual(evaluate([], SHA)[0], "WAIT")

    def test_old_sha_waits(self):
        self.assertEqual(evaluate([bot_comment(head=OLD)], SHA)[0], "WAIT")

    def test_running_and_queued_wait(self):
        for status in ("running", "queued", "pending"):
            with self.subTest(status=status):
                self.assertEqual(evaluate([bot_comment(status=status, findings=None, unresolved=None)], SHA)[0], "WAIT")

    def test_finding_blocks_even_if_review_marked_completed(self):
        self.assertEqual(evaluate([bot_comment(findings=True)], SHA)[0], "FAIL")
        self.assertEqual(evaluate([bot_comment(unresolved=True)], SHA)[0], "FAIL")

    def test_unknown_findings_or_abnormal_status_blocks(self):
        self.assertEqual(evaluate([bot_comment(findings=None)], SHA)[0], "FAIL")
        self.assertEqual(evaluate([bot_comment(unresolved=None)], SHA)[0], "FAIL")
        self.assertEqual(evaluate([bot_comment(status="failed")], SHA)[0], "FAIL")

    def test_user_impersonation_does_not_count(self):
        fake = {"login": "2HARU-maker", "id": 276949176, "type": "User"}
        self.assertEqual(evaluate([bot_comment(actor=fake)], SHA)[0], "WAIT")
        fake_same_name = {"login": BOT_LOGIN, "id": 12345, "type": "Bot"}
        self.assertEqual(evaluate([bot_comment(actor=fake_same_name)], SHA)[0], "WAIT")

    def test_two_bot_summaries_fail_closed(self):
        self.assertEqual(evaluate([bot_comment(), bot_comment()], SHA)[0], "FAIL")

    def test_malformed_schema_fail_closed(self):
        self.assertEqual(evaluate([bot_comment(malformed=True)], SHA)[0], "FAIL")

    def test_security_in_progress_waits(self):
        sec = {"status": "running", "commit_sha": SHA,
               "has_any_findings": None, "has_unresolved_findings": None}
        self.assertEqual(evaluate([bot_comment(security=sec)], SHA)[0], "WAIT")

    def test_null_security_status_with_inconsistent_metadata_fails(self):
        sec = {"status": None, "commit_sha": SHA,
               "has_any_findings": None, "has_unresolved_findings": None}
        self.assertEqual(evaluate([bot_comment(security=sec)], SHA)[0], "FAIL")

    def test_security_finding_fails(self):
        sec = {"status": "completed", "commit_sha": SHA,
               "has_any_findings": True, "has_unresolved_findings": True}
        self.assertEqual(evaluate([bot_comment(security=sec)], SHA)[0], "FAIL")

    def test_security_completed_clean_passes(self):
        sec = {"status": "completed", "commit_sha": SHA,
               "has_any_findings": False, "has_unresolved_findings": False}
        self.assertEqual(evaluate([bot_comment(security=sec)], SHA)[0], "PASS")

    def test_wrong_security_sha_waits(self):
        sec = {"status": "completed", "commit_sha": OLD,
               "has_any_findings": False, "has_unresolved_findings": False}
        self.assertEqual(evaluate([bot_comment(security=sec)], SHA)[0], "WAIT")

    def test_invalid_sha_fails(self):
        self.assertEqual(evaluate([bot_comment()], "short")[0], "FAIL")

    def test_failed_fetch_not_interpreted_as_approved(self):
        with mock.patch("check_codex_review.urlopen", side_effect=OSError("offline")):
            with self.assertRaises(OSError):
                fetch_comments("example/repo", 48, "dummy-token")

    def test_multiple_pages_are_collected(self):
        class FakeResponse:
            def __init__(self, data):
                self.data = data
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return None
        responses = iter([FakeResponse([{"body": ""}] * 100), FakeResponse([bot_comment()])])
        with mock.patch("check_codex_review.urlopen", side_effect=lambda *_a, **_k: next(responses)):
            with mock.patch("check_codex_review.json.load", side_effect=lambda r: r.data):
                comments = fetch_comments("example/repo", 48, "dummy-token")
        self.assertEqual(len(comments), 101)
        self.assertEqual(evaluate(comments, SHA)[0], "PASS")

    def test_nonbot_comments_cannot_override_official_evidence(self):
        fake = bot_comment(actor={"login": "not-codex", "id": 1, "type": "User"})
        bot = bot_comment(findings=True)
        self.assertEqual(evaluate([fake, bot], SHA)[0], "FAIL")


if __name__ == "__main__":
    unittest.main()
