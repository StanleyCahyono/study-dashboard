#!/usr/bin/env bash
# Update the app on the cloud server to the latest version and restart it.
#   bash scripts/server-update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
git pull --ff-only
uv sync --locked
npm --prefix frontend ci
npm --prefix frontend run build
uv run pytest -q
sudo systemctl restart studydash
sleep 3
systemctl --no-pager --lines=5 status studydash
