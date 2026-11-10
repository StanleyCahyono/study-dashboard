"""Host key store access.

Real deployments use the OS credential store through `keyring` (Windows
Credential Manager, macOS Keychain, Secret Service on Linux). The in-memory
store exists only for automated tests and refuses to run otherwise.
"""

from __future__ import annotations

import base64
import os
import secrets
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
