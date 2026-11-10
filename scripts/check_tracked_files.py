"""Fail if anything that looks like private data is tracked or staged in Git.

Run: uv run python scripts/check_tracked_files.py
Also runs from the pre-push hook and the test suite.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_SUFFIXES = {
    ".sqlite", ".sqlite3", ".db", ".db-wal", ".db-shm", ".sdbk", ".mbox", ".pem", ".key", ".p12", ".pfx",
}
# Synthetic .eml/.ics fixtures are allowed only under these directories.
FIXTURE_DIRS = ("backend/tests/fixtures/", "web/e2e/fixtures/")
FIXTURE_ONLY_SUFFIXES = {".eml", ".ics"}

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}")
ALLOWED_EMAIL_DOMAINS = re.compile(
    r"(@(example\.(com|org|net|edu)|[a-z0-9-]+\.example|users\.noreply\.github\.com)|^git@github\.com)$", re.I
)
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "Google access token": re.compile(r"\bya29\.[0-9A-Za-z_-]{20,}"),
    "Google refresh token": re.compile(r"\b1//0[0-9A-Za-z_-]{20,}"),
    "Google OAuth client secret": re.compile(r"\bGOCSPX-[0-9A-Za-z_-]{10,}"),
    "GitHub token": re.compile(r"\b(ghp|gho|ghu|ghs|github_pat)_[0-9A-Za-z_]{20,}"),
    "API key (sk-)": re.compile(r"\bsk-[A-Za-z0-9-]{20,}"),
    "AWS key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "Canvas token": re.compile(r"\b\d{4,5}~[A-Za-z0-9]{40,}"),
}
SKIP_CONTENT = {"package-lock.json", "uv.lock"}


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout
    return [p for p in out.decode().split("\0") if p]


def scan(paths: list[str]) -> list[str]:
    problems: list[str] = []
    for rel in paths:
        path = ROOT / rel
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in FORBIDDEN_SUFFIXES:
            problems.append(f"{rel}: forbidden file type {suffix}")
            continue
        if suffix in FIXTURE_ONLY_SUFFIXES and not rel.startswith(FIXTURE_DIRS):
            problems.append(f"{rel}: {suffix} files are only allowed under {', '.join(FIXTURE_DIRS)}")
        data = path.read_bytes()
        if data.startswith(b"SQLite format 3"):
            problems.append(f"{rel}: SQLite database content")
            continue
        if path.name in SKIP_CONTENT or b"\0" in data[:4096]:
            continue
        text = data.decode("utf-8", errors="replace")
        for m in EMAIL.finditer(text):
            if not ALLOWED_EMAIL_DOMAINS.search(m.group(0)):
                problems.append(f"{rel}: real-looking email address (use @example.com in code and docs)")
                break
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                problems.append(f"{rel}: possible {label}")
    return problems


def main() -> int:
    problems = scan(tracked_files())
    if problems:
        print("Private-data check FAILED:")
        for p in problems:
            print("  - " + p)
        return 1
    print("Private-data check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
