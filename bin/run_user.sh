#!/usr/bin/env bash
# Interim launcher: run GPUMonitor as the current (non-root) user, detached,
# without systemd -- handy for a quick try or before installing the service.
# The monitor only samples and publishes stats + flags; it never kills.
# Idempotent: refuses to start a second copy on the same host.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$REPO/config.env" ]] && { set -a; source "$REPO/config.env"; set +a; }
BASE="${GPUGUARD_BASE:-/opt/gpumonitor}"
HOST=$(hostname | cut -d. -f1)
PIDFILE="$BASE/logs/monitor.$HOST.pid"
LOG="$BASE/logs/monitor.$HOST.log"

if [[ "${1:-}" == "--restart" ]]; then
  [[ -f "$PIDFILE" ]] && kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 1
elif [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "monitor already running on $HOST (pid $(cat "$PIDFILE"))"; exit 0
fi

mkdir -p "$BASE/logs"
export TZ=UTC GPUGUARD_BASE="$BASE"
setsid nohup python3 "$REPO/bin/gpu_monitor.py" >>"$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
disown || true
sleep 1
echo "started GPUMonitor on $HOST (pid $(cat "$PIDFILE")) -> $LOG"
