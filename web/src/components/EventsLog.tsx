"use client";
import { useEvents } from "@/lib/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtBytesMiB } from "@/lib/utils";

export function EventsLog() {
  const { data } = useEvents();
  const events = data?.events ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Guard actions</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No kills or would-kills recorded yet.
          </p>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-auto text-sm">
            {events.map((e, i) => (
              <div
                key={`${e.host}-${e.pid}-${e.ts}-${i}`}
                className="flex items-center justify-between gap-3 border-b border-border/50 pb-1.5"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={e.enforce ? "danger" : "warn"}>
                    {e.action}
                  </Badge>
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
        )}
      </CardContent>
    </Card>
  );
}
