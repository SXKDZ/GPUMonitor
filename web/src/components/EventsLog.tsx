"use client";
import { useState } from "react";
import { useEvents } from "@/lib/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtBytesMiB } from "@/lib/utils";

const PAGE = 50;

export function EventsLog() {
  const [limit, setLimit] = useState(PAGE);
  const { data } = useEvents(limit);
  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const hasMore = events.length < total;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Guard actions</CardTitle>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            showing {events.length} of {total}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No kills or would-kills recorded yet.
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
