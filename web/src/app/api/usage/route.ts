import { NextRequest, NextResponse } from "next/server";
import { readRollups, buildSeries, resolveRange, nowSec } from "@/lib/data";
import { Bucket, UsageResponse } from "@/lib/contract";

export const dynamic = "force-dynamic";

/** Parse a positive integer epoch-seconds query param, or undefined. */
function epoch(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const host = sp.get("host") ?? undefined; // optional: restrict to one host
  const range = resolveRange({
    bucket: Bucket.catch("hourly").parse(sp.get("bucket") ?? "hourly"),
    from: epoch(sp.get("from")),
    to: epoch(sp.get("to")),
  });

  const records = await readRollups(range.from, range.to);
  const series = buildSeries(records, range, host);

  const body = UsageResponse.parse({
    generatedAt: nowSec(),
    range: { from: range.from, to: range.to, granularity: range.granularity },
    series,
  });
  return NextResponse.json(body);
}
