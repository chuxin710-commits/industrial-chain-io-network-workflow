#!/usr/bin/env bash
set -euo pipefail
root=/opt/chainlab/current
install -d -m 0755 -o chainlab -g chainlab /var/lib/chainlab/briefing
install -m 0644 "$root/deploy/chainlab-briefing.service" /etc/systemd/system/chainlab-briefing.service
install -m 0644 "$root/deploy/chainlab-briefing.timer" /etc/systemd/system/chainlab-briefing.timer
systemctl daemon-reload
systemctl enable --now chainlab-briefing.timer
systemctl start --no-block chainlab-briefing.service
