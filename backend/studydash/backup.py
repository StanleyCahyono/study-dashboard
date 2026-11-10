"""Encrypted portable backups (XChaCha20-Poly1305 via libsodium / PyNaCl).

The key is generated once and kept in the OS key store. `studyctl backup
recovery-key` shows it so the owner can store it separately (for example on
paper), which is needed to restore on a new computer.

File layout: MAGIC | 4-byte header length | header JSON | 24-byte nonce | ciphertext.
The header is authenticated as associated data.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import tempfile
from pathlib import Path

from nacl.bindings import (
    crypto_aead_xchacha20poly1305_ietf_decrypt,
    crypto_aead_xchacha20poly1305_ietf_encrypt,
    crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
)
from nacl.exceptions import CryptoError

from .paths import Profile, ProfilePaths
from .timeutil import Clock, iso

MAGIC = b"SDBK\x01"
NONCE_LEN = crypto_aead_xchacha20poly1305_ietf_NPUBBYTES  # 24


class BackupError(RuntimeError):
    pass


def _snapshot(db_path: Path) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "snapshot.sqlite3"
        src = sqlite3.connect(db_path)
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        return target.read_bytes()


def create_backup(paths: ProfilePaths, key: bytes, clock: Clock, out: Path | None = None) -> Path:
    if not paths.db.exists():
        raise BackupError("No database to back up yet.")
    plaintext = _snapshot(paths.db)
    header = json.dumps(
        {"format": 1, "profile": paths.profile.value, "created_at": iso(clock()), "cipher": "XChaCha20-Poly1305"},
        separators=(",", ":"),
    ).encode()
    nonce = secrets.token_bytes(NONCE_LEN)
    ciphertext = crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, MAGIC + header, nonce, key)
    if out is None:
        paths.backups.mkdir(parents=True, exist_ok=True)
        stamp = clock().strftime("%Y%m%dT%H%M%SZ")
        out = paths.backups / f"studydash-{paths.profile.value}-{stamp}.sdbk"
    out.write_bytes(MAGIC + len(header).to_bytes(4, "big") + header + nonce + ciphertext)
    return out


def read_backup(file: Path, key: bytes) -> tuple[dict, bytes]:
    blob = file.read_bytes()
    if not blob.startswith(MAGIC):
        raise BackupError("Not a Study Dashboard backup file.")
    pos = len(MAGIC)
    hlen = int.from_bytes(blob[pos : pos + 4], "big")
    pos += 4
    header_bytes = blob[pos : pos + hlen]
    pos += hlen
    nonce, ciphertext = blob[pos : pos + NONCE_LEN], blob[pos + NONCE_LEN :]
    try:
        plaintext = crypto_aead_xchacha20poly1305_ietf_decrypt(ciphertext, MAGIC + header_bytes, nonce, key)
    except CryptoError as exc:
        raise BackupError("Wrong key or the backup is damaged.") from exc
    return json.loads(header_bytes), plaintext


def restore_backup(file: Path, key: bytes, target: ProfilePaths) -> None:
    header, plaintext = read_backup(file, key)
    if header.get("profile") != target.profile.value:
        raise BackupError(
            f"Backup is from the '{header.get('profile')}' profile; refusing to restore into '{target.profile.value}'."
        )
    target.ensure()
    if target.db.exists():
        raise BackupError(f"{target.db} already exists. Restore only into an empty profile.")
    tmp = target.db.with_suffix(".restoring")
    tmp.write_bytes(plaintext)
    conn = sqlite3.connect(tmp)
    ok = False
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise BackupError("Restored database failed its integrity check.")
        row = conn.execute("SELECT value FROM profile_meta WHERE key='profile'").fetchone()
        if row is None or row[0] != target.profile.value:
            raise BackupError("Restored database has the wrong profile marker.")
        ok = True
    finally:
        conn.close()
        if not ok:
            tmp.unlink(missing_ok=True)
    os.replace(tmp, target.db)


__all__ = ["BackupError", "create_backup", "read_backup", "restore_backup", "Profile"]
