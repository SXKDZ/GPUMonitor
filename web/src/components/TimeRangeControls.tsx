"use client";
import { BUCKETS, type Bucket } from "@/lib/contract";
import { type TimeSelection } from "@/lib/client";
import { TabBar } from "@/components/ui/tabs";
import { cn, toDateInput, fromDateInput, nowSecClient } from "@/lib/utils";

/**
 * Preset buttons (Hourly/Weekly/…) plus a custom From/To date range.
 * Picking a preset clears the custom range; setting either date switches to
 * range mode. Controlled via a single `TimeSelection`.
 */
export function TimeRangeControls({
  value,
  onChange,
  presetLabels,
}: {
  value: TimeSelection;
  onChange: (sel: TimeSelection) => void;
  presetLabels: Record<Bucket, string>;
}) {
  // Default the date inputs to the last 7 days when entering range mode.
  const now = nowSecClient();
  const from = value.kind === "range" ? value.from : now - 7 * 86400;
  const to = value.kind === "range" ? value.to : now;

  function setFrom(v: string) {
    const f = fromDateInput(v);
    if (f == null) return;
    onChange({ kind: "range", from: f, to: value.kind === "range" ? value.to : now });
  }
  function setTo(v: string) {
    const t = fromDateInput(v, true);
    if (t == null) return;
    onChange({
      kind: "range",
      from: value.kind === "range" ? value.from : now - 7 * 86400,
      to: t,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <TabBar
        value={value.kind === "preset" ? value.bucket : "__custom__"}
        onValueChange={(b) => onChange({ kind: "preset", bucket: b as Bucket })}
        options={BUCKETS.map((b) => ({ value: b, label: presetLabels[b] }))}
      />
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-2 py-1",
          value.kind === "range"
            ? "border-primary/50 bg-primary/10"
            : "border-border bg-muted/40",
        )}
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          From
        </span>
        <input
          type="date"
          value={toDateInput(from)}
          max={toDateInput(to)}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded bg-transparent text-xs text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
        />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          To
        </span>
        <input
          type="date"
          value={toDateInput(to)}
          min={toDateInput(from)}
          max={toDateInput(now)}
          onChange={(e) => setTo(e.target.value)}
          className="rounded bg-transparent text-xs text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
        />
      </div>
    </div>
  );
}
