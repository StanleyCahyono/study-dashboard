#!/usr/bin/env bash
# One-time setup on the Linux cloud server (Debian 12, Google Cloud e2-micro).
# Run from the repository root as your normal user (not root):
#   bash scripts/server-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

step() { echo; echo "== $1"; }
fail() { echo; echo "SETUP STOPPED: $1" >&2; exit 1; }
trap 'fail "the step above failed (line $LINENO). Copy the error and ask for help."' ERR

[ "$(id -u)" -ne 0 ] || fail "run this as your normal user, not with sudo."

step "System packages"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates

step "Swap space (the free server has only 1 GB of memory)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "already present"
fi

step "uv (Python tool)"
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
uv --version

step "Node.js 22"
if ! node --version 2>/dev/null | grep -Eq '^v(2[2-9]|[3-9][0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

step "Install pinned dependencies and build"
uv sync --locked
npm --prefix frontend ci
npm --prefix frontend run build

step "Run tests (synthetic data only)"
uv run pytest

step "Use the file key store (servers have no OS credential store)"
uv run studyctl config set-keystore file

step "Health check"
uv run studyctl doctor || echo "(Fix any FAIL lines above before relying on the app.)"

step "Install the background service"
UV="$(command -v uv)"
sudo tee /etc/systemd/system/studydash.service >/dev/null <<UNIT
[Unit]
Description=Private study dashboard (127.0.0.1:8765, reached only via Tailscale Serve)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$REPO
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$UV run --locked studyctl serve
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable studydash
echo "Service installed. It starts after you enroll (next step)."

trap - ERR
echo
echo "Setup complete. Next:"
echo "  uv run studyctl enroll                 # prints a one-time code"
echo "  sudo systemctl start studydash          # starts the app"
