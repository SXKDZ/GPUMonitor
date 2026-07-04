import { NextRequest, NextResponse } from "next/server";
import { readUserRollups, buildUserUsage, bucketWindowStart, nowSec } from "@/lib/data";
import { Bucket, UsersResponse } from "@/lib/contract";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bucket = Bucket.catch("hourly").parse(
    req.nextUrl.searchParams.get("bucket") ?? "weekly",
  );
  const records = await readUserRollups(bucketWindowStart(bucket));
  const users = buildUserUsage(records);
  const body = UsersResponse.parse({ generatedAt: nowSec(), bucket, users });
  return NextResponse.json(body);
}
