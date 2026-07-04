#!/usr/bin/env bash
# Remove GPUMonitor systemd units from the current host.
#   sudo ./uninstall.sh                     # remove all units + the prune timer
#   sudo ./uninstall.sh monitor             # remove just one
#   sudo ./uninstall.sh prune               # remove the retention timer/service
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "must run as root (sudo)"; exit 1; }

# Each component maps to one or more unit files to disable + remove.
declare -A UNITS=(
  [monitor]="gpu-monitor.service"
  [guard]="gpu-guard.service"
  [dashboard]="gpu-dashboard.service"
  [prune]="gpu-prune.timer gpu-prune.service"
)

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=(monitor guard dashboard prune)

for t in "${targets[@]}"; do
  units="${UNITS[$t]:-}"
  [[ -n "$units" ]] || { echo "unknown component: $t"; continue; }
  for u in $units; do
    systemctl disable --now "$u" 2>/dev/null || true
    rm -f "/etc/systemd/system/$u"
    echo "removed $u"
  done
done
systemctl daemon-reload
echo "done on $(hostname)."
