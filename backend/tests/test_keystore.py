import os
import stat
import sys

import pytest

from studydash.keystore import FileKeyStore, KeyStoreUnavailable, get_or_create_backup_key, open_keystore

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="file key store is for Linux servers")


def test_file_keystore_is_owner_only_and_persistent(tmp_path):
    store = FileKeyStore("real", tmp_path / "keys")
    key = get_or_create_backup_key(store)
    assert len(key) == 32
    assert stat.S_IMODE((tmp_path / "keys").stat().st_mode) == 0o700
    assert stat.S_IMODE((tmp_path / "keys" / "real.json").stat().st_mode) == 0o600
    assert get_or_create_backup_key(FileKeyStore("real", tmp_path / "keys")) == key
    assert get_or_create_backup_key(FileKeyStore("demo", tmp_path / "keys")) != key


def test_file_keystore_refuses_loose_permissions(tmp_path):
    store = FileKeyStore("real", tmp_path / "keys")
    store.set("x", "y")
    os.chmod(tmp_path / "keys" / "real.json", 0o644)
    with pytest.raises(KeyStoreUnavailable):
        FileKeyStore("real", tmp_path / "keys")


def test_unknown_keystore_kind():
    with pytest.raises(KeyStoreUnavailable):
        open_keystore("real", "cloud")
