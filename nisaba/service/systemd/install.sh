#!/usr/bin/env bash
# Install the Nisaba service as a systemd *user* service so it starts on login,
# restarts if it crashes, and is always available to Claude Code on this laptop.
#
# Prereq: sign in once interactively first (`node ../src/main.js`, complete the
# Google browser step) so the session exists — the daemon reuses it and never
# needs to open a browser.
#
# Usage:  bash install.sh          # install + enable + start
#         bash install.sh remove   # stop + disable + delete the unit
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"           # …/nisaba/service
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/nisaba.service"

if [[ "${1:-}" == "remove" ]]; then
  systemctl --user disable --now nisaba.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  echo "Removed nisaba.service."
  exit 0
fi

NODE_BIN="$(command -v node)" || { echo "node not found on PATH"; exit 1; }
mkdir -p "$UNIT_DIR"

cat > "$UNIT" <<EOF
[Unit]
Description=Nisaba local REST + MCP service (Claude Code integration)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$SERVICE_DIR
ExecStart=$NODE_BIN $SERVICE_DIR/src/main.js
Restart=on-failure
RestartSec=5
Environment=NISABA_PORT=27125
# Bind host: localhost by default. For Tailscale, set NISABA_HOST to your
# tailnet IP (tailscale ip -4) before running this script — not 0.0.0.0, which
# would also expose the service on untrusted networks.
Environment=NISABA_HOST=${NISABA_HOST:-127.0.0.1}

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now nisaba.service

echo
echo "Installed and started. Handy commands:"
echo "  systemctl --user status nisaba.service     # health"
echo "  journalctl --user -u nisaba.service -f     # live logs (incl. the token line)"
echo "  systemctl --user restart nisaba.service    # after pulling updates"
echo
echo "Optional — keep it running even when logged out:"
echo "  sudo loginctl enable-linger $USER"
