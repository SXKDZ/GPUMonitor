#!/usr/bin/env python3
"""Prune GPUMonitor data older than a retention window.

Removes finalized monthly rollup files whose entire month is older than the
cutoff, and trims per-host event logs to drop events older than the cutoff.
The in-progress `current.json` and the live `status/` files are never touched.

Usage:
    python3 prune_data.py [--days N] [--dry-run]

Defaults: GPUGUARD_RETENTION_DAYS env or 30 days. Safe to run repeatedly (e.g.
from cron). With --dry-run it only reports what it would remove.
"""

import argparse
import calendar
import glob
import json
import os
import time

BASE = os.environ.get("GPUGUARD_BASE", "/opt/gpumonitor")
DATA = os.path.join(BASE, "data")
ROLLUP_DIR = os.path.join(DATA, "rollup")
EVENTS_DIR = os.path.join(DATA, "events")


def log(msg):
    print(f"[prune] {msg}", flush=True)


def month_end_epoch(name):
    """Epoch (UTC) of the first instant AFTER the given YYYY-MM month."""
    y, m = (int(x) for x in name.split("-"))
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return calendar.timegm((ny, nm, 1, 0, 0, 0, 0, 0, 0))


def prune_rollups(cutoff, dry):
    removed = 0
    for host_dir in sorted(glob.glob(os.path.join(ROLLUP_DIR, "*"))):
        for f in sorted(glob.glob(os.path.join(host_dir, "*.jsonl"))):
            base = os.path.basename(f)
            # match YYYY-MM.jsonl and YYYY-MM.users.jsonl
            month = base.split(".", 1)[0]
            if len(month) != 7 or month[4] != "-":
                continue
            try:
                end = month_end_epoch(month)
            except Exception:
                continue
            # remove only if the whole month is older than the cutoff
            if end <= cutoff:
                if dry:
                    log(f"would remove {f}")
                else:
                    os.remove(f)
                    log(f"removed {f}")
                removed += 1
    return removed


def trim_events(cutoff, dry):
    trimmed = 0
    for f in sorted(glob.glob(os.path.join(EVENTS_DIR, "*.jsonl"))):
        try:
            with open(f) as fh:
                lines = fh.readlines()
        except FileNotFoundError:
            continue
        kept = []
        dropped = 0
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                if json.loads(line).get("ts", 0) >= cutoff:
                    kept.append(line)
                else:
                    dropped += 1
            except Exception:
                kept.append(line)  # keep unparseable lines rather than lose data
        if dropped == 0:
            continue
        trimmed += dropped
        if dry:
            log(f"would drop {dropped} old events from {os.path.basename(f)}")
        else:
            tmp = f"{f}.tmp.{os.getpid()}"
            with open(tmp, "w") as out:
                out.write("\n".join(kept) + ("\n" if kept else ""))
                out.flush()
                os.fsync(out.fileno())  # durable before the atomic rename
            os.replace(tmp, f)
            log(f"trimmed {dropped} old events from {os.path.basename(f)}")
    return trimmed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int,
                    default=int(os.environ.get("GPUGUARD_RETENTION_DAYS", "30")))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cutoff = int(time.time()) - args.days * 86400
    log(f"retention {args.days}d -> cutoff {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(cutoff))}"
        + (" (dry-run)" if args.dry_run else ""))
    r = prune_rollups(cutoff, args.dry_run)
    e = trim_events(cutoff, args.dry_run)
    log(f"done: {r} rollup file(s), {e} event(s) {'to remove' if args.dry_run else 'removed'}")


if __name__ == "__main__":
    main()
