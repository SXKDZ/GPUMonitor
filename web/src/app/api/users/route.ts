import { NextRequest, NextResponse } from "next/server";
import { readUserRollups, buildUserUsage, resolveRange, nowSec } from "@/lib/data";
import { Bucket, UsersResponse } from "@/lib/contract";

export const dynamic = "force-dynamic";

/** Parse a positive integer epoch-seconds query param, or undefined. */
function epoch(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange({
    bucket: Bucket.catch("weekly").parse(sp.get("bucket") ?? "weekly"),
    from: epoch(sp.get("from")),
    to: epoch(sp.get("to")),
  });

  const records = await readUserRollups(range.from, range.to);
  const users = buildUserUsage(records);

  const body = UsersResponse.parse({
    generatedAt: nowSec(),
    range: { from: range.from, to: range.to, granularity: range.granularity },
    users,
  });
  return NextResponse.json(body);
}
