import { NextRequest, NextResponse } from "next/server";
import { readRollups, buildSeries, bucketWindowStart, nowSec } from "@/lib/data";
import { Bucket, UsageResponse } from "@/lib/contract";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bucket = Bucket.catch("hourly").parse(sp.get("bucket") ?? "hourly");
  const host = sp.get("host") ?? undefined; // optional: restrict to one host

  const records = await readRollups(bucketWindowStart(bucket));
  const series = buildSeries(records, bucket, host);

  const body = UsageResponse.parse({
    generatedAt: nowSec(),
    bucket,
    series,
  });
  return NextResponse.json(body);
}
