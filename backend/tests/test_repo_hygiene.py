import importlib.util
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_tracked_files", ROOT / "scripts" / "check_tracked_files.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


@pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
def test_repository_contains_no_private_data():
    assert checker.scan(checker.tracked_files()) == []


def test_checker_catches_planted_sentinels(tmp_path, monkeypatch):
    monkeypatch.setattr(checker, "ROOT", tmp_path)
    at = "@"  # assembled at runtime so this file itself passes the scan
    (tmp_path / "a.txt").write_text(f"contact someone{at}gmail.test.org and person{at}school.edu")
    (tmp_path / "b.sqlite3").write_bytes(b"SQLite format 3\0")
    (tmp_path / "c.txt").write_text("token ya29." + "a" * 30)
    (tmp_path / "d.ics").write_text("BEGIN:VCALENDAR")
    (tmp_path / "e.txt").write_text("demo@example.com is fine")
    problems = checker.scan(["a.txt", "b.sqlite3", "c.txt", "d.ics", "e.txt"])
    joined = "\n".join(problems)
    assert "a.txt" in joined and "b.sqlite3" in joined and "c.txt" in joined and "d.ics" in joined
    assert "e.txt" not in joined
