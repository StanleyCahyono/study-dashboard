"""Per-session key for the encrypted offline copy kept on a signed-in device.

Revision ID: 0002_snapshot_key
Revises: 0001_initial
Create Date: 2026-11-10
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_snapshot_key"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("auth_session") as batch:
        batch.add_column(sa.Column("snapshot_key", sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("auth_session") as batch:
        batch.drop_column("snapshot_key")
