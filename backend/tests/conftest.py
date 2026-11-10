import os
from datetime import datetime, timezone

import pytest

os.environ["STUDYDASH_TESTING"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from studydash import auth  # noqa: E402
from studydash.app import create_app  # noqa: E402
from studydash.paths import Profile, profile_paths  # noqa: E402

PASSPHRASE = "correct horse battery staple"


class FakeClock:
    def __init__(self, now: datetime):
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock():
    # A Monday at 08:00 New York time (EST).
    return FakeClock(datetime(2026, 11, 9, 13, 0, tzinfo=timezone.utc))


@pytest.fixture
def data_root(tmp_path):
    return tmp_path / "appdata"


def make_client(profile, data_root, clock, frontend_dist=None):
    paths = profile_paths(profile, data_root)
    app = create_app(profile, paths, clock=clock, frontend_dist=frontend_dist, extra_hosts=["testserver"])
    client = TestClient(app, base_url="https://testserver")
    client.headers.update({"origin": "https://testserver", "x-studydash": "1"})
    return app, client


@pytest.fixture
def make(data_root, clock):
    def _make(profile=Profile.REAL, frontend_dist=None):
        return make_client(profile, data_root, clock, frontend_dist)

    return _make


def enroll(app, client, passphrase=PASSPHRASE):
    with app.state.sd.db.session() as s:
        code, _ = auth.issue_bootstrap_code(s, app.state.sd.clock)
    r = client.post("/api/auth/enroll", json={"code": code, "passphrase": passphrase})
    assert r.status_code == 200, r.text
    csrf = r.json()["csrf_token"]
    client.headers["x-csrf-token"] = csrf
    return csrf
