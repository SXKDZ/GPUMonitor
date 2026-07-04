/**
 * Server-only data access. Reads the collector's files straight off the local
 * NFS mount -- NO SSH, no cross-host calls -- and validates them against the
 * shared zod contract before anything downstream sees them.
 */
import "server-only";
import { promises as fs } from "fs";
import path from "path";
import {
  LiveStatus,
  HourlyRecord,
  KillEvent,
  UserHourly,
  type Bucket,
  type SeriesPoint,
  type UsageSeries,
  type UserUsage,
} from "./contract";

const BASE = process.env.GPUGUARD_BASE || "/opt/gpumonitor";
const DATA = path.join(BASE, "data");
const STATUS_DIR = path.join(DATA, "status");
const ROLLUP_DIR = path.join(DATA, "rollup");
const EVENTS_DIR = path.join(DATA, "events");

/** A host is "stale" if its latest sample is older than this. */
export const STALE_AFTER_S = 60;

/** Collector sample period; used to turn in-progress sample counts into hours.
 * Must match GPUGUARD_INTERVAL in the collector (default 10s). */
const SAMPLE_INTERVAL_S = Number(process.env.GPUGUARD_INTERVAL || "10");

/**
 * Cap on any single NFS operation. The data files live on an NFS mount that can
 * occasionally stall; without this, one slow read could hang a request handler
 * (and, since Node is single-threaded per worker, wedge the whole server). On
 * timeout we treat the file/dir as absent and serve whatever else we have.
 */
const IO_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, fallback: T, ms = IO_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** Timeout-guarded readFile; returns null if slow/unreadable. */
function readFileT(p: string): Promise<string | null> {
  return withTimeout(fs.readFile(p, "utf8"), null);
}

async function listFiles(dir: string): Promise<string[]> {
  return withTimeout(fs.readdir(dir), [] as string[]);
}

/** Latest live status for every host that has published one. */
export async function readAllStatus(): Promise<LiveStatus[]> {
  const files = (await listFiles(STATUS_DIR)).filter((f) => f.endsWith(".json"));
  const out: LiveStatus[] = [];
  await Promise.all(
    files.map(async (f) => {
      const raw = await readFileT(path.join(STATUS_DIR, f));
      if (raw === null) return;
      try {
        const parsed = LiveStatus.safeParse(JSON.parse(raw));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* skip unreadable/partial file; next sample overwrites atomically */
      }
    }),
  );
  return out.sort((a, b) => a.host.localeCompare(b.host));
}

/**
 * Read hourly rollup records across all hosts within [fromSec, toSec].
 * Only opens month files that can overlap the range -- keeps IO bounded.
 */
export async function readRollups(
  fromSec: number,
  toSec: number = nowSec(),
): Promise<HourlyRecord[]> {
  const hosts = await listFiles(ROLLUP_DIR);
  const wantedMonths = monthsInRange(fromSec, toSec);
  const inRange = (h: number) => h >= fromSec && h <= toSec;
  const records: HourlyRecord[] = [];
  await Promise.all(
    hosts.map(async (host) => {
      const hostDir = path.join(ROLLUP_DIR, host);
      const files = (await listFiles(hostDir)).filter((f) => f.endsWith(".jsonl"));
      await Promise.all(
        files.map(async (f) => {
          const month = f.replace(/\.jsonl$/, "");
          if (!wantedMonths.has(month)) return;
          const raw = await readFileT(path.join(hostDir, f));
          if (raw === null) return;
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
              const rec = HourlyRecord.safeParse(JSON.parse(line));
              if (rec.success && inRange(rec.data.hour)) records.push(rec.data);
            } catch {
              /* skip malformed line */
            }
          }
        }),
      );
      // Fold in the in-progress hour (not yet flushed to a month file) so the
      // hourly view shows data immediately instead of waiting up to an hour.
      for (const rec of await readCurrentHour(host)) {
        if (inRange(rec.hour)) records.push(rec);
      }
    }),
  );
  return records;
}

/** Convert a host's current.json accumulator into finalized HourlyRecords. */
async function readCurrentHour(host: string): Promise<HourlyRecord[]> {
  const p = path.join(ROLLUP_DIR, host, "current.json");
  const raw = await readFileT(p);
  if (raw === null) return [];
  let data: { hour?: number; acc?: unknown[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof data.hour !== "number" || !Array.isArray(data.acc)) return [];
  const hour = data.hour;
  const out: HourlyRecord[] = [];
  for (const a of data.acc as Record<string, number & string>[]) {
    const samples = Number(a.samples) || 0;
    if (samples <= 0) continue;
    const us = Number(a.util_samples) || samples;
    const memTotal = Number(a.mem_total) || 0;
    const memMean = Number(a.mem_sum) / samples;
    const rec = HourlyRecord.safeParse({
      v: 1,
      host,
      hour,
      uuid: String(a.uuid),
      index: Number(a.index),
      name: String(a.name),
      samples,
      util_mean: round(Number(a.util_sum) / us, 2),
      util_max: round(Number(a.util_max), 1),
      mem_used_mean: round(memMean, 1),
      mem_used_max: Number(a.mem_max) || 0,
      mem_total: memTotal,
      mem_mean_pct: memTotal ? round((100 * memMean) / memTotal, 2) : 0,
      idle_frac: round((Number(a.idle_samples) || 0) / us, 3),
      busy_frac: round((Number(a.busy_samples) || 0) / us, 3),
    });
    if (rec.success) out.push(rec.data);
  }
  return out;
}

/** Read per-user hourly rollups (finalized `<month>.users.jsonl` + in-progress). */
export async function readUserRollups(
  fromSec: number,
  toSec: number = nowSec(),
): Promise<UserHourly[]> {
  const hosts = await listFiles(ROLLUP_DIR);
  const wantedMonths = monthsInRange(fromSec, toSec);
  const inRange = (h: number) => h >= fromSec && h <= toSec;
  const records: UserHourly[] = [];
  await Promise.all(
    hosts.map(async (host) => {
      const hostDir = path.join(ROLLUP_DIR, host);
      const files = (await listFiles(hostDir)).filter((f) =>
        f.endsWith(".users.jsonl"),
      );
      await Promise.all(
        files.map(async (f) => {
          const month = f.replace(/\.users\.jsonl$/, "");
          if (!wantedMonths.has(month)) return;
          const raw = await readFileT(path.join(hostDir, f));
          if (raw === null) return;
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
              const rec = UserHourly.safeParse(JSON.parse(line));
              if (rec.success && inRange(rec.data.hour)) records.push(rec.data);
            } catch {
              /* skip malformed line */
            }
          }
        }),
      );
      for (const rec of await readCurrentUsers(host)) {
        if (inRange(rec.hour)) records.push(rec);
      }
    }),
  );
  return records;
}

/** Convert a host's in-progress current.json user accumulators into records. */
async function readCurrentUsers(host: string): Promise<UserHourly[]> {
  const raw = await readFileT(path.join(ROLLUP_DIR, host, "current.json"));
  if (raw === null) return [];
  let data: { hour?: number; users?: unknown[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof data.hour !== "number" || !Array.isArray(data.users)) return [];
  const hour = data.hour;
  const out: UserHourly[] = [];
  for (const u of data.users as Record<string, number & string>[]) {
    const gs = Number(u.gpu_samples) || 0;
    if (gs <= 0) continue;
    const rec = UserHourly.safeParse({
      v: 1,
      host,
      hour,
      user: String(u.user),
      gpu_samples: gs,
      gpu_hours: round((gs * SAMPLE_INTERVAL_S) / 3600, 4),
      util_mean: round(Number(u.util_sum) / gs, 2),
      mem_gib_hours: round((Number(u.mem_sum) * SAMPLE_INTERVAL_S) / 3600 / 1024, 4),
      mem_used_max_mib: Number(u.mem_max) || 0,
    });
    if (rec.success) out.push(rec.data);
  }
  return out;
}

/** Aggregate per-user hourly records into a leaderboard for the window,
 * including a per-host breakdown for the expandable detail. */
export function buildUserUsage(records: UserHourly[]): UserUsage[] {
  type Acc = {
    gpu_hours: number;
    util_w: number; // util weighted by gpu_samples
    gpu_samples: number;
    mem_gib_hours: number;
    mem_max_mib: number;
  };
  const mk = (): Acc => ({
    gpu_hours: 0, util_w: 0, gpu_samples: 0, mem_gib_hours: 0, mem_max_mib: 0,
  });
  const byUser = new Map<string, { total: Acc; hosts: Map<string, Acc> }>();
  for (const r of records) {
    const u = byUser.get(r.user) ?? { total: mk(), hosts: new Map<string, Acc>() };
    const h = u.hosts.get(r.host) ?? mk();
    for (const acc of [u.total, h]) {
      acc.gpu_hours += r.gpu_hours;
      acc.util_w += r.util_mean * r.gpu_samples;
      acc.gpu_samples += r.gpu_samples;
      acc.mem_gib_hours += r.mem_gib_hours;
      acc.mem_max_mib = Math.max(acc.mem_max_mib, r.mem_used_max_mib);
    }
    u.hosts.set(r.host, h);
    byUser.set(r.user, u);
  }
  const fmt = (a: Acc) => ({
    gpu_hours: round(a.gpu_hours, 2),
    util_mean: round(a.util_w / (a.gpu_samples || 1), 1),
    mem_gib_hours: round(a.mem_gib_hours, 2),
    mem_used_max_gib: round(a.mem_max_mib / 1024, 1),
  });
  return [...byUser.entries()]
    .map(([user, v]) => ({
      user,
      ...fmt(v.total),
      hosts: [...v.hosts.keys()].sort(),
      byHost: [...v.hosts.entries()]
        .map(([host, a]) => ({ host, ...fmt(a) }))
        .sort((a, b) => b.gpu_hours - a.gpu_hours),
    }))
    .sort((a, b) => b.gpu_hours - a.gpu_hours);
}

/** Most recent kill/would-kill events across all hosts, newest first. */
export async function readEvents(limit = 200): Promise<KillEvent[]> {
  const files = (await listFiles(EVENTS_DIR)).filter((f) => f.endsWith(".jsonl"));
  const events: KillEvent[] = [];
  await Promise.all(
    files.map(async (f) => {
      const raw = await readFileT(path.join(EVENTS_DIR, f));
      if (raw === null) return;
      // only parse the tail; event logs can grow unbounded
      const lines = raw.split("\n").filter((l) => l.trim()).slice(-limit);
      for (const line of lines) {
        try {
          const ev = KillEvent.safeParse(JSON.parse(line));
          if (ev.success) events.push(ev.data);
        } catch {
          /* skip */
        }
      }
    }),
  );
  return events.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

// ---- range resolution + aggregation -------------------------------------

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const HOUR = 3600;
const DAY = 86400;

/** A resolved query range: absolute [from,to] plus the aggregation bucket. */
export type ResolvedRange = {
  from: number;
  to: number;
  bucketSeconds: number;
  granularity: string; // tick-format hint: hourly | daily | weekly | monthly
};

/** How far back each preset looks. */
const PRESET_WINDOW_SECONDS: Record<Bucket, number> = {
  hourly: 48 * HOUR,
  weekly: 12 * 7 * DAY,
  biweekly: 26 * 14 * DAY,
  monthly: 12 * 30 * DAY,
};
const PRESET_BUCKET_SECONDS: Record<Bucket, number> = {
  hourly: HOUR,
  weekly: 7 * DAY,
  biweekly: 14 * DAY,
  monthly: 30 * DAY,
};
const PRESET_GRANULARITY: Record<Bucket, string> = {
  hourly: "hourly",
  weekly: "weekly",
  biweekly: "weekly",
  monthly: "monthly",
};

/** Pick a sensible bucket + tick granularity for an arbitrary span. */
function pickGranularity(spanSec: number): { bucketSeconds: number; granularity: string } {
  if (spanSec <= 3 * DAY) return { bucketSeconds: HOUR, granularity: "hourly" };
  if (spanSec <= 45 * DAY) return { bucketSeconds: DAY, granularity: "daily" };
  if (spanSec <= 300 * DAY) return { bucketSeconds: 7 * DAY, granularity: "weekly" };
  return { bucketSeconds: 30 * DAY, granularity: "monthly" };
}

/**
 * Resolve a query into an absolute range + bucket. Precedence:
 *   - explicit from/to (either bound optional) => custom range, auto granularity
 *   - otherwise the named preset (default "hourly")
 */
export function resolveRange(opts: {
  bucket?: Bucket;
  from?: number;
  to?: number;
}): ResolvedRange {
  const now = nowSec();
  if (opts.from != null || opts.to != null) {
    const to = opts.to != null ? opts.to : now;
    const from = opts.from != null ? opts.from : to - 7 * DAY;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const { bucketSeconds, granularity } = pickGranularity(Math.max(HOUR, hi - lo));
    return { from: lo, to: hi, bucketSeconds, granularity };
  }
  const b: Bucket = opts.bucket ?? "hourly";
  return {
    from: now - PRESET_WINDOW_SECONDS[b],
    to: now,
    bucketSeconds: PRESET_BUCKET_SECONDS[b],
    granularity: PRESET_GRANULARITY[b],
  };
}

function bucketStart(hour: number, bucketSeconds: number): number {
  return hour - (hour % bucketSeconds);
}

/**
 * Roll hourly records up into a coarser bucket for one grouping key.
 * Sample-weighted means so partial hours don't skew the average. Both
 * utilization AND memory are aggregated (mean + max).
 */
function aggregate(records: HourlyRecord[], bucketSeconds: number): SeriesPoint[] {
  const byBucket = new Map<
    number,
    {
      util_w: number;
      util_max: number;
      mem_w: number;
      mem_pct_w: number;
      mem_total: number;
      samples: number;
    }
  >();
  for (const r of records) {
    const b = bucketStart(r.hour, bucketSeconds);
    const cur =
      byBucket.get(b) ??
      { util_w: 0, util_max: 0, mem_w: 0, mem_pct_w: 0, mem_total: 0, samples: 0 };
    cur.util_w += r.util_mean * r.samples;
    cur.util_max = Math.max(cur.util_max, r.util_max);
    cur.mem_w += r.mem_used_mean * r.samples;
    cur.mem_pct_w += r.mem_mean_pct * r.samples;
    cur.mem_total = Math.max(cur.mem_total, r.mem_total);
    cur.samples += r.samples;
    byBucket.set(b, cur);
  }
  return [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => {
      const s = v.samples || 1;
      const memMib = v.mem_w / s;
      return {
        t,
        util_mean: round(v.util_w / s, 2),
        util_max: round(v.util_max, 1),
        mem_pct_mean: round(v.mem_pct_w / s, 2),
        mem_used_mean: round(memMib, 1),
        mem_used_gb_mean: round(memMib / 1024, 2),
        mem_total: v.mem_total,
        samples: v.samples,
      };
    });
}

function round(n: number, d: number): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

/**
 * Build aggregated series for a bucket, one series PER GPU (grouped by host):
 *   - a leading "cluster" series (all GPUs across all hosts)
 *   - one series per individual GPU, scope "host/gpuN"
 * Optionally restrict to a single host.
 */
export function buildSeries(
  records: HourlyRecord[],
  range: ResolvedRange,
  onlyHost?: string,
): UsageSeries[] {
  const { bucketSeconds, granularity } = range;
  const recs = onlyHost ? records.filter((r) => r.host === onlyHost) : records;
  const series: UsageSeries[] = [];
  if (!onlyHost) {
    series.push({
      scope: "cluster",
      label: "Whole cluster",
      granularity,
      points: aggregate(records, bucketSeconds),
    });
  }
  // group by (host, gpu index)
  const byGpu = new Map<string, { host: string; index: number; name: string; recs: HourlyRecord[] }>();
  for (const r of recs) {
    const key = `${r.host}/gpu${r.index}`;
    const cur = byGpu.get(key) ?? { host: r.host, index: r.index, name: r.name, recs: [] };
    cur.recs.push(r);
    byGpu.set(key, cur);
  }
  const keys = [...byGpu.keys()].sort((a, b) => {
    const x = byGpu.get(a)!;
    const y = byGpu.get(b)!;
    return x.host.localeCompare(y.host) || x.index - y.index;
  });
  for (const key of keys) {
    const g = byGpu.get(key)!;
    series.push({
      scope: key,
      label: `${g.host} · GPU ${g.index} (${g.name.replace("NVIDIA ", "")})`,
      granularity,
      points: aggregate(g.recs, bucketSeconds),
    });
  }
  return series;
}

function monthsInRange(fromSec: number, toSec: number): Set<string> {
  const out = new Set<string>();
  const d = new Date(fromSec * 1000);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(toSec * 1000);
  while (d.getTime() <= end.getTime()) {
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.add(m);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  // always include current month even if range math is tight
  const e = new Date(toSec * 1000);
  out.add(`${e.getUTCFullYear()}-${String(e.getUTCMonth() + 1).padStart(2, "0")}`);
  return out;
}
