"use client";
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useUsage, type TimeSelection } from "@/lib/client";
import { type Bucket } from "@/lib/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, tzLabel } from "@/lib/utils";
import { UsageChart } from "@/components/UsageChart";
import { TimeRangeControls } from "@/components/TimeRangeControls";

const BUCKET_LABELS: Record<Bucket, string> = {
  hourly: "Hourly",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
};

/** A toggle pill for host / GPU multi-selection. */
function PillToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {active && <Check className="h-3 w-3" />}
      {children}
    </button>
  );
}

export function AccumulatedUsage() {
  const [time, setTime] = useState<TimeSelection>({ kind: "preset", bucket: "hourly" });
  // Empty set = "all". Multi-select: toggling adds/removes from the set.
  const [hostSel, setHostSel] = useState<Set<string>>(new Set());
  const [gpuSel, setGpuSel] = useState<Set<string>>(new Set());
  const { data, isLoading } = useUsage(time);

  const series = data?.series ?? [];
  const cluster = series.find((s) => s.scope === "cluster");
  const gpuSeries = series.filter((s) => s.scope !== "cluster");

  const hosts = useMemo(
    () => [...new Set(gpuSeries.map((s) => s.scope.split("/")[0]))].sort(),
    [gpuSeries],
  );

  // GPUs available given the host selection (empty host set = all hosts).
  const hostGpus = useMemo(
    () =>
      gpuSeries
        .filter((s) => hostSel.size === 0 || hostSel.has(s.scope.split("/")[0]))
        .sort((a, b) => a.scope.localeCompare(b.scope, undefined, { numeric: true })),
    [gpuSeries, hostSel],
  );

  // Which GPU panels to render: the GPU selection intersected with visible
  // GPUs; empty GPU selection = show all visible.
  const shown = useMemo(
    () => (gpuSel.size === 0 ? hostGpus : hostGpus.filter((s) => gpuSel.has(s.scope))),
    [hostGpus, gpuSel],
  );

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Accumulated usage · per GPU</h2>
        <TimeRangeControls value={time} onChange={setTime} presetLabels={BUCKET_LABELS} />
      </div>

      {cluster && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Whole cluster · utilization &amp; memory{" "}
              <span className="font-normal text-muted-foreground">
                (times in {tzLabel()})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UsageChart series={cluster} />
          </CardContent>
        </Card>
      )}

      {/* host multi-select (drops GPU selections that leave the visible set) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs uppercase tracking-wide text-muted-foreground">
          Host
        </span>
        <PillToggle
          active={hostSel.size === 0}
          onClick={() => {
            setHostSel(new Set());
            setGpuSel(new Set());
          }}
        >
          All hosts
        </PillToggle>
        {hosts.map((h) => (
          <PillToggle
            key={h}
            active={hostSel.has(h)}
            onClick={() => {
              const next = toggle(hostSel, h);
              setHostSel(next);
              // drop any GPU selection no longer visible under the new host set
              setGpuSel(
                (prev) =>
                  new Set(
                    [...prev].filter(
                      (sc) => next.size === 0 || next.has(sc.split("/")[0]),
                    ),
                  ),
              );
            }}
          >
            {h}
          </PillToggle>
        ))}
      </div>

      {/* GPU multi-select */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs uppercase tracking-wide text-muted-foreground">
          GPU
        </span>
        <PillToggle active={gpuSel.size === 0} onClick={() => setGpuSel(new Set())}>
          All
        </PillToggle>
        {hostGpus.map((s) => {
          const [h, g] = s.scope.split("/");
          return (
            <PillToggle
              key={s.scope}
              active={gpuSel.has(s.scope)}
              onClick={() => setGpuSel((prev) => toggle(prev, s.scope))}
            >
              {hostSel.size === 1 ? g : `${h}·${g}`}
            </PillToggle>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {shown.map((s) => (
          <Card key={s.scope}>
            <CardHeader>
              <CardTitle className="text-sm">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageChart series={s} />
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading && series.length === 0 && (
        <p className="text-sm text-muted-foreground">Loading aggregates…</p>
      )}
    </section>
  );
}
