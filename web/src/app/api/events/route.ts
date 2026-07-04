import { NextRequest, NextResponse } from "next/server";
import { readEvents, resolveRange, nowSec } from "@/lib/data";
import { Bucket, EventsResponse } from "@/lib/contract";

export const dynamic = "force-dynamic";

function epoch(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rawLimit = Number(sp.get("limit"));
  const limit = Number.isFinite(rawLimit) ? Math.min(5000, Math.max(1, rawLimit)) : 50;

  // A preset (bucket) or an explicit from/to both resolve to a time window,
  // exactly like the usage/users views, so event presets filter by window.
  const range = resolveRange({
    bucket: Bucket.catch("weekly").parse(sp.get("bucket") ?? "weekly"),
    from: epoch(sp.get("from")),
    to: epoch(sp.get("to")),
  });

  const { events, total } = await readEvents(limit, { from: range.from, to: range.to });
  const body = EventsResponse.parse({ generatedAt: nowSec(), events, total });
  return NextResponse.json(body);
}
