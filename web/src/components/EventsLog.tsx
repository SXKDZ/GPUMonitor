"use client";
import { useState } from "react";
import { useEvents, useOverview, type TimeSelection } from "@/lib/client";
import { type Bucket } from "@/lib/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtBytesMiB } from "@/lib/utils";
import { TimeRangeControls } from "@/components/TimeRangeControls";

const PAGE = 50;

// For events the presets just mean "newest N"; only a custom range filters by
// time, so give the presets event-count labels.
const BUCKET_LABELS: Record<Bucket, string> = {
  hourly: "Latest",
  weekly: "Latest",
  biweekly: "Latest",
  monthly: "Latest",
};

export function EventsLog() {
  const [time, setTime] = useState<TimeSelection>({ kind: "preset", bucket: "hourly" });
  const [limit, setLimit] = useState(PAGE);
  const { data } = useEvents(limit, time);
  const earliest = useOverview().data?.earliest ?? null;
  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const hasMore = events.length < total;
  const ranged = time.kind === "range";

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-3 text-base">
          Guard actions
          {total > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              showing {events.length} of {total}
              {ranged ? " in range" : ""}
            </span>
          )}
        </CardTitle>
        <TimeRangeControls
          value={time}
          onChange={setTime}
          presetLabels={BUCKET_LABELS}
          earliest={earliest}
        />
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {ranged
              ? "No kills or would-kills in this range."
              : "No kills or would-kills recorded yet."}
          </p>
        ) : (
          <>
            <div className="max-h-96 space-y-1.5 overflow-auto pr-1 text-sm">
              {events.map((e, i) => (
                <div
                  key={`${e.host}-${e.pid}-${e.ts}-${i}`}
                  className="flex items-center justify-between gap-3 border-b border-border/50 pb-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={e.enforce ? "danger" : "warn"}>{e.action}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {e.host}·gpu{e.gpu}
                    </span>
                    <span className="truncate">
                      pid {e.pid} · {e.user} · {e.name} · {fmtBytesMiB(e.mem_mib)}
                    </span>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {new Date(e.ts * 1000).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + PAGE)}
                  className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Load more ({total - events.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
