"use client";
import { BUCKETS, type Bucket } from "@/lib/contract";
import { type TimeSelection } from "@/lib/client";
import { TabBar } from "@/components/ui/tabs";
import {
  cn,
  toClockParts,
  fromClockParts,
  nowSecClient,
  tzLabel,
  type ClockParts,
} from "@/lib/utils";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,..,55

const selectCls =
  "rounded bg-transparent text-xs text-foreground outline-none " +
  "[color-scheme:light] dark:[color-scheme:dark]";

/** A 12-hour date + hour:minute + AM/PM picker for one endpoint. */
function DateTime12({
  epoch,
  max,
  onChange,
}: {
  epoch: number;
  max: number;
  onChange: (epoch: number) => void;
}) {
  const c = toClockParts(epoch);
  const commit = (next: Partial<ClockParts>) => {
    const e = fromClockParts({ ...c, ...next });
    if (e != null) onChange(e);
  };
  const maxDate = toClockParts(max).date;
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="date"
        value={c.date}
        max={maxDate}
        onChange={(e) => commit({ date: e.target.value })}
        className={selectCls}
      />
      <select
        value={c.hour12}
        onChange={(e) => commit({ hour12: Number(e.target.value) })}
        className={selectCls}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">:</span>
      <select
        value={c.minute}
        onChange={(e) => commit({ minute: Number(e.target.value) })}
        className={selectCls}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      <select
        value={c.ampm}
        onChange={(e) => commit({ ampm: e.target.value as "AM" | "PM" })}
        className={selectCls}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
}

/**
 * Preset buttons (Hourly/Weekly/…) plus a custom From/To range using a 12-hour
 * AM/PM picker with 5-minute steps. Picking a preset clears the custom range;
 * editing either endpoint switches to range mode. All times are shown in the
 * display timezone (see DISPLAY_TZ / tzLabel).
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
  const now = nowSecClient();
  const from = value.kind === "range" ? value.from : now - 7 * 86400;
  const to = value.kind === "range" ? value.to : now;

  return (
    <div className="flex flex-wrap items-stretch gap-x-3 gap-y-2">
      <TabBar
        className="h-10"
        value={value.kind === "preset" ? value.bucket : "__custom__"}
        onValueChange={(b) => onChange({ kind: "preset", bucket: b as Bucket })}
        options={BUCKETS.map((b) => ({ value: b, label: presetLabels[b] }))}
      />
      <div
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-lg border px-2",
          value.kind === "range"
            ? "border-primary/50 bg-primary/10"
            : "border-border bg-muted/40",
        )}
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          From
        </span>
        <DateTime12
          epoch={from}
          max={to}
          onChange={(f) => onChange({ kind: "range", from: f, to })}
        />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          To
        </span>
        <DateTime12
          epoch={to}
          max={now}
          onChange={(t) => onChange({ kind: "range", from, to: t })}
        />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {tzLabel()}
        </span>
      </div>
    </div>
  );
}
