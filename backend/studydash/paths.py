"""Where private data lives.

Personal configuration and data are stored outside the source checkout, in a
per-user application-data directory:

* Windows: %LOCALAPPDATA%\\StudyDashboard
* macOS:   ~/Library/Application Support/StudyDashboard
* Linux:   ~/.local/share/StudyDashboard

Each profile ("real" or "demo") has its own directory and its own SQLite file.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from platformdirs import user_data_dir

APP_NAME = "StudyDashboard"
DB_FILENAME = "studydash.sqlite3"


class Profile(str, Enum):
    REAL = "real"
    DEMO = "demo"


DEFAULT_PORTS = {Profile.REAL: 8765, Profile.DEMO: 8766}

# The source checkout (repository root). Private data must never live under it.
REPO_ROOT = Path(__file__).resolve().parents[2]


class UnsafeDataLocation(RuntimeError):
    pass


def default_data_root() -> Path:
    override = os.environ.get("STUDYDASH_DATA_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    return Path(user_data_dir(APP_NAME, appauthor=False, roaming=False)).resolve()


def _inside_git_worktree(path: Path) -> Path | None:
    for candidate in [path, *path.parents]:
        if (candidate / ".git").exists():
            return candidate
    return None


def assert_safe_data_root(root: Path) -> None:
    """Refuse a data directory inside this checkout or any other Git work tree."""
    root = root.resolve()
    if root == REPO_ROOT or REPO_ROOT in root.parents:
        raise UnsafeDataLocation(
            f"Data directory {root} is inside the source checkout {REPO_ROOT}. "
            "Private data must live outside the repository."
        )
    worktree = _inside_git_worktree(root)
    if worktree is not None:
        raise UnsafeDataLocation(
            f"Data directory {root} is inside the Git work tree {worktree}. "
            "Choose a location outside any repository."
        )


@dataclass(frozen=True)
class ProfilePaths:
    profile: Profile
    root: Path

    @property
    def dir(self) -> Path:
        return self.root / self.profile.value

    @property
    def db(self) -> Path:
        return self.dir / DB_FILENAME

    @property
    def config(self) -> Path:
        return self.dir / "config.json"

    @property
    def backups(self) -> Path:
        return self.dir / "backups"

    def ensure(self) -> "ProfilePaths":
        assert_safe_data_root(self.root)
        self.dir.mkdir(parents=True, exist_ok=True)
        return self


def profile_paths(profile: Profile, root: Path | None = None) -> ProfilePaths:
    return ProfilePaths(profile=profile, root=(root or default_data_root()))
