"use client";
import useSWR from "swr";
import {
  OverviewResponse,
  UsageResponse,
  EventsResponse,
  UsersResponse,
  type Bucket,
} from "./contract";
import { useRefreshMs } from "./refresh";

/** Fetch + validate against the shared contract on the client too. */
async function fetchValidated<T>(
  url: string,
  schema: { parse: (x: unknown) => T },
): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return schema.parse(await res.json());
}

/** A time selection is either a named preset or a custom [from,to] range
 * (epoch seconds, UTC). */
export type TimeSelection =
  | { kind: "preset"; bucket: Bucket }
  | { kind: "range"; from: number; to: number };

/** Turn a selection into query params (stable key ordering for SWR caching). */
function timeParams(sel: TimeSelection): string {
  if (sel.kind === "preset") return `bucket=${sel.bucket}`;
  return `from=${sel.from}&to=${sel.to}`;
}

export function useOverview() {
  const refreshInterval = useRefreshMs();
  return useSWR(
    "/api/overview",
    (u: string) => fetchValidated(u, OverviewResponse),
    { refreshInterval },
  );
}

// Rollup-backed views (usage/users) only change when an hour finalizes, so
// poll them no more often than this regardless of the live-status interval.
// This keeps the 40 accumulated-usage charts from re-fetching every 10s.
const ROLLUP_MIN_REFRESH_MS = 300_000; // 5 min

/** Live interval, but floored (0 = paused stays paused). */
function slowRefresh(ms: number): number {
  return ms === 0 ? 0 : Math.max(ms, ROLLUP_MIN_REFRESH_MS);
}

export function useUsage(sel: TimeSelection, host?: string) {
  const refreshInterval = slowRefresh(useRefreshMs());
  const q = timeParams(sel) + (host ? `&host=${host}` : "");
  return useSWR(`/api/usage?${q}`, (u: string) => fetchValidated(u, UsageResponse), {
    refreshInterval,
    keepPreviousData: true,
  });
}

export function useEvents(limit = 50, sel?: TimeSelection) {
  const refreshInterval = useRefreshMs();
  // Presets and custom ranges both resolve to a time window server-side.
  const timeQ = sel ? `&${timeParams(sel)}` : "";
  return useSWR(
    `/api/events?limit=${limit}${timeQ}`,
    (u: string) => fetchValidated(u, EventsResponse),
    { refreshInterval, keepPreviousData: true },
  );
}

export function useUsers(sel: TimeSelection) {
  const refreshInterval = slowRefresh(useRefreshMs());
  return useSWR(
    `/api/users?${timeParams(sel)}`,
    (u: string) => fetchValidated(u, UsersResponse),
    { refreshInterval, keepPreviousData: true },
  );
}
