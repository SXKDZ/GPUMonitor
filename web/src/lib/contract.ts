/**
 * Shared data contract between the Python collector (producer) and the
 * Next.js backend/frontend (consumers). Zod is the single source of truth:
 * route handlers validate raw NFS JSON against these schemas, and the inferred
 * TypeScript types flow into the React components -- so producer and consumer
 * can never silently drift.
 *
 * Mirrors the records written by gpu_guard.py:
 *   data/status/<host>.json        -> LiveStatus
 *   data/rollup/<host>/<YYYY-MM>.jsonl (one HourlyRecord per line)
 *   data/events/<host>.jsonl       -> KillEvent per line
 */
import { z } from "zod";

export const CONTRACT_VERSION = 1;

/** A single compute process occupying a GPU. */
export const GpuProc = z.object({
  pid: z.number(),
  user: z.string(),
  mem_mib: z.number(),
  name: z.string(),
});
export type GpuProc = z.infer<typeof GpuProc>;

/** Live per-GPU snapshot inside a host status file. */
export const LiveGpu = z.object({
  index: z.number(),
  uuid: z.string(),
  name: z.string(),
  util_pct: z.number().nullable(),
  mem_used_mib: z.number(),
  mem_total_mib: z.number(),
  mem_pct: z.number(),
  idle_frac_5m: z.number(),
  window_span_s: z.number(),
  occupied: z.boolean(),
  // GPUMonitor flags a stalled GPU; GPUGuard decides whether to actually kill.
  kill_candidate: z.boolean(),
  procs: z.array(GpuProc),
});
export type LiveGpu = z.infer<typeof LiveGpu>;

/** Full status file for one host (latest sample). */
export const LiveStatus = z.object({
  v: z.number(),
  host: z.string(),
  ts: z.number(),
  driver: z.string(),
  cuda: z.string(),
  enforce: z.boolean(),
  interval_s: z.number(),
  window_s: z.number(),
  idle_util_pct: z.number(),
  kill_idle_frac: z.number(),
  gpus: z.array(LiveGpu),
});
export type LiveStatus = z.infer<typeof LiveStatus>;

/** One finalized hour of per-GPU accumulated usage (util + memory). */
export const HourlyRecord = z.object({
  v: z.number(),
  host: z.string(),
  hour: z.number(), // unix epoch seconds at hour start (UTC)
  uuid: z.string(),
  index: z.number(),
  name: z.string(),
  samples: z.number(),
  util_mean: z.number(),
  util_max: z.number(),
  mem_used_mean: z.number(),
  mem_used_max: z.number(),
  mem_total: z.number(),
  mem_mean_pct: z.number(),
  idle_frac: z.number(),
  busy_frac: z.number(),
});
export type HourlyRecord = z.infer<typeof HourlyRecord>;

/** Audit record for a kill (or would-kill in dry-run). */
export const KillEvent = z.object({
  ts: z.number(),
  host: z.string(),
  gpu: z.number(),
  uuid: z.string(),
  pid: z.number(),
  user: z.string(),
  name: z.string(),
  mem_mib: z.number(),
  enforce: z.boolean(),
  action: z.string(),
});
export type KillEvent = z.infer<typeof KillEvent>;

// ---- API response contracts (backend -> frontend) -----------------------

export const BUCKETS = ["hourly", "weekly", "biweekly", "monthly"] as const;
export const Bucket = z.enum(BUCKETS);
export type Bucket = z.infer<typeof Bucket>;

/** One time-bucketed point in an aggregated series. */
export const SeriesPoint = z.object({
  t: z.number(), // bucket start, unix epoch seconds (UTC)
  util_mean: z.number(),
  util_max: z.number(),
  mem_pct_mean: z.number(),
  mem_used_mean: z.number(), // MiB
  mem_used_gb_mean: z.number(), // GiB (for the memory y-axis)
  mem_total: z.number(),
  samples: z.number(),
});
export type SeriesPoint = z.infer<typeof SeriesPoint>;

/** Aggregated usage for a scope (a host, a GPU, or the whole cluster).
 * `granularity` is a tick-formatting hint: "hourly" | "daily" | "weekly" | "monthly". */
export const UsageSeries = z.object({
  scope: z.string(), // "cluster" | host | "host/gpuN"
  label: z.string(),
  granularity: z.string(),
  points: z.array(SeriesPoint),
});
export type UsageSeries = z.infer<typeof UsageSeries>;

export const OverviewResponse = z.object({
  generatedAt: z.number(),
  hosts: z.array(LiveStatus),
  stale: z.array(z.string()), // hosts whose status is older than staleAfterS
  staleAfterS: z.number(),
  earliest: z.number().nullable(), // epoch secs of oldest data, or null if none
});
export type OverviewResponse = z.infer<typeof OverviewResponse>;

/** The resolved time range + chosen granularity for a query. */
export const RangeInfo = z.object({
  from: z.number(), // epoch seconds (UTC)
  to: z.number(),
  granularity: z.string(), // "hourly" | "daily" | "weekly" | "monthly"
});
export type RangeInfo = z.infer<typeof RangeInfo>;

export const UsageResponse = z.object({
  generatedAt: z.number(),
  range: RangeInfo,
  series: z.array(UsageSeries),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

export const EventsResponse = z.object({
  generatedAt: z.number(),
  events: z.array(KillEvent),
  total: z.number(), // total events available across all hosts
});
export type EventsResponse = z.infer<typeof EventsResponse>;

/** One finalized hour of per-user accumulated GPU usage. */
export const UserHourly = z.object({
  v: z.number(),
  host: z.string(),
  hour: z.number(),
  user: z.string(),
  gpu_samples: z.number(),
  gpu_hours: z.number(),   // GPU-hours of occupancy (# GPUs x time held)
  util_mean: z.number(),   // mean util of GPUs while this user occupied them
  mem_gib_hours: z.number(), // GiB-hours of memory held
  mem_used_max_mib: z.number(),
});
export type UserHourly = z.infer<typeof UserHourly>;

/** Per-host slice of one user's usage (for the expandable detail). */
export const UserHostUsage = z.object({
  host: z.string(),
  gpu_hours: z.number(),
  util_mean: z.number(),
  mem_gib_hours: z.number(),
  mem_used_max_gib: z.number(),
});
export type UserHostUsage = z.infer<typeof UserHostUsage>;

/** Aggregated usage for one user over the selected window. */
export const UserUsage = z.object({
  user: z.string(),
  gpu_hours: z.number(),
  util_mean: z.number(),
  mem_gib_hours: z.number(),
  mem_used_max_gib: z.number(),
  hosts: z.array(z.string()),
  byHost: z.array(UserHostUsage),
});
export type UserUsage = z.infer<typeof UserUsage>;

export const UsersResponse = z.object({
  generatedAt: z.number(),
  range: RangeInfo,
  users: z.array(UserUsage),
});
export type UsersResponse = z.infer<typeof UsersResponse>;
