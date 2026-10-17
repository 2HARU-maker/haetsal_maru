#!/usr/bin/env python3
"""Validate syntax of executable inline scripts in a static HTML app.

This checks parsing only. It does not execute Firebase, browser handlers, or UI flows.
"""
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = None
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag != "script":
            return
        # HTML keeps the first occurrence of a duplicate attribute.
        attrs = dict(reversed(attrs))
        if attrs.get("src") is not None:
            self.active = None
            return
        kind = (attrs.get("type") or "text/javascript").strip().lower()
        # WHATWG MIMESNIFF: JavaScript MIME type essence matches.
        javascript_types = {
            "application/ecmascript", "application/javascript",
            "application/x-ecmascript", "application/x-javascript",
            "text/ecmascript", "text/javascript",
            "text/javascript1.0", "text/javascript1.1",
            "text/javascript1.2", "text/javascript1.3",
            "text/javascript1.4", "text/javascript1.5",
            "text/jscript", "text/livescript",
            "text/x-ecmascript", "text/x-javascript",
        }
        if kind == "module" or kind in javascript_types:
            self.active = [kind, []]
        else:
            self.active = None

    def handle_data(self, data):
        if self.active is not None:
            self.active[1].append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.active is not None:
            kind, sections = self.active
            self.scripts.append((kind, "".join(sections)))
            self.active = None


def main():
    if len(sys.argv) != 2:
        print("Usage: check_inline_js.py index.html", file=sys.stderr)
        return 2
    html_file = Path(sys.argv[1])
    parser = InlineScripts()
    parser.feed(html_file.read_text(encoding="utf-8"))
    parser.close()
    if parser.active is not None:
        print("FAIL: unterminated executable inline <script> tag", file=sys.stderr)
        return 1
    if not parser.scripts:
        print("FAIL: no executable inline JavaScript found", file=sys.stderr)
        return 1

    errors = 0
    with TemporaryDirectory() as tmp:
        for index, (kind, source) in enumerate(parser.scripts, start=1):
            extension = ".mjs" if kind == "module" else ".js"
            path = Path(tmp) / f"inline_{index}{extension}"
            path.write_text(source, encoding="utf-8")
            if kind == "module":
                command = ["node", "--check", str(path)]
            else:
                # A classic browser <script> uses the Script grammar goal.
                # Node's `--check file.js` treats CommonJS as a function body
                # and would incorrectly allow top-level `return` statements.
                command = [
                    "node", "-e",
                    'const fs = require("node:fs"); const vm = require("node:vm"); '
                    'new vm.Script(fs.readFileSync(process.argv[1], "utf8"), '
                    '{ filename: process.argv[1] });',
                    str(path),
                ]
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode:
                errors += 1
                print(f"FAIL: inline script {index} ({kind}) has a syntax error")
                print(result.stderr.rstrip())
    print(f"Checked {len(parser.scripts)} inline scripts; syntax failures: {errors}")
    print("NOTE: Browser, Firestore, Emulator, and regression tests are NOT performed.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
