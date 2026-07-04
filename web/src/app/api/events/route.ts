import { NextRequest, NextResponse } from "next/server";
import { readEvents, nowSec } from "@/lib/data";
import { EventsResponse } from "@/lib/contract";

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

  const from = epoch(sp.get("from"));
  const to = epoch(sp.get("to"));
  const range =
    from != null || to != null
      ? { from: from ?? 0, to: to ?? nowSec() }
      : undefined;

  const { events, total } = await readEvents(limit, range);
  const body = EventsResponse.parse({ generatedAt: nowSec(), events, total });
  return NextResponse.json(body);
}
