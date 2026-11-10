"""SQLite engine (WAL mode), migrations, and the profile marker."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.types import String, TypeDecorator

from .paths import Profile, ProfilePaths

MIGRATIONS_DIR = Path(__file__).with_name("migrations")


class UTCDateTime(TypeDecorator):
    """Stores aware datetimes as ISO-8601 UTC text; rejects naive values."""

    impl = String(40)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise ValueError("UTCDateTime requires a timezone-aware datetime")
        return value.astimezone(timezone.utc).isoformat()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return datetime.fromisoformat(value).astimezone(timezone.utc)


class ProfileMismatch(RuntimeError):
    pass


def make_engine(db_path: Path) -> Engine:
    engine = create_engine(f"sqlite:///{db_path}", future=True)

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

    return engine


def alembic_config(db_path: Path) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return cfg


def migrate(db_path: Path) -> None:
    command.upgrade(alembic_config(db_path), "head")


def check_or_set_profile_marker(session: Session, profile: Profile) -> None:
    """Bind a database file to one profile so demo and real can never mix."""
    from .models import ProfileMeta

    row = session.execute(select(ProfileMeta).where(ProfileMeta.key == "profile")).scalar_one_or_none()
    if row is None:
        session.add(ProfileMeta(key="profile", value=profile.value))
        session.commit()
    elif row.value != profile.value:
        raise ProfileMismatch(
            f"Database belongs to the '{row.value}' profile but was opened as '{profile.value}'."
        )


class Database:
    def __init__(self, paths: ProfilePaths):
        self.paths = paths.ensure()
        migrate(self.paths.db)
        self.engine = make_engine(self.paths.db)
        self.sessionmaker = sessionmaker(self.engine, expire_on_commit=False, future=True)
        with self.sessionmaker() as s:
            check_or_set_profile_marker(s, paths.profile)

    def session(self) -> Session:
        return self.sessionmaker()

    def journal_mode(self) -> str:
        with self.engine.connect() as conn:
            return conn.execute(text("PRAGMA journal_mode")).scalar_one()

    def dispose(self) -> None:
        self.engine.dispose()
