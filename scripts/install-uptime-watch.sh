#!/usr/bin/env bash
# Install and enable the uptime watch timer on this host.
#
#   ./scripts/install-uptime-watch.sh
#
# Re-run after changing the unit files. The watch itself needs no build step.
set -eo pipefail
cd "$(dirname "$0")/.."

install -m 0644 deploy/essentials-uptime.service /etc/systemd/system/essentials-uptime.service
install -m 0644 deploy/essentials-uptime.timer /etc/systemd/system/essentials-uptime.timer
systemctl daemon-reload
systemctl enable --now essentials-uptime.timer
systemctl start essentials-uptime.service

systemctl --no-pager list-timers essentials-uptime.timer
echo
echo "Last run:"
systemctl status essentials-uptime.service --no-pager -n 10 || true
