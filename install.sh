#!/usr/bin/env bash
# GPUMonitor installer -- renders systemd units from config.env and installs
# them on THIS host. Run with sudo.
#
#   sudo ./install.sh monitor      # GPUMonitor (sampling + stats + dashboard data)
#   sudo ./install.sh guard        # GPUGuard   (root killer; dry-run until enforced)
#   sudo ./install.sh dashboard    # web dashboard (run on one host)
#   sudo ./install.sh monitor guard # several at once
#
# All values come from ./config.env (copy from config.env.example first).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$REPO/config.env"

[[ $EUID -eq 0 ]] || { echo "must run as root (sudo)"; exit 1; }
[[ -f "$CONFIG" ]] || { echo "missing $CONFIG (copy from config.env.example)"; exit 1; }
[[ $# -ge 1 ]] || { echo "usage: sudo ./install.sh <monitor|guard|dashboard> ..."; exit 1; }

# shellcheck disable=SC1090
set -a; source "$CONFIG"; set +a

BASE="${GPUGUARD_BASE:?set GPUGUARD_BASE in config.env}"
USER_="${GPUGUARD_USER:-$(logname 2>/dev/null || echo root)}"
PORT="${GPUGUARD_PORT:-8090}"

# Auto-detect the node bin dir if not pinned in config.env (needed by the
# dashboard unit, which has no login shell).
NODE_BIN="${GPUGUARD_NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(sudo -u "$USER_" bash -lc 'command -v node' 2>/dev/null || command -v node || true)"
  NODE_BIN="${NODE_BIN%/node}"
fi

# Sanity checks common to all components.
command -v python3 >/dev/null || { echo "python3 not found"; exit 1; }

render() {  # <template> <dest>
  sed -e "s#@BASE@#$BASE#g" \
      -e "s#@USER@#$USER_#g" \
      -e "s#@NODE_BIN@#$NODE_BIN#g" \
      -e "s#@PORT@#$PORT#g" \
      "$1" > "$2"
}

install_unit() {  # <component> <unit-name> [extra-check]
  local comp="$1" unit="$2"
  render "$REPO/systemd/$unit.in" "/etc/systemd/system/$unit"
  systemctl daemon-reload
  systemctl enable --now "$unit"
  sleep 2
  systemctl --no-pager --full status "$unit" | head -8 || true
  echo
}

for comp in "$@"; do
  case "$comp" in
    monitor)
      command -v nvidia-smi >/dev/null || { echo "nvidia-smi not found"; exit 1; }
      test -f "$BASE/bin/gpu_monitor.py" || { echo "missing $BASE/bin/gpu_monitor.py"; exit 1; }
      install_unit monitor gpu-monitor.service ;;
    guard)
      test -f "$BASE/bin/gpu_guard.py" || { echo "missing $BASE/bin/gpu_guard.py"; exit 1; }
      install_unit guard gpu-guard.service
      echo "GPUGuard installed. It is DRY-RUN until you set enforce=true in $BASE/config.json." ;;
    dashboard)
      [[ -n "$NODE_BIN" && -x "$NODE_BIN/npx" ]] || { echo "node/npx not found (set GPUGUARD_NODE_BIN)"; exit 1; }
      test -d "$BASE/web/.next" || { echo "dashboard not built: run 'npm --prefix $BASE/web ci && npm --prefix $BASE/web run build'"; exit 1; }
      install_unit dashboard gpu-dashboard.service
      echo "Dashboard at http://$(hostname -f):$PORT" ;;
    prune)
      test -f "$BASE/bin/prune_data.py" || { echo "missing $BASE/bin/prune_data.py"; exit 1; }
      render "$REPO/systemd/gpu-prune.service.in" /etc/systemd/system/gpu-prune.service
      render "$REPO/systemd/gpu-prune.timer.in" /etc/systemd/system/gpu-prune.timer
      systemctl daemon-reload
      systemctl enable --now gpu-prune.timer
      systemctl --no-pager list-timers gpu-prune.timer | head -3 || true
      echo "prune timer installed (retention ${GPUGUARD_RETENTION_DAYS:-30}d, runs daily)." ;;
    *) echo "unknown component: $comp (use monitor|guard|dashboard|prune)"; exit 1 ;;
  esac
done
