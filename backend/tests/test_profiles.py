import sqlite3

import pytest
from conftest import enroll

from studydash.db import Database, ProfileMismatch
from studydash.demo import NotDemoProfile, seed_demo
from studydash.paths import Profile, UnsafeDataLocation, assert_safe_data_root, profile_paths, REPO_ROOT


def _counts(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ["course", "course_meeting", "task"]}
    finally:
        conn.close()


def test_real_profile_opens_empty_even_after_demo_runs(make):
    demo_app, demo_client = make(Profile.DEMO)
    real_app, real_client = make(Profile.REAL)
    assert _counts(demo_app.state.sd.paths.db)["course"] == 3
    assert _counts(real_app.state.sd.paths.db) == {"course": 0, "course_meeting": 0, "task": 0}
    assert demo_app.state.sd.paths.db != real_app.state.sd.paths.db

    enroll(real_app, real_client)
    today = real_client.get("/api/today").json()
    assert today["profile"] == "real"
    assert today["next_class"] is None and today["next_task"] is None
    assert today["sync"]["state"] == "no_sources"
    assert "Demo" not in str(today)


def test_seed_refuses_real_profile(make):
    app, _ = make(Profile.REAL)
    with app.state.sd.db.session() as s, pytest.raises(NotDemoProfile):
        seed_demo(s, Profile.REAL, app.state.sd.clock)


def test_profile_marker_prevents_mixing(data_root):
    demo = profile_paths(Profile.DEMO, data_root)
    Database(demo).dispose()
    real = profile_paths(Profile.REAL, data_root).ensure()
    real.db.write_bytes(demo.db.read_bytes())  # someone copies the demo file over
    with pytest.raises(ProfileMismatch):
        Database(real)


def test_wal_mode(make):
    app, _ = make()
    assert app.state.sd.db.journal_mode() == "wal"


def test_data_root_cannot_be_inside_checkout():
    with pytest.raises(UnsafeDataLocation):
        assert_safe_data_root(REPO_ROOT / "data")


def test_data_root_cannot_be_inside_other_git_tree(tmp_path):
    (tmp_path / "repo" / ".git").mkdir(parents=True)
    with pytest.raises(UnsafeDataLocation):
        assert_safe_data_root(tmp_path / "repo" / "appdata")


def test_demo_today_has_labeled_synthetic_data(make):
    app, client = make(Profile.DEMO)
    enroll(app, client)
    today = client.get("/api/today").json()
    assert today["profile"] == "demo"
    assert today["sync"]["state"] == "demo"
    assert today["next_class"]["course_code"] in {"AEM 1101", "AEM 2200", "ECON 1120"}
    assert today["next_task"]["title"].startswith("[Demo]")
    assert today["overdue_count"] == 1
