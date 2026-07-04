import { NextRequest, NextResponse } from "next/server";
import { readEvents, nowSec } from "@/lib/data";
import { EventsResponse } from "@/lib/contract";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) ? Math.min(2000, Math.max(1, raw)) : 50;
  const { events, total } = await readEvents(limit);
  const body = EventsResponse.parse({ generatedAt: nowSec(), events, total });
  return NextResponse.json(body);
}
