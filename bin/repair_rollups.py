#!/usr/bin/env python3
"""One-shot repair for corrupted rollup files.

A crash-loop can finalize the same hour more than once (duplicate records that
double-count GPU-hours) and, mid-crash, write a record with an impossible
util_mean (> 100%). This script rewrites each host's finalized rollup files
(<YYYY-MM>.jsonl and <YYYY-MM>.users.jsonl) keeping, per (hour, uuid|user), the
single most-complete record (max samples) and dropping records whose util_mean
exceeds 100 (corrupt). The in-progress current.json and live status are left
untouched. Idempotent and safe to re-run.

Usage:  python3 repair_rollups.py [--dry-run]
"""

import argparse
import glob
import json
import os

BASE = os.environ.get("GPUGUARD_BASE", "/opt/gpumonitor")
ROLLUP_DIR = os.path.join(BASE, "data", "rollup")
UTIL_MAX = 100.5  # allow rounding; anything above is corrupt


def log(m):
    print(f"[repair] {m}", flush=True)


def repair_file(path, key_fields, sample_field, dry):
    """Dedupe by key_fields keeping the record with the largest sample_field,
    drop util_mean>UTIL_MAX. Returns (kept, dropped_dup, dropped_bad)."""
    try:
        with open(path) as fh:
            lines = [l for l in fh.read().splitlines() if l.strip()]
    except FileNotFoundError:
        return 0, 0, 0

    best = {}          # key -> (samples, original_index, record)
    order = []         # keys in first-seen order, for stable output
    dropped_bad = 0
    idx = 0
    for l in lines:
        try:
            r = json.loads(l)
        except Exception:
            continue
        if float(r.get("util_mean", 0)) > UTIL_MAX:
            dropped_bad += 1
            continue
        try:
            key = tuple(r[k] for k in key_fields)
        except KeyError:
            continue
        s = float(r.get(sample_field, 0))
        if key not in best:
            best[key] = (s, idx, r)
            order.append(key)
        elif s > best[key][0]:
            best[key] = (s, idx, r)  # keep the fuller (more-sampled) record
        idx += 1

    kept = [best[k][2] for k in order]
    dropped_dup = (len(lines) - dropped_bad) - len(kept)
    if dropped_dup == 0 and dropped_bad == 0:
        return len(kept), 0, 0

    if dry:
        log(f"would rewrite {os.path.relpath(path, ROLLUP_DIR)}: "
            f"keep {len(kept)}, drop {dropped_dup} dup, {dropped_bad} corrupt")
    else:
        tmp = f"{path}.tmp.{os.getpid()}"
        with open(tmp, "w") as out:
            for r in kept:
                out.write(json.dumps(r) + "\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
        log(f"rewrote {os.path.relpath(path, ROLLUP_DIR)}: "
            f"kept {len(kept)}, dropped {dropped_dup} dup + {dropped_bad} corrupt")
    return len(kept), dropped_dup, dropped_bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    tot_dup = tot_bad = 0
    for host_dir in sorted(glob.glob(os.path.join(ROLLUP_DIR, "*"))):
        for f in sorted(glob.glob(os.path.join(host_dir, "*.jsonl"))):
            if f.endswith(".users.jsonl"):
                _, d, b = repair_file(f, ("hour", "user"), "gpu_samples", args.dry_run)
            else:
                _, d, b = repair_file(f, ("hour", "uuid"), "samples", args.dry_run)
            tot_dup += d
            tot_bad += b
    log(f"done: {tot_dup} duplicate + {tot_bad} corrupt records "
        f"{'to remove' if args.dry_run else 'removed'}")


if __name__ == "__main__":
    main()
