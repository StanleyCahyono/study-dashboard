"""The per-device key for the encrypted offline copy."""

from conftest import PASSPHRASE, enroll
from fastapi.testclient import TestClient


def _phone(app):
    phone = TestClient(app, base_url="https://testserver")
    phone.headers.update({"origin": "https://testserver", "x-studydash": "1"})
    r = phone.post("/api/auth/login", json={"passphrase": PASSPHRASE})
    assert r.status_code == 200
    phone.headers["x-csrf-token"] = r.json()["csrf_token"]
    return phone, r.json()


def test_login_returns_a_per_session_key(make):
    app, client = make()
    enroll(app, client)
    phone, body = _phone(app)
    key = body["snapshot_key"]
    assert len(key) == 43  # 32 bytes, base64url without padding
    assert phone.get("/api/auth/session").json()["snapshot_key"] == key
    assert client.get("/api/auth/session").json()["snapshot_key"] != key


def test_key_requires_a_session(make):
    app, client = make()
    assert client.get("/api/auth/session").status_code == 401


def test_revoked_device_loses_key(make):
    app, client = make()
    enroll(app, client)
    phone, body = _phone(app)
    sid = phone.get("/api/auth/session").json()["session_id"]
    assert client.post(f"/api/auth/devices/{sid}/revoke").status_code == 200
    assert phone.get("/api/auth/session").status_code == 401
    with app.state.sd.db.session() as s:
        from studydash.models import AuthSession

        row = s.query(AuthSession).filter_by(public_id=sid).one()
        assert row.snapshot_key is None


def test_logout_and_reset_destroy_keys(make, clock):
    from studydash import auth
    from studydash.models import AuthSession

    app, client = make()
    enroll(app, client)
    _phone(app)
    assert client.post("/api/auth/logout").status_code == 200
    with app.state.sd.db.session() as s:
        auth.issue_bootstrap_code(s, clock, reset=True)
        assert all(r.snapshot_key is None for r in s.query(AuthSession).all())
