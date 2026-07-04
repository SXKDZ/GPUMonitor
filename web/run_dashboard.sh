#!/usr/bin/env bash
# Start the dashboard (production server) detached, idempotently, without
# systemd. Reads config.env for GPUGUARD_BASE and GPUGUARD_PORT. Pidfile/log
# are per-host so a shared filesystem deployment doesn't clobber state.
set -euo pipefail
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$REPO/config.env" ]] && { set -a; source "$REPO/config.env"; set +a; }
WEB="$REPO/web"
HOST=$(hostname | cut -d. -f1)
PIDFILE="$WEB/dashboard.$HOST.pid"
LOG="$WEB/dashboard.$HOST.log"
PORT="${GPUGUARD_PORT:-8090}"

if [[ "${1:-}" == "--restart" ]]; then
  [[ -f "$PIDFILE" ]] && kill "$(cat "$PIDFILE")" 2>/dev/null || true
  # belt-and-suspenders: free the port even if the pidfile is stale
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 1
elif [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "dashboard already running (pid $(cat "$PIDFILE")) on port $PORT"; exit 0
fi

cd "$WEB"
export GPUGUARD_BASE="${GPUGUARD_BASE:-/opt/gpumonitor}"
[[ -f .env.local ]] && set -a && . ./.env.local && set +a || true
setsid nohup npx next start -H 0.0.0.0 -p "$PORT" >>"$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
disown || true
sleep 4
echo "dashboard started (pid $(cat "$PIDFILE")) on http://$(hostname -f):$PORT -> $LOG"
