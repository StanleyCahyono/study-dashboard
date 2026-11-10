"""Owner enrollment, passphrase login, and revocable server-side sessions.

* Password hashing uses pwdlib (Argon2id), a maintained hashing library.
* Session tokens are 256-bit random values; only their SHA-256 is stored, so a
  copied database cannot be replayed as a cookie.
* Enrollment needs a single-use bootstrap code that only a host-side command
  (`studyctl enroll`) can create. There is no public sign-up.
* User identity is never taken from client-supplied headers (no proxy identity
  headers, no X-Forwarded-For).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from pwdlib import PasswordHash
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .models import AuthSession, BootstrapCode, Owner
from .timeutil import Clock

BOOTSTRAP_TTL = timedelta(minutes=10)
BOOTSTRAP_MAX_FAILURES = 5
SESSION_ABSOLUTE_TTL = timedelta(days=30)
SESSION_IDLE_TTL = timedelta(days=14)
LAST_SEEN_WRITE_INTERVAL = timedelta(minutes=1)
MIN_PASSPHRASE_LEN = 12
FREE_FAILURES = 5
MAX_LOCK = timedelta(hours=1)

_hasher = PasswordHash.recommended()
# Pre-computed hash used to keep timing similar when no owner exists yet.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class AuthError(Exception):
    def __init__(self, code: str, message: str, status: int = 401, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retry_after = retry_after


def get_owner(db: Session) -> Owner | None:
    return db.execute(select(Owner).where(Owner.id == 1)).scalar_one_or_none()


def is_enrolled(db: Session) -> bool:
    owner = get_owner(db)
    return owner is not None and owner.password_hash is not None


# --- host-only bootstrap -----------------------------------------------------

def issue_bootstrap_code(db: Session, clock: Clock, *, reset: bool = False) -> tuple[str, datetime]:
    """Create a single-use enrollment code. Called only from the host CLI.

    With reset=True this is the owner-recovery path: the passphrase is cleared
    and every session is revoked before a new code is issued. Data is kept.
    """
    now = clock()
    owner = get_owner(db)
    if owner is not None and owner.password_hash is not None and not reset:
        raise AuthError(
            "already_enrolled",
            "An owner is already enrolled. Use `studyctl enroll --reset` to recover access.",
            status=409,
        )
    if reset and owner is not None:
        owner.password_hash = None
        owner.failed_logins = 0
        owner.locked_until = None
        revoke_all_sessions(db, clock, reason="owner_reset")
    # Invalidate any earlier unused codes.
    db.execute(update(BootstrapCode).where(BootstrapCode.used_at.is_(None)).values(used_at=now))
    code = secrets.token_urlsafe(18)  # 144 bits
    expires = now + BOOTSTRAP_TTL
    db.add(BootstrapCode(code_hash=sha256_hex(code), created_at=now, expires_at=expires))
    db.commit()
    return code, expires


def validate_passphrase(passphrase: str) -> None:
    if len(passphrase) < MIN_PASSPHRASE_LEN:
        raise AuthError("weak_passphrase", f"Use at least {MIN_PASSPHRASE_LEN} characters.", status=400)
    if len(passphrase) > 1024:
        raise AuthError("weak_passphrase", "Passphrase is too long.", status=400)


def enroll_owner(db: Session, clock: Clock, code: str, passphrase: str) -> None:
    now = clock()
    validate_passphrase(passphrase)
    if is_enrolled(db):
        raise AuthError("already_enrolled", "Owner already enrolled.", status=409)
    candidates = db.execute(
        select(BootstrapCode).where(BootstrapCode.used_at.is_(None), BootstrapCode.expires_at > now)
    ).scalars().all()
    # Only one live code exists at a time; compare in constant time.
    match = None
    for row in candidates:
        if hmac.compare_digest(row.code_hash, sha256_hex(code)):
            match = row
    if match is None:
        for row in candidates:
            row.failed_attempts += 1
            if row.failed_attempts >= BOOTSTRAP_MAX_FAILURES:
                row.used_at = now  # burn the code after repeated guesses
        db.commit()
        raise AuthError("invalid_code", "That enrollment code is invalid or expired.", status=401)
    # Atomic single-use claim.
    claimed = db.execute(
        update(BootstrapCode)
        .where(BootstrapCode.id == match.id, BootstrapCode.used_at.is_(None))
        .values(used_at=now)
    ).rowcount
    if claimed != 1:
        db.rollback()
        raise AuthError("invalid_code", "That enrollment code was already used.", status=401)
    owner = get_owner(db)
    if owner is None:
        owner = Owner(id=1, created_at=now, failed_logins=0)
        db.add(owner)
    owner.password_hash = _hasher.hash(passphrase)
    owner.password_changed_at = now
    owner.failed_logins = 0
    owner.locked_until = None
    db.commit()


# --- login throttling -------------------------------------------------------

def _lock_duration(failures: int) -> timedelta:
    if failures < FREE_FAILURES:
        return timedelta(0)
    return min(timedelta(minutes=2 ** (failures - FREE_FAILURES)), MAX_LOCK)


def check_passphrase(db: Session, clock: Clock, passphrase: str) -> None:
    """Verify the owner passphrase with persistent, exponential lockout.

    All requests arrive from loopback (directly or through Tailscale Serve), so
    throttling is per account rather than per client address.
    """
    now = clock()
    owner = get_owner(db)
    if owner is None or owner.password_hash is None:
        _hasher.verify(passphrase, _DUMMY_HASH)
        raise AuthError("not_enrolled", "No owner is enrolled yet. Run `studyctl enroll` on the host.", status=401)
    if owner.locked_until is not None and owner.locked_until > now:
        wait = int((owner.locked_until - now).total_seconds()) + 1
        raise AuthError("locked", "Too many attempts. Try again later.", status=429, retry_after=wait)
    valid, new_hash = _hasher.verify_and_update(passphrase, owner.password_hash)
    if not valid:
        owner.failed_logins += 1
        lock = _lock_duration(owner.failed_logins)
        owner.locked_until = now + lock if lock else None
        db.commit()
        raise AuthError("bad_credentials", "Incorrect passphrase.", status=401)
    if new_hash:
        owner.password_hash = new_hash
    owner.failed_logins = 0
    owner.locked_until = None
    db.commit()


# --- sessions ---------------------------------------------------------------

@dataclass
class NewSession:
    token: str
    row: AuthSession


def create_session(db: Session, clock: Clock, device_label: str) -> NewSession:
    now = clock()
    token = secrets.token_urlsafe(32)
    row = AuthSession(
        public_id=secrets.token_hex(8),
        token_hash=sha256_hex(token),
        csrf_token=secrets.token_urlsafe(32),
        device_label=(device_label or "Unknown device")[:80],
        created_at=now,
        last_seen_at=now,
        expires_at=now + SESSION_ABSOLUTE_TTL,
    )
    db.add(row)
    db.commit()
    return NewSession(token=token, row=row)


def resolve_session(db: Session, clock: Clock, token: str | None) -> AuthSession | None:
    if not token or len(token) > 200:
        return None
    now = clock()
    row = db.execute(select(AuthSession).where(AuthSession.token_hash == sha256_hex(token))).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    if row.expires_at <= now or row.last_seen_at + SESSION_IDLE_TTL <= now:
        row.revoked_at = now
        row.revoked_reason = "expired"
        db.commit()
        return None
    if now - row.last_seen_at >= LAST_SEEN_WRITE_INTERVAL:
        row.last_seen_at = now
        db.commit()
    return row


def revoke_session(db: Session, clock: Clock, public_id: str, reason: str) -> bool:
    row = db.execute(select(AuthSession).where(AuthSession.public_id == public_id)).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = clock()
    row.revoked_reason = reason
    db.commit()
    return True


def revoke_all_sessions(db: Session, clock: Clock, reason: str) -> int:
    now = clock()
    count = db.execute(
        update(AuthSession).where(AuthSession.revoked_at.is_(None)).values(revoked_at=now, revoked_reason=reason)
    ).rowcount
    db.commit()
    return count


def active_sessions(db: Session, clock: Clock) -> list[AuthSession]:
    now = clock()
    rows = db.execute(
        select(AuthSession).where(AuthSession.revoked_at.is_(None)).order_by(AuthSession.last_seen_at.desc())
    ).scalars().all()
    return [r for r in rows if r.expires_at > now and r.last_seen_at + SESSION_IDLE_TTL > now]


def device_label_from_user_agent(ua: str | None) -> str:
    ua = ua or ""
    if "iPhone" in ua:
        device = "iPhone"
    elif "iPad" in ua:
        device = "iPad"
    elif "Android" in ua:
        device = "Android"
    elif "Windows" in ua:
        device = "Windows"
    elif "Macintosh" in ua:
        device = "Mac"
    elif "Linux" in ua:
        device = "Linux"
    else:
        device = "Unknown device"
    if "Edg/" in ua:
        browser = "Edge"
    elif "CriOS" in ua or "Chrome/" in ua:
        browser = "Chrome"
    elif "FxiOS" in ua or "Firefox/" in ua:
        browser = "Firefox"
    elif "Safari/" in ua:
        browser = "Safari"
    else:
        browser = ""
    return f"{device} {browser}".strip()
