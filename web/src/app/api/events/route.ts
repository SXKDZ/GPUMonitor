import { NextResponse } from "next/server";
import { readEvents, nowSec } from "@/lib/data";
import { EventsResponse } from "@/lib/contract";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await readEvents(200);
  const body = EventsResponse.parse({ generatedAt: nowSec(), events });
  return NextResponse.json(body);
}
