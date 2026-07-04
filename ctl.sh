#!/usr/bin/env bash
# GPUMonitor/GPUGuard control helper. Run from the repo checkout on any host.
#   ctl.sh install-monitor       (sudo) install+start GPUMonitor on THIS host
#   ctl.sh install-guard         (sudo) install+start GPUGuard (root killer) on THIS host
#   ctl.sh install-dashboard     (sudo) install+start dashboard on THIS host
#   ctl.sh install-all           (sudo) monitor + guard on THIS host
#   ctl.sh install-prune         (sudo) install daily data-retention timer
#   ctl.sh enforce on|off        flip kill-enforcement for ALL hosts (edits config.json)
#   ctl.sh protect <user>...     add users the guard must never kill
#   ctl.sh prune [--dry-run]     prune data older than the retention window now
#   ctl.sh status                show per-host live summary
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$REPO/config.env" ]] && { set -a; source "$REPO/config.env"; set +a; }
BASE="${GPUGUARD_BASE:-/opt/gpumonitor}"
CFG="$BASE/config.json"

case "${1:-}" in
  install-monitor)   sudo "$REPO/install.sh" monitor ;;
  install-guard)     sudo "$REPO/install.sh" guard ;;
  install-dashboard) sudo "$REPO/install.sh" dashboard ;;
  install-prune)     sudo "$REPO/install.sh" prune ;;
  install-all)       sudo "$REPO/install.sh" monitor guard ;;
  prune)             shift; python3 "$REPO/bin/prune_data.py" "$@" ;;
  enforce)
    val=false; [[ "${2:-}" == "on" ]] && val=true
    python3 - "$CFG" "$val" <<'PY'
import json, sys
path, val = sys.argv[1], sys.argv[2] == "true"
try:
    with open(path) as f: cfg = json.load(f)
except Exception:
    cfg = {}
cfg["enforce"] = val
cfg.setdefault("protected_users", ["root"])
with open(path, "w") as f: json.dump(cfg, f, indent=2)
print("enforce =", val, "(guards pick this up within one poll cycle)")
PY
    ;;
  protect)
    shift
    python3 - "$CFG" "$@" <<'PY'
import json, sys
path, users = sys.argv[1], sys.argv[2:]
try:
    with open(path) as f: cfg = json.load(f)
except Exception:
    cfg = {"enforce": False}
pu = set(cfg.get("protected_users", [])) | set(users) | {"root"}
cfg["protected_users"] = sorted(pu)
with open(path, "w") as f: json.dump(cfg, f, indent=2)
print("protected_users =", cfg["protected_users"])
PY
    ;;
  status)
    python3 - "$BASE" <<'PY'
import json, glob, os, sys, time
base = sys.argv[1]
now = time.time()
print("%-8s %-4s %-5s %-6s %-8s %-6s" % ("host","gpus","busy","idle*","enforce","age"))
for f in sorted(glob.glob(os.path.join(base, "data/status/*.json"))):
    d = json.load(open(f)); g = d["gpus"]
    busy = sum(1 for x in g if (x["util_pct"] or 0) > 5)
    idle = sum(1 for x in g if x["occupied"] and (x["util_pct"] or 0) <= 5)
    print("%-8s %-4d %-5d %-6d %-8s %-.0fs" % (
        d["host"], len(g), busy, idle, d["enforce"], now - d["ts"]))
print("* idle-but-occupied (guard candidates)")
PY
    ;;
  *) grep '^#' "$0" | sed 's/^# \?//'; exit 1 ;;
esac
