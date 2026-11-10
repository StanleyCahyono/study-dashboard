from datetime import timedelta

from conftest import PASSPHRASE, enroll

from studydash import auth
from studydash.paths import Profile

PRIVATE_ENDPOINTS = [
    ("get", "/api/today"),
    ("get", "/api/auth/session"),
    ("get", "/api/auth/devices"),
    ("post", "/api/auth/logout"),
    ("post", "/api/auth/devices/abc/revoke"),
]


def test_unauthenticated_private_calls_fail(make):
    app, client = make()
    for method, path in PRIVATE_ENDPOINTS:
        r = getattr(client, method)(path)
        assert r.status_code == 401, (path, r.status_code)
        assert r.headers["cache-control"] == "no-store"


def test_public_status_reveals_no_private_data(make):
    app, client = make()
    r = client.get("/api/public/status")
    assert r.json() == {"profile": "real", "enrolled": False}


def test_no_public_signup_without_bootstrap_code(make):
    app, client = make()
    r = client.post("/api/auth/enroll", json={"code": "guess", "passphrase": PASSPHRASE})
    assert r.status_code == 401
    r = client.post("/api/auth/login", json={"passphrase": PASSPHRASE})
    assert r.status_code == 401


def test_enroll_then_read(make):
    app, client = make()
    enroll(app, client)
    r = client.get("/api/today")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    cookie = r.request.headers.get("cookie", "")
    assert "__Host-sd_real=" in cookie


def test_cookie_flags(make):
    app, client = make()
    with app.state.sd.db.session() as s:
        code, _ = auth.issue_bootstrap_code(s, app.state.sd.clock)
    r = client.post("/api/auth/enroll", json={"code": code, "passphrase": PASSPHRASE})
    set_cookie = r.headers["set-cookie"].lower()
    for flag in ["httponly", "secure", "samesite=strict", "path=/"]:
        assert flag in set_cookie
    assert "domain=" not in set_cookie


def test_bootstrap_code_single_use_and_expiry(make, clock):
    app, client = make()
    with app.state.sd.db.session() as s:
        code, _ = auth.issue_bootstrap_code(s, clock)
    clock.now += auth.BOOTSTRAP_TTL + timedelta(seconds=1)
    r = client.post("/api/auth/enroll", json={"code": code, "passphrase": PASSPHRASE})
    assert r.status_code == 401
    clock.now -= auth.BOOTSTRAP_TTL + timedelta(seconds=1)
    with app.state.sd.db.session() as s:
        code, _ = auth.issue_bootstrap_code(s, clock)
    assert client.post("/api/auth/enroll", json={"code": code, "passphrase": PASSPHRASE}).status_code == 200
    # Second use fails (and enrollment is closed).
    assert client.post("/api/auth/enroll", json={"code": code, "passphrase": PASSPHRASE}).status_code in (401, 409)


def test_bootstrap_code_burns_after_guesses(make, clock):
    app, client = make()
    with app.state.sd.db.session() as s:
        code, _ = auth.issue_bootstrap_code(s, clock)
    for _ in range(auth.BOOTSTRAP_MAX_FAILURES):
        client.post("/api/auth/enroll", json={"code": "wrong", "passphrase": PASSPHRASE})
    assert client.post("/api/auth/enroll", json={"code": code, "passphrase": PASSPHRASE}).status_code == 401


def test_csrf_required_for_unsafe_methods(make):
    app, client = make()
    enroll(app, client)
    del client.headers["x-csrf-token"]
    assert client.post("/api/auth/logout").status_code == 403
    client.headers["x-csrf-token"] = "wrong"
    assert client.post("/api/auth/logout").status_code == 403


def test_cross_origin_post_rejected(make):
    app, client = make()
    enroll(app, client)
    r = client.post("/api/auth/logout", headers={"origin": "https://evil.example"})
    assert r.status_code == 403
    r = client.post("/api/auth/login", json={"passphrase": PASSPHRASE}, headers={"x-studydash": "0"})
    assert r.status_code == 403


def test_untrusted_host_rejected(make):
    app, client = make()
    r = client.get("/api/public/status", headers={"host": "attacker.example"})
    assert r.status_code == 400


def test_client_identity_headers_ignored(make):
    app, client = make()
    enroll(app, client)
    client.cookies.clear()
    r = client.get(
        "/api/today",
        headers={"tailscale-user-login": "owner@example.com", "x-forwarded-user": "owner", "x-forwarded-for": "127.0.0.1"},
    )
    assert r.status_code == 401


def test_login_throttling(make, clock):
    app, client = make()
    enroll(app, client)
    for _ in range(auth.FREE_FAILURES):
        assert client.post("/api/auth/login", json={"passphrase": "nope nope nope"}).status_code == 401
    r = client.post("/api/auth/login", json={"passphrase": PASSPHRASE})
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) > 0
    clock.now += timedelta(minutes=2)
    assert client.post("/api/auth/login", json={"passphrase": PASSPHRASE}).status_code == 200


def test_logout_and_revocation(make):
    app, client = make()
    enroll(app, client)
    # Second device signs in.
    from fastapi.testclient import TestClient

    phone = TestClient(app, base_url="https://testserver")
    phone.headers.update({"origin": "https://testserver", "x-studydash": "1", "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1"})
    r = phone.post("/api/auth/login", json={"passphrase": PASSPHRASE})
    assert r.status_code == 200
    assert phone.get("/api/today").status_code == 200
    devices = client.get("/api/auth/devices").json()["devices"]
    assert len(devices) == 2
    other = next(d for d in devices if not d["current"])
    assert other["device_label"] == "iPhone Safari"
    assert client.post(f"/api/auth/devices/{other['session_id']}/revoke").status_code == 200
    assert phone.get("/api/today").status_code == 401
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/today").status_code == 401


def test_owner_reset_revokes_sessions_keeps_enrollment_closed_until_new_code(make, clock):
    app, client = make()
    enroll(app, client)
    with app.state.sd.db.session() as s:
        code, _ = auth.issue_bootstrap_code(s, clock, reset=True)
    assert client.get("/api/today").status_code == 401
    assert client.post("/api/auth/login", json={"passphrase": PASSPHRASE}).status_code == 401
    new = "a brand new passphrase"
    assert client.post("/api/auth/enroll", json={"code": code, "passphrase": new}).status_code == 200


def test_session_idle_expiry(make, clock):
    app, client = make()
    enroll(app, client)
    clock.now += auth.SESSION_IDLE_TTL + timedelta(minutes=1)
    assert client.get("/api/today").status_code == 401


def test_weak_passphrase_rejected(make, clock):
    app, client = make()
    with app.state.sd.db.session() as s:
        code, _ = auth.issue_bootstrap_code(s, clock)
    r = client.post("/api/auth/enroll", json={"code": code, "passphrase": "short"})
    assert r.status_code == 400


def test_database_stores_only_token_hashes(make):
    app, client = make()
    enroll(app, client)
    token = client.cookies.get("__Host-sd_real")
    raw = app.state.sd.paths.db.read_bytes()
    wal = app.state.sd.paths.db.with_name(app.state.sd.paths.db.name + "-wal")
    blob = raw + (wal.read_bytes() if wal.exists() else b"")
    assert token and token.encode() not in blob


def test_security_headers(make):
    app, client = make()
    r = client.get("/api/public/status")
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_profiles_use_separate_cookies(make):
    app, client = make(Profile.DEMO)
    enroll(app, client)
    assert client.cookies.get("__Host-sd_demo")
    assert client.cookies.get("__Host-sd_real") is None
