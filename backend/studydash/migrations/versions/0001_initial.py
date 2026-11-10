"""Phase 1: profile marker, owner auth, sessions, courses, meetings, tasks.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-10
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

TS = sa.String(40)


def upgrade() -> None:
    op.create_table(
        "profile_meta",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.String(255), nullable=False),
    )
    op.create_table(
        "owner",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("password_changed_at", TS, nullable=True),
        sa.Column("failed_logins", sa.Integer, nullable=False, server_default="0"),
        sa.Column("locked_until", TS, nullable=True),
    )
    op.create_table(
        "bootstrap_code",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("used_at", TS, nullable=True),
        sa.Column("failed_attempts", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_table(
        "auth_session",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("public_id", sa.String(32), nullable=False, unique=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("device_label", sa.String(80), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("last_seen_at", TS, nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("revoked_at", TS, nullable=True),
        sa.Column("revoked_reason", sa.String(80), nullable=True),
    )
    op.create_table(
        "course",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("is_synthetic", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "course_meeting",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("course_id", sa.Integer, sa.ForeignKey("course.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("weekday", sa.Integer, nullable=False),
        sa.Column("start_local", sa.String(5), nullable=False),
        sa.Column("end_local", sa.String(5), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("starts_on", sa.Date, nullable=False),
        sa.Column("ends_on", sa.Date, nullable=False),
        sa.Column("is_synthetic", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "task",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("course_id", sa.Integer, sa.ForeignKey("course.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("due_at", TS, nullable=True),
        sa.Column("estimated_minutes", sa.Integer, nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("is_synthetic", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_task_status_due", "task", ["status", "due_at"])


def downgrade() -> None:
    op.drop_index("ix_task_status_due", table_name="task")
    for table in ["task", "course_meeting", "course", "auth_session", "bootstrap_code", "owner", "profile_meta"]:
        op.drop_table(table)
