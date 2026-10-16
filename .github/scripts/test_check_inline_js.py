"""Small self-tests for the PR's read-only JavaScript parser gate."""
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


GATE = Path(__file__).with_name("check_inline_js.py")


class InlineJavascriptGateTests(unittest.TestCase):
    def check_html(self, html):
        with TemporaryDirectory() as tmp:
            source = Path(tmp) / "index.html"
            source.write_text(html, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(GATE), str(source)],
                capture_output=True,
                text=True,
            )

    def test_valid_classic_and_module_scripts(self):
        result = self.check_html(
            '<!doctype html><script>const a = 1;</script>'
            '<script type="module">export const b = 2;</script>'
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Checked 2 inline scripts", result.stdout)

    def test_invalid_javascript_fails(self):
        result = self.check_html('<script>function broken( {</script>')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("syntax error", result.stdout)

    def test_classic_script_rejects_top_level_return(self):
        result = self.check_html('<script>return;</script>')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("syntax error", result.stdout)

    def test_unterminated_last_script_fails_even_if_previous_is_valid(self):
        result = self.check_html(
            '<html><script>const ok = 1;</script>'
            '<script type="module">const unfinished = 2;'
            '</body></html>'
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unterminated", result.stderr)

    def test_empty_or_non_executable_scripts_do_not_pass(self):
        result = self.check_html('<script type="application/json">{}</script>')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no executable", result.stderr)


if __name__ == "__main__":
    unittest.main()
