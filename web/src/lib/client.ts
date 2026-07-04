"use client";
import useSWR from "swr";
import {
  OverviewResponse,
  UsageResponse,
  EventsResponse,
  UsersResponse,
  type Bucket,
} from "./contract";

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
  return useSWR(
    "/api/overview",
    (u: string) => fetchValidated(u, OverviewResponse),
    { refreshInterval: 10_000 },
  );
}

export function useUsage(sel: TimeSelection, host?: string) {
  const q = timeParams(sel) + (host ? `&host=${host}` : "");
  return useSWR(`/api/usage?${q}`, (u: string) => fetchValidated(u, UsageResponse), {
    refreshInterval: 60_000,
  });
}

export function useEvents(limit = 50, sel?: TimeSelection) {
  // Only a custom range filters events by time; presets show the newest N.
  const rangeQ = sel && sel.kind === "range" ? `&${timeParams(sel)}` : "";
  return useSWR(
    `/api/events?limit=${limit}${rangeQ}`,
    (u: string) => fetchValidated(u, EventsResponse),
    { refreshInterval: 15_000 },
  );
}

export function useUsers(sel: TimeSelection) {
  return useSWR(
    `/api/users?${timeParams(sel)}`,
    (u: string) => fetchValidated(u, UsersResponse),
    { refreshInterval: 60_000 },
  );
}
