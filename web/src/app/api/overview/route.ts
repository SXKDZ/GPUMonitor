import { NextResponse } from "next/server";
import { readAllStatus, nowSec, STALE_AFTER_S } from "@/lib/data";
import { OverviewResponse } from "@/lib/contract";

export const dynamic = "force-dynamic"; // always read fresh NFS state

export async function GET() {
  const hosts = await readAllStatus();
  const now = nowSec();
  const stale = hosts
    .filter((h) => now - h.ts > STALE_AFTER_S)
    .map((h) => h.host);
  const body = OverviewResponse.parse({
    generatedAt: now,
    hosts,
    stale,
    staleAfterS: STALE_AFTER_S,
  });
  return NextResponse.json(body);
}
