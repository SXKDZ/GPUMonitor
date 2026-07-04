#!/usr/bin/env python3
"""GPUGuard: kill compute processes on GPUs that GPUMonitor has flagged as
stalled (idle-but-occupied for a full 5-minute window).

This is deliberately tiny and does NO GPU sampling of its own -- it reads the
status file that GPUMonitor already writes (which contains a `kill_candidate`
flag per GPU) and acts on it. Running the killer separately keeps the
privileged component minimal; the heavy sampling runs unprivileged as the
monitor.

Runs as root (so it can terminate any user's process). Starts in dry-run:
it only logs `would-kill` until `enforce: true` is set in config.json.
"""

import json
import os
import pwd
import signal
import sys
import time

BASE = os.environ.get("GPUGUARD_BASE", "/opt/gpumonitor")

# Users the guard must NEVER kill, regardless of config.json. root and all
# system accounts (uid < 1000) are always protected -- a config with an empty
# protected_users list cannot expose them.
SYSTEM_UID_MAX = 1000
HOST = os.environ.get("GPUGUARD_HOST") or os.uname().nodename.split(".")[0]

POLL_INTERVAL = float(os.environ.get("GPUGUARD_POLL", "5"))       # seconds
TERM_GRACE = float(os.environ.get("GPUGUARD_TERM_GRACE", "15"))   # SIGTERM->KILL
# A status file older than this is ignored: if the monitor has died we must not
# act on stale flags (the situation may have changed).
STATUS_MAX_AGE = float(os.environ.get("GPUGUARD_STATUS_MAX_AGE", "60"))

DATA_DIR = os.path.join(BASE, "data")
STATUS_FILE = os.path.join(DATA_DIR, "status", f"{HOST}.json")
EVENTS_FILE = os.path.join(DATA_DIR, "events", f"{HOST}.jsonl")
CONFIG_FILE = os.path.join(BASE, "config.json")


def log(msg):
    print(f"[gpu-guard {HOST}] {msg}", flush=True)


def read_config():
    """Live-tunable: {enforce, protected_users}. Safe defaults on error."""
    cfg = {"enforce": False, "protected_users": ["root"]}
    try:
        with open(CONFIG_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict):
            cfg["enforce"] = bool(data.get("enforce", cfg["enforce"]))
            pu = data.get("protected_users", [])
            if isinstance(pu, list):
                cfg["protected_users"] = [str(u) for u in pu]
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"config read error, using defaults: {e!r}")
    return cfg


def read_status():
    """The monitor's latest status for this host, or None if missing/stale."""
    try:
        with open(STATUS_FILE) as f:
            data = json.load(f)
    except FileNotFoundError:
        return None
    except Exception as e:
        log(f"status read error: {e!r}")
        return None
    if not isinstance(data, dict):
        return None
    age = time.time() - float(data.get("ts", 0))
    if age > STATUS_MAX_AGE:
        return None  # monitor stalled/dead -> do not act on stale flags
    return data


def append_jsonl(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(obj) + "\n")


def live_owner(pid):
    """(uid, username) of the process currently holding `pid`, read live from
    /proc -- NOT trusted from the status file. Returns (None, None) if gone.
    This is the authoritative owner for the kill decision, so a status file
    that mislabels a PID's user cannot steer root into killing the wrong
    process."""
    try:
        uid = os.stat(f"/proc/{pid}").st_uid
    except Exception:
        return None, None
    try:
        return uid, pwd.getpwuid(uid).pw_name
    except KeyError:
        return uid, str(uid)


def is_protected(uid, name, cfg):
    """A PID is protected if its LIVE owner is root/system (uid < 1000) or in
    the configured protected_users. Never trusts the status file's user string."""
    if uid is None:
        return True  # can't verify owner -> refuse to kill
    if uid < SYSTEM_UID_MAX:
        return True
    return name in cfg["protected_users"]


def do_kill(pid):
    """SIGTERM, wait TERM_GRACE, then SIGKILL. Returns outcome string."""
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return "already-gone"
    except PermissionError:
        return "no-permission"
    deadline = time.time() + TERM_GRACE
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return "term"
        time.sleep(0.5)
    try:
        os.kill(pid, signal.SIGKILL)
        return "kill"
    except ProcessLookupError:
        return "term"
    except PermissionError:
        return "no-permission"


def handle_gpu(gpu, cfg):
    """Act on one flagged GPU. Returns list of event dicts written."""
    events = []
    for p in gpu.get("procs", []):
        pid = p.get("pid")
        # Only signal real, user-space PIDs. Reject non-int, <=1 (0 signals the
        # whole process group, -1 signals every process, 1 is init) so a crafted
        # status file can't turn one GPU into a system-wide kill.
        if not isinstance(pid, bool) and isinstance(pid, int) and pid > 1:
            pass
        else:
            log(f"gpu{gpu['index']}: skip invalid pid {pid!r}")
            continue

        # Resolve the owner LIVE from /proc, not from the (untrusted) status
        # file, and protect root/system + configured users.
        uid, owner = live_owner(pid)
        if owner is None:
            continue  # process already gone
        if is_protected(uid, owner, cfg):
            log(f"gpu{gpu['index']}: skip protected {owner} pid {pid}")
            continue

        ev = {
            "ts": time.time(), "host": HOST, "gpu": gpu["index"],
            "uuid": gpu.get("uuid", "?"), "pid": pid, "user": owner,
            "name": p.get("name", "?"), "mem_mib": p.get("mem_mib", 0),
            "enforce": cfg["enforce"], "action": None,
        }
        if not cfg["enforce"]:
            ev["action"] = "would-kill"
            log(f"DRY-RUN would kill gpu{gpu['index']} pid {pid} "
                f"({owner}/{p.get('name','?')}, {p.get('mem_mib',0)} MiB)")
        else:
            ev["action"] = do_kill(pid)
            log(f"KILLED gpu{gpu['index']} pid {pid} "
                f"({owner}/{p.get('name','?')}): {ev['action']}")
        events.append(ev)
    return events


def main():
    log(f"starting: base={BASE} poll={POLL_INTERVAL}s (reads {os.path.basename(STATUS_FILE)})")
    # Debounce: only act on a (gpu, pid-set) once per stall episode, so we don't
    # re-log/re-signal the same candidate every poll while its window stays hot.
    acted = {}  # uuid -> frozenset(pids) last acted upon

    while True:
        cfg = read_config()
        status = read_status()
        if status is None:
            acted.clear()
            time.sleep(POLL_INTERVAL)
            continue

        seen_uuids = set()
        for gpu in status.get("gpus", []):
            uuid = gpu.get("uuid", str(gpu.get("index")))
            seen_uuids.add(uuid)
            pids = frozenset(p.get("pid") for p in gpu.get("procs", []))
            if not gpu.get("kill_candidate"):
                # not flagged anymore -> clear any debounce for this GPU
                acted.pop(uuid, None)
                continue
            if acted.get(uuid) == pids:
                continue  # already handled this exact candidate set
            events = handle_gpu(gpu, cfg)
            for ev in events:
                append_jsonl(EVENTS_FILE, ev)
            acted[uuid] = pids

        # forget GPUs no longer present
        for uuid in list(acted):
            if uuid not in seen_uuids:
                acted.pop(uuid, None)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
