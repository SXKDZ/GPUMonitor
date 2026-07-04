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

export function useOverview() {
  return useSWR(
    "/api/overview",
    (u: string) => fetchValidated(u, OverviewResponse),
    { refreshInterval: 10_000 },
  );
}

export function useUsage(bucket: Bucket, host?: string) {
  const key = host
    ? `/api/usage?bucket=${bucket}&host=${host}`
    : `/api/usage?bucket=${bucket}`;
  return useSWR(key, (u) => fetchValidated(u, UsageResponse), {
    refreshInterval: 60_000,
  });
}

export function useEvents() {
  return useSWR("/api/events", (u) => fetchValidated(u, EventsResponse), {
    refreshInterval: 15_000,
  });
}

export function useUsers(bucket: Bucket) {
  return useSWR(
    `/api/users?bucket=${bucket}`,
    (u: string) => fetchValidated(u, UsersResponse),
    { refreshInterval: 60_000 },
  );
}
