"use client";
import { Pause, Play } from "lucide-react";
import { REFRESH_OPTIONS, useRefreshControl } from "@/lib/refresh";
import { cn } from "@/lib/utils";

/** Pause/resume auto-refresh + pick the polling interval. */
export function RefreshControl() {
  const { refreshMs, setRefreshMs } = useRefreshControl();
  // Remember the last non-zero interval so resume restores it.
  const paused = refreshMs === 0;
  const lastMs = paused ? 10_000 : refreshMs;

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setRefreshMs(paused ? lastMs : 0)}
        title={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
        aria-label={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
          paused
            ? "border-amber-500/50 bg-amber-500/15 text-amber-500"
            : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
        )}
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {paused ? "Paused" : "Live"}
      </button>
      <select
        value={paused ? 0 : refreshMs}
        onChange={(e) => setRefreshMs(Number(e.target.value))}
        title="Auto-refresh interval"
        className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground [color-scheme:light] dark:[color-scheme:dark]"
      >
        {paused && <option value={0}>off</option>}
        {REFRESH_OPTIONS.map((o) => (
          <option key={o.ms} value={o.ms}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
