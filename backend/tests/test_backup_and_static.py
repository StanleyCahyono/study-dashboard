import secrets

import pytest
from conftest import enroll

from studydash import backup
from studydash.db import Database
from studydash.keystore import MemoryKeyStore, format_recovery_key, get_or_create_backup_key, parse_recovery_key
from studydash.paths import Profile, profile_paths


def test_encrypted_backup_roundtrip_into_fresh_profile(make, clock, tmp_path):
    app, client = make(Profile.DEMO)
    enroll(app, client)
    store = MemoryKeyStore()
    key = get_or_create_backup_key(store)
    out = backup.create_backup(app.state.sd.paths, key, clock, tmp_path / "b.sdbk")
    blob = out.read_bytes()
    assert b"SQLite format 3" not in blob and b"[Demo]" not in blob

    fresh = profile_paths(Profile.DEMO, tmp_path / "fresh-root")
    restored_key = parse_recovery_key(format_recovery_key(key))
    backup.restore_backup(out, restored_key, fresh)
    db = Database(fresh)
    from studydash.models import Course

    with db.session() as s:
        assert s.query(Course).count() == 3

    with pytest.raises(backup.BackupError):
        backup.restore_backup(out, secrets.token_bytes(32), profile_paths(Profile.DEMO, tmp_path / "other"))
    with pytest.raises(backup.BackupError):  # profile mismatch
        backup.restore_backup(out, key, profile_paths(Profile.REAL, tmp_path / "other2"))
    with pytest.raises(backup.BackupError):  # refuses to overwrite
        backup.restore_backup(out, key, fresh)


def test_memory_keystore_only_in_tests(monkeypatch):
    from studydash.keystore import KeyStoreUnavailable

    monkeypatch.setenv("STUDYDASH_TESTING", "0")
    with pytest.raises(KeyStoreUnavailable):
        MemoryKeyStore()


def test_static_shell_cacheable_api_not(make, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>shell</title>")
    (dist / "assets" / "app-abc.js").write_text("console.log(1)")
    (dist / "sw.js").write_text("//sw")
    app, client = make(Profile.REAL, frontend_dist=dist)
    assert client.get("/").headers["cache-control"] == "no-cache"
    assert "immutable" in client.get("/assets/app-abc.js").headers["cache-control"]
    assert client.get("/some/deep/link").text.startswith("<!doctype html>")
    assert client.get("/api/today").headers["cache-control"] == "no-store"
    assert client.get("/api/nope").status_code == 404
    assert client.get("/../pyproject.toml").text.startswith("<!doctype html>")
