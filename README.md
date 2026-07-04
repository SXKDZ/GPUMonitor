# GPUMonitor

Lightweight, dependency-free GPU monitoring for a shared multi-host cluster,
plus an optional idle-guard that reclaims stalled GPUs.

- **GPUMonitor** — samples per-GPU utilization + memory on each host, publishes
  live status and **hourly** rollups (per GPU **and** per user), and flags GPUs
  that have gone idle-but-occupied. The dashboard aggregates those hourly
  records into weekly/biweekly/monthly (or any custom range) on read. Runs
  unprivileged.
- **GPUGuard** *(optional)* — a tiny root service that reads what the monitor
  flagged and kills the stalled processes. Ships in **dry-run**; it only logs
  `would-kill` until you explicitly enable enforcement.
- **Dashboard** — a Next.js web UI (TypeScript + Tailwind + shadcn-style +
  Recharts) with a light/dark/system theme switch.

## Why it's cheap

- **stdlib-only Python** for the agents — runs under the system `python3` on any
  host, zero installs.
- Two targeted `nvidia-smi --format=csv` calls per sample (~0.3–0.5 s, ~4× cheaper
  than `nvidia-smi -q -x`) — negligible load even on busy boxes.
- **No cross-host traffic.** Every host samples locally and writes small files to
  a shared directory; the dashboard only *reads* those files. Adding hosts adds
  no polling fan-out.

## How the idle rule works

For each GPU the monitor keeps a rolling window (default **5 min**). If **>75 %**
of the samples in that window are **idle** (utilization **≤5 %**) *and* a compute
process is holding the GPU, the GPU is flagged `kill_candidate` — but only once
the window is actually full (a ~95 % span guard), so a freshly started or just
-reset window never flags prematurely. The window resets whenever the set of
processes changes, so a freshly started job always gets a fresh window. GPUGuard
(if installed and enforcing) then SIGTERMs, waits a grace period, and SIGKILLs
the holdouts. All thresholds are configurable.

## Architecture

```
each host ── gpu_monitor.py (unprivileged) ─┐  writes
                                            ├─►  $GPUGUARD_BASE/data/{status,rollup,events}
each host ── gpu_guard.py   (root, optional)┘  reads status, kills flagged procs

one host  ── web/ (Next.js) ── reads $GPUGUARD_BASE/data ──►  dashboard :PORT
```

`GPUGUARD_BASE` must be a **shared filesystem** (NFS, etc.) visible on every host
and the dashboard host. On a single machine any writable path works.

### Data layout (under `$GPUGUARD_BASE`)

```
config.json                       { "enforce": bool, "protected_users": [...] }
data/status/<host>.json           latest live sample (atomic overwrite)
data/rollup/<host>/<YYYY-MM>.jsonl finalized hourly per-GPU records
data/rollup/<host>/<YYYY-MM>.users.jsonl  finalized hourly per-user records
data/rollup/<host>/current.json   in-progress hour (survives restart)
data/events/<host>.jsonl          audit log of every kill / would-kill
```

The producer (Python) and consumer (dashboard) share one **zod** contract in
`web/src/lib/contract.ts`, so the two can't silently drift.

## Configuration

Everything is driven by one file. Copy the example and edit:

```bash
cp config.env.example config.env
```

| Variable | Default | Meaning |
|---|---|---|
| `GPUGUARD_BASE` | `/opt/gpumonitor` | shared data dir (must be shared FS on a cluster) |
| `GPUGUARD_USER` | `gpumonitor` | unprivileged user the monitor/dashboard run as |
| `GPUGUARD_INTERVAL` | `10` | seconds between samples |
| `GPUGUARD_WINDOW` | `300` | rolling idle window in seconds (the "5 min") |
| `GPUGUARD_IDLE_UTIL` | `5` | utilization % at/below which a sample is "idle" |
| `GPUGUARD_IDLE_FRACTION` | `0.75` | idle-sample fraction that flags a GPU |
| `GPUGUARD_TERM_GRACE` | `15` | seconds between SIGTERM and SIGKILL (guard) |
| `GPUGUARD_POLL` | `5` | seconds between guard status-file polls |
| `GPUGUARD_STATUS_MAX_AGE` | `60` | guard ignores a status file older than this (s) |
| `GPUGUARD_RETENTION_DAYS` | `30` | prune deletes rollups/events older than this |
| `GPUGUARD_PORT` | `8090` | dashboard port (shell/systemd only; not read by web code) |
| `GPUGUARD_NODE_BIN` | *(auto)* | node bin dir for the dashboard unit |
| `GPUGUARD_HOST` | *(hostname)* | override the host label in filenames/status |

Build-time only (inlined by Next.js — set before `npm run build`, not via the
systemd runtime env): `NEXT_PUBLIC_TITLE` (dashboard heading) and
`NEXT_PUBLIC_TZ` (display timezone for charts/pickers).

Runtime kill policy lives in `$GPUGUARD_BASE/config.json`
(`enforce`, `protected_users`) and is editable live via `./ctl.sh`.

## Install

Prerequisites: `nvidia-smi` + `python3` on each GPU host; Node 18+ on the
dashboard host. Put this repo on the shared `GPUGUARD_BASE` (so `bin/` and
`web/` are visible everywhere), then:

```bash
cp config.env.example config.env      # edit GPUGUARD_BASE etc.

# build the dashboard once (on the dashboard host)
npm --prefix web ci && npm --prefix web run build

# install services (systemd). Run on each host as needed:
sudo ./install.sh monitor              # GPUMonitor  (every GPU host)
sudo ./install.sh dashboard            # dashboard   (one host)
sudo ./install.sh guard                # GPUGuard    (optional; dry-run until enabled)
sudo ./install.sh prune                # daily data-retention timer (optional)
```

To set a custom dashboard title or timezone, export the `NEXT_PUBLIC_*` vars
into the build environment *before* building (e.g. put them in `web/.env.local`),
since Next.js inlines them at build time.

No systemd / no root? Run the agents in the foreground for a quick try:

```bash
./bin/run_user.sh          # GPUMonitor, detached, current user
./web/run_dashboard.sh     # dashboard, detached
```

## Operate

```bash
./ctl.sh status            # per-host live summary
./ctl.sh enforce on|off    # flip GPUGuard enforcement for ALL hosts
./ctl.sh protect alice bob # never kill these users' processes
./ctl.sh prune [--dry-run] # delete data older than the retention window now
sudo ./ctl.sh install-monitor|install-guard|install-dashboard|install-prune|install-all
sudo ./uninstall.sh [monitor|guard|dashboard|prune]
```

Enforcement is **central**: `ctl.sh enforce on` edits `config.json` once and
every guard picks it up within one poll cycle. Guards start in **dry-run**.

**Data retention.** Rollups and event logs accumulate over time. `prune_data.py`
deletes finalized monthly rollups whose whole month is older than
`GPUGUARD_RETENTION_DAYS` (default 30) and trims events older than the cutoff;
the in-progress hour and live status are never touched. Run it manually
(`./ctl.sh prune`, add `--dry-run` to preview) or install the daily timer
(`sudo ./install.sh prune`).

## Dashboard

- **Live status** — per host, each GPU shows a utilization row and a memory row;
  click a GPU to expand its processes (PID / user / process / memory).
- **Accumulated usage** — per-GPU utilization (%) and memory (GB) on a dual
  y-axis, over hourly / weekly / biweekly / monthly windows. Host and GPU
  **multi-select** buttons let you compare several GPUs at once.
- **Per-user usage** — GPU-hours, mean utilization, and memory GB-hours; click a
  user for a per-host breakdown.
- **Guard actions** — audit log of kills / would-kills.
- **Theme** — light / dark / system (default follows the OS).

## Layout

```
bin/gpu_monitor.py     sampler + rollups + flagging (unprivileged)
bin/gpu_guard.py       reads status, kills flagged procs (root; optional)
bin/run_user.sh        run the monitor without systemd
web/                   Next.js dashboard (shared zod contract in src/lib/contract.ts)
systemd/*.service.in   unit templates rendered by install.sh
install.sh / uninstall.sh / ctl.sh   operator tooling
config.env.example     all tunables
```

## License

MIT — see [LICENSE](LICENSE).
