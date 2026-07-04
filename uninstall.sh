#!/usr/bin/env bash
# Remove GPUMonitor systemd units from the current host.
#   sudo ./uninstall.sh              # remove all three units
#   sudo ./uninstall.sh monitor      # remove just one
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "must run as root (sudo)"; exit 1; }

declare -A UNIT=(
  [monitor]=gpu-monitor.service
  [guard]=gpu-guard.service
  [dashboard]=gpu-dashboard.service
)

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=(monitor guard dashboard)

for t in "${targets[@]}"; do
  u="${UNIT[$t]:-}"
  [[ -n "$u" ]] || { echo "unknown component: $t"; continue; }
  systemctl disable --now "$u" 2>/dev/null || true
  rm -f "/etc/systemd/system/$u"
  echo "removed $u"
done
systemctl daemon-reload
echo "done on $(hostname)."
