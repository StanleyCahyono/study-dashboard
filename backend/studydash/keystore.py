"""Host key store access.

* "os":   the OS credential store through `keyring` (Windows Credential
          Manager, macOS Keychain, Secret Service on a Linux desktop).
* "file": a JSON file readable only by the service account, for a headless
          Linux server that has no OS credential store. It lives in the
          per-user config directory, separate from the data directory.
The in-memory store exists only for automated tests and refuses to run otherwise.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import stat
import sys
from pathlib import Path
from typing import Protocol

SERVICE = "StudyDashboard"


class KeyStoreUnavailable(RuntimeError):
    pass


class KeyStore(Protocol):
    def get(self, name: str) -> str | None: ...
    def set(self, name: str, value: str) -> None: ...


class OSKeyStore:
    def __init__(self, profile: str):
        import keyring
        from keyring.backends import fail

        backend = keyring.get_keyring()
        if isinstance(backend, fail.Keyring) or "fail" in type(backend).__module__:
            raise KeyStoreUnavailable(
                "No OS key store is available. On Windows this is Credential Manager; "
                "it must be reachable from the account that runs the app."
            )
        self._keyring = keyring
        self._service = f"{SERVICE}/{profile}"

    def get(self, name: str) -> str | None:
        return self._keyring.get_password(self._service, name)

    def set(self, name: str, value: str) -> None:
        self._keyring.set_password(self._service, name, value)


class FileKeyStore:
    """Owner-only key file for headless servers (mode 0600 in a 0700 directory)."""

    def __init__(self, profile: str, directory: Path | None = None):
        if sys.platform == "win32":
            raise KeyStoreUnavailable("Use the OS key store (Credential Manager) on Windows.")
        if directory is None:
            from platformdirs import user_config_dir

            directory = Path(user_config_dir("StudyDashboard", appauthor=False)) / "keys"
        self.directory = directory
        self.path = directory / f"{profile}.json"
        directory.mkdir(parents=True, exist_ok=True)
        os.chmod(directory, 0o700)
        if self.path.exists():
            mode = stat.S_IMODE(self.path.stat().st_mode)
            if mode & 0o077:
                raise KeyStoreUnavailable(
                    f"{self.path} is readable by other users (mode {oct(mode)}). Run: chmod 600 {self.path}"
                )

    def _read(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def get(self, name: str) -> str | None:
        return self._read().get(name)

    def set(self, name: str, value: str) -> None:
        data = self._read()
        data[name] = value
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, self.path)


def open_keystore(profile: str, kind: str) -> KeyStore:
    if kind == "file":
        return FileKeyStore(profile)
    if kind == "os":
        return OSKeyStore(profile)
    raise KeyStoreUnavailable(f"Unknown key store '{kind}' (use 'os' or 'file').")


class MemoryKeyStore:
    """Test-only store. Never used for a running server."""

    def __init__(self):
        if os.environ.get("STUDYDASH_TESTING") != "1":
            raise KeyStoreUnavailable("MemoryKeyStore is only allowed in tests.")
        self._data: dict[str, str] = {}

    def get(self, name: str) -> str | None:
        return self._data.get(name)

    def set(self, name: str, value: str) -> None:
        self._data[name] = value


BACKUP_KEY_NAME = "backup-key-v1"


def get_or_create_backup_key(store: KeyStore) -> bytes:
    value = store.get(BACKUP_KEY_NAME)
    if value is None:
        value = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
        store.set(BACKUP_KEY_NAME, value)
    return base64.b64decode(value)


def format_recovery_key(key: bytes) -> str:
    text = base64.b32encode(key).decode("ascii").rstrip("=")
    return "-".join(text[i : i + 4] for i in range(0, len(text), 4))


def parse_recovery_key(text: str) -> bytes:
    cleaned = "".join(ch for ch in text.upper() if ch.isalnum())
    cleaned += "=" * (-len(cleaned) % 8)
    key = base64.b32decode(cleaned)
    if len(key) != 32:
        raise ValueError("Recovery key has the wrong length.")
    return key
