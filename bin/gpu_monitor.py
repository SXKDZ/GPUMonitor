#!/usr/bin/env python3
"""GPUMonitor: sample per-GPU utilization+memory, publish live status + hourly
rollups (per-GPU and per-user) to shared NFS, and FLAG GPUs that have stalled.

It never kills anything -- flagging only. The companion GPUGuard service reads
the status file this writes and performs the actual termination. Splitting the
two means the (privileged) killer stays tiny and the (unprivileged) sampler can
run as a normal user.

Design goals (per deployment constraints):
  * stdlib only -- runs under any python on any host, zero installs.
  * two targeted `nvidia-smi ... --format=csv` subprocesses per sample (~350ms
    total, ~4x cheaper than `-q -x`) -> negligible load on the box.
  * no cross-host traffic -- every host samples locally and writes tiny files
    to the shared NFS dir; the dashboard only ever reads those files.

Stall rule (for flagging): within a rolling 5-minute window, if
> IDLE_FRACTION of the samples for a GPU are idle (utilization <= IDLE_UTIL_PCT)
*and* a compute process is holding the GPU, the GPU is flagged kill_candidate.
"""

import json
import os
import pwd
import subprocess
import sys
import time
from collections import deque

# --------------------------------------------------------------------------
# Configuration (env overrides; live-tunable bits also read from config.json).
# --------------------------------------------------------------------------
BASE = os.environ.get("GPUGUARD_BASE", "/opt/gpumonitor")
HOST = os.environ.get("GPUGUARD_HOST") or os.uname().nodename.split(".")[0]

SAMPLE_INTERVAL = float(os.environ.get("GPUGUARD_INTERVAL", "10"))   # seconds
WINDOW_SECONDS = float(os.environ.get("GPUGUARD_WINDOW", "300"))     # 5 minutes
IDLE_UTIL_PCT = float(os.environ.get("GPUGUARD_IDLE_UTIL", "5"))     # <= is idle
KILL_IDLE_FRACTION = float(os.environ.get("GPUGUARD_IDLE_FRACTION", "0.75"))
# Minimum coverage before a GPU may be flagged: the oldest sample must be at
# least this old, so we never flag on a half-filled window (right after start
# or right after a fresh job reset the window).
MIN_WINDOW_SPAN = WINDOW_SECONDS * 0.95

DATA_DIR = os.path.join(BASE, "data")
STATUS_DIR = os.path.join(DATA_DIR, "status")
ROLLUP_DIR = os.path.join(DATA_DIR, "rollup", HOST)
CONFIG_FILE = os.path.join(BASE, "config.json")
CONTRACT_VERSION = 1


def log(msg):
    print(f"[gpu-monitor {HOST}] {msg}", flush=True)


def read_enforce():
    """Read the enforce flag purely for display in status (the guard is the
    authority on enforcement). Safe default False if missing/broken."""
    try:
        with open(CONFIG_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict):
            return bool(data.get("enforce", False))
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"config read error: {e!r}")
    return False


def atomic_write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def append_jsonl(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(obj) + "\n")


def proc_username(pid):
    """Resolve the owner of a pid via /proc."""
    try:
        uid = os.stat(f"/proc/{pid}").st_uid
    except Exception:
        return "?"
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return str(uid)


def _query_cuda_version():
    """CUDA version for display only; queried once at startup (doesn't change)."""
    try:
        out = subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=15)
        # "... Driver Version: 595.45.04   CUDA Version: 13.2 |"  (common)
        # "... KMD Version: 610.43.02   CUDA UMD Version: 13.3 |"  (newer)
        for line in out.stdout.splitlines():
            for marker in ("CUDA UMD Version", "CUDA Version"):
                if marker in line:
                    tail = line.split(marker, 1)[1].replace("|", " ")
                    for tok in tail.split():
                        if tok[:1].isdigit() and "." in tok:
                            return tok
    except Exception:
        pass
    return "?"


CUDA_VERSION = _query_cuda_version()


def _smi_csv(query, extra):
    """Run a targeted nvidia-smi CSV query -> list of split-field rows.
    Returns None on failure. CSV queries are ~4x cheaper than `-q -x`."""
    try:
        out = subprocess.run(
            ["nvidia-smi", query, "--format=csv,noheader,nounits", *extra],
            capture_output=True, text=True, timeout=30,
        )
    except Exception as e:
        log(f"nvidia-smi failed: {e!r}")
        return None
    if out.returncode != 0:
        log(f"nvidia-smi rc={out.returncode}: {out.stderr.strip()[:200]}")
        return None
    rows = []
    for line in out.stdout.splitlines():
        line = line.strip()
        if line:
            rows.append([c.strip() for c in line.split(", ")])
    return rows


def _num(s, cast=float):
    """Parse a CSV numeric cell; 'N/A'/'[N/A]'/'' -> None."""
    try:
        return cast(s)
    except (ValueError, TypeError):
        return None


def sample_gpus():
    """Two cheap nvidia-smi CSV calls (GPU stats + compute procs) joined by
    UUID -> list of per-GPU dicts. Returns None on failure."""
    grows = _smi_csv(
        "--query-gpu=index,uuid,name,utilization.gpu,memory.used,"
        "memory.total,driver_version",
        [],
    )
    if grows is None:
        return None
    prows = _smi_csv(
        "--query-compute-apps=gpu_uuid,pid,used_memory,process_name", []
    )
    if prows is None:
        prows = []  # a proc-query hiccup shouldn't drop the whole sample

    procs_by_uuid = {}
    for r in prows:
        if len(r) < 4:
            continue
        uuid = r[0]
        pid = _num(r[1], int)
        if pid is None:
            continue
        procs_by_uuid.setdefault(uuid, []).append({
            "pid": pid,
            "user": proc_username(pid),
            "mem_mib": int(_num(r[2]) or 0),
            "name": (r[3] or "?").split("/")[-1],
        })

    gpus = []
    driver = grows[0][6] if grows and len(grows[0]) > 6 else "?"
    for r in grows:
        if len(r) < 7:
            continue
        uuid = r[1]
        gpus.append({
            "index": int(_num(r[0], int) or len(gpus)),
            "uuid": uuid or f"idx{len(gpus)}",
            "name": r[2],
            "util_pct": _num(r[3]),
            "mem_used_mib": int(_num(r[4]) or 0),
            "mem_total_mib": int(_num(r[5]) or 0),
            "procs": procs_by_uuid.get(uuid, []),
            "driver": r[6] if len(r) > 6 else driver,
            "cuda": CUDA_VERSION,
        })
    return gpus


# --------------------------------------------------------------------------
# Hourly rollup accumulator (running sums; means computed at finalize).
# In-progress hour is checkpointed to current.json so a restart resumes it.
# --------------------------------------------------------------------------
class Rollup:
    def __init__(self):
        self.hour = None
        self.acc = {}    # uuid -> per-GPU accumulator dict
        self.users = {}  # username -> per-user accumulator dict
        self.current_path = os.path.join(ROLLUP_DIR, "current.json")
        self._load()

    @staticmethod
    def hour_start(ts):
        return int(ts - (ts % 3600))

    def _load(self):
        try:
            with open(self.current_path) as f:
                data = json.load(f)
            self.hour = data.get("hour")
            self.acc = {a["uuid"]: a for a in data.get("acc", [])}
            self.users = {u["user"]: u for u in data.get("users", [])}
            log(f"resumed in-progress hour {self.hour} with {len(self.acc)} gpus, "
                f"{len(self.users)} users")
        except FileNotFoundError:
            pass
        except Exception as e:
            log(f"rollup resume failed: {e!r}")

    def add(self, ts, gpus):
        h = self.hour_start(ts)
        if self.hour is None:
            self.hour = h
        elif h != self.hour:
            self._finalize()
            self.hour = h
            self.acc = {}
            self.users = {}
            # Durably record the reset BEFORE accumulating the new hour, so a
            # crash mid-hour can't make resume re-finalize (double-count) the
            # already-flushed previous hour.
            self._checkpoint()
        for g in gpus:
            a = self.acc.get(g["uuid"])
            if a is None:
                a = {
                    "uuid": g["uuid"], "index": g["index"], "name": g["name"],
                    "samples": 0, "util_sum": 0.0, "util_max": 0.0,
                    "util_samples": 0, "mem_sum": 0.0, "mem_max": 0,
                    "mem_total": g["mem_total_mib"], "idle_samples": 0,
                    "busy_samples": 0,
                }
                self.acc[g["uuid"]] = a
            a["samples"] += 1
            u = g["util_pct"]
            if u is not None:
                a["util_sum"] += u
                a["util_samples"] += 1
                a["util_max"] = max(a["util_max"], u)
                if u <= IDLE_UTIL_PCT:
                    a["idle_samples"] += 1
                else:
                    a["busy_samples"] += 1
            a["mem_sum"] += g["mem_used_mib"]
            a["mem_max"] = max(a["mem_max"], g["mem_used_mib"])
            a["mem_total"] = g["mem_total_mib"] or a["mem_total"]

            # Attribute this GPU-sample to each user occupying it. A GPU's
            # utilization can't be split per-process, so each present user is
            # credited the GPU's util for this sample; memory is per-process.
            mem_by_user = {}
            for p in g["procs"]:
                mem_by_user[p["user"]] = mem_by_user.get(p["user"], 0) + p["mem_mib"]
            for user, umem in mem_by_user.items():
                ua = self.users.get(user)
                if ua is None:
                    ua = {"user": user, "gpu_samples": 0, "util_samples": 0,
                          "util_sum": 0.0, "mem_sum": 0.0, "mem_max": 0}
                    self.users[user] = ua
                ua["gpu_samples"] += 1  # one (gpu, sample) of occupancy
                if u is not None:
                    ua["util_sum"] += u
                    ua["util_samples"] += 1  # denominator for util_mean
                ua["mem_sum"] += umem
                ua["mem_max"] = max(ua["mem_max"], umem)
        self._checkpoint()

    def _record(self, a):
        us = a["util_samples"] or 1
        s = a["samples"] or 1
        return {
            "v": CONTRACT_VERSION, "host": HOST, "hour": self.hour,
            "uuid": a["uuid"], "index": a["index"], "name": a["name"],
            "samples": a["samples"],
            "util_mean": round(a["util_sum"] / us, 2),
            "util_max": round(a["util_max"], 1),
            "mem_used_mean": round(a["mem_sum"] / s, 1),
            "mem_used_max": a["mem_max"],
            "mem_total": a["mem_total"],
            "mem_mean_pct": round(100.0 * (a["mem_sum"] / s) / a["mem_total"], 2)
            if a["mem_total"] else 0.0,
            "idle_frac": round(a["idle_samples"] / us, 3),
            "busy_frac": round(a["busy_samples"] / us, 3),
        }

    def _user_record(self, ua):
        # Divide util by the number of samples that actually had a util reading
        # (N/A samples are excluded), matching the per-GPU record. Older
        # checkpoints may lack util_samples; fall back to gpu_samples.
        us = ua.get("util_samples", ua["gpu_samples"]) or 1
        gpu_hours = ua["gpu_samples"] * SAMPLE_INTERVAL / 3600.0
        mem_gib_hours = ua["mem_sum"] * SAMPLE_INTERVAL / 3600.0 / 1024.0
        return {
            "v": CONTRACT_VERSION, "host": HOST, "hour": self.hour,
            "user": ua["user"],
            "gpu_samples": ua["gpu_samples"],
            "gpu_hours": round(gpu_hours, 4),
            "util_mean": round(ua["util_sum"] / us, 2),
            "mem_gib_hours": round(mem_gib_hours, 4),
            "mem_used_max_mib": ua["mem_max"],
        }

    def _finalize(self):
        if self.hour is None:
            return
        month = time.strftime("%Y-%m", time.gmtime(self.hour))
        path = os.path.join(ROLLUP_DIR, f"{month}.jsonl")
        for a in self.acc.values():
            append_jsonl(path, self._record(a))
        upath = os.path.join(ROLLUP_DIR, f"{month}.users.jsonl")
        for ua in self.users.values():
            append_jsonl(upath, self._user_record(ua))
        log(f"finalized hour {self.hour} -> {os.path.basename(path)} "
            f"({len(self.acc)} gpus, {len(self.users)} users)")

    def _checkpoint(self):
        atomic_write(self.current_path, json.dumps({
            "hour": self.hour,
            "acc": list(self.acc.values()),
            "users": list(self.users.values()),
        }))


def main():
    for d in (STATUS_DIR, ROLLUP_DIR):
        os.makedirs(d, exist_ok=True)
    log(f"starting: base={BASE} interval={SAMPLE_INTERVAL}s window={WINDOW_SECONDS}s "
        f"idle<= {IDLE_UTIL_PCT}% frac>{KILL_IDLE_FRACTION} (flag-only, no kill)")

    windows = {}      # uuid -> deque[(ts, idle_bool)]
    occupants = {}    # uuid -> frozenset(pids)  (to reset window on job change)
    rollup = Rollup()

    while True:
        loop_start = time.time()
        enforce = read_enforce()
        gpus = sample_gpus()
        if gpus is None:
            time.sleep(SAMPLE_INTERVAL)
            continue

        now = time.time()
        rollup.add(now, gpus)
        status_gpus = []

        for g in gpus:
            uuid = g["uuid"]
            pids = frozenset(p["pid"] for p in g["procs"])
            # Reset the rolling window whenever the set of occupying procs
            # changes, so a freshly started job gets a fresh 5-minute window.
            if occupants.get(uuid) != pids:
                windows[uuid] = deque()
                occupants[uuid] = pids
            win = windows.setdefault(uuid, deque())

            u = g["util_pct"]
            is_idle = (u is not None and u <= IDLE_UTIL_PCT)
            win.append((now, is_idle))
            cutoff = now - WINDOW_SECONDS
            while win and win[0][0] < cutoff:
                win.popleft()

            span = (win[-1][0] - win[0][0]) if len(win) > 1 else 0.0
            idle_frac = (sum(1 for _, i in win if i) / len(win)) if win else 0.0
            occupied = len(g["procs"]) > 0
            window_full = span >= MIN_WINDOW_SPAN
            kill_candidate = occupied and window_full and idle_frac > KILL_IDLE_FRACTION

            status_gpus.append({
                "index": g["index"], "uuid": uuid, "name": g["name"],
                "util_pct": u, "mem_used_mib": g["mem_used_mib"],
                "mem_total_mib": g["mem_total_mib"],
                "mem_pct": round(100.0 * g["mem_used_mib"] / g["mem_total_mib"], 1)
                if g["mem_total_mib"] else 0.0,
                "idle_frac_5m": round(idle_frac, 3),
                "window_span_s": round(span, 1),
                "occupied": occupied,
                "kill_candidate": kill_candidate,
                "procs": g["procs"],
            })

        atomic_write(os.path.join(STATUS_DIR, f"{HOST}.json"), json.dumps({
            "v": CONTRACT_VERSION, "host": HOST, "ts": now,
            "driver": gpus[0]["driver"] if gpus else "?",
            "cuda": gpus[0]["cuda"] if gpus else "?",
            "enforce": enforce,
            "interval_s": SAMPLE_INTERVAL, "window_s": WINDOW_SECONDS,
            "idle_util_pct": IDLE_UTIL_PCT, "kill_idle_frac": KILL_IDLE_FRACTION,
            "gpus": status_gpus,
        }))

        elapsed = time.time() - loop_start
        time.sleep(max(1.0, SAMPLE_INTERVAL - elapsed))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
