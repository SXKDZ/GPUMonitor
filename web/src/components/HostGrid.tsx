"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { LiveStatus, LiveGpu } from "@/lib/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, fmtBytesMiB, fmtAge, utilColor } from "@/lib/utils";

/** One labelled meter row (used for both the utilization and memory rows). */
function MeterRow({
  label,
  pct,
  color,
  value,
}: {
  label: string;
  pct: number;
  color: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }}
        />
      </div>
      <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

function GpuBadge({ gpu, enforce }: { gpu: LiveGpu; enforce: boolean }) {
  const util = gpu.util_pct;
  const idleOccupied = gpu.occupied && util !== null && util <= 5;
  if (gpu.kill_candidate) {
    return enforce ? (
      <Badge variant="danger">killed</Badge>
    ) : (
      <Badge variant="warn">would-kill</Badge>
    );
  }
  if (idleOccupied) {
    return (
      <Badge variant="warn" title={`idle ${Math.round(gpu.idle_frac_5m * 100)}% of 5m window`}>
        idle {Math.round(gpu.idle_frac_5m * 100)}%
      </Badge>
    );
  }
  if (gpu.occupied) return <Badge variant="ok">busy</Badge>;
  return <Badge variant="muted">free</Badge>;
}

function GpuRow({ gpu, enforce }: { gpu: LiveGpu; enforce: boolean }) {
  const [open, setOpen] = useState(false);
  const util = gpu.util_pct;
  const users =
    gpu.procs.length > 0
      ? [...new Set(gpu.procs.map((p) => p.user))].join(", ")
      : null;
  return (
    <div className="py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[2.2rem_1fr_auto] items-center gap-2 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <ChevronRight
            className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
          />
          #{gpu.index}
        </div>
        <div className="min-w-0 space-y-1">
          {/* row 1: utilization */}
          <MeterRow
            label="Util"
            pct={util ?? 0}
            color={utilColor(util)}
            value={util === null ? "n/a" : `${util}%`}
          />
          {/* row 2: GPU memory */}
          <MeterRow
            label="Mem"
            pct={gpu.mem_pct}
            color="hsl(280 70% 68%)"
            value={`${fmtBytesMiB(gpu.mem_used_mib)} / ${fmtBytesMiB(gpu.mem_total_mib)}`}
          />
          {users && (
            <div className="truncate pl-10 text-[11px] text-muted-foreground">
              {gpu.procs.length} proc{gpu.procs.length > 1 ? "s" : ""}: {users}
            </div>
          )}
        </div>
        <div className="justify-self-end">
          <GpuBadge gpu={gpu} enforce={enforce} />
        </div>
      </button>

      {open && (
        <div className="mt-2 rounded-md border border-border/70 bg-muted/30 p-2 text-xs">
          <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
            <span>{gpu.name}</span>
            <span>idle {Math.round(gpu.idle_frac_5m * 100)}% of 5-min window</span>
            <span>mem {gpu.mem_pct}%</span>
          </div>
          {gpu.procs.length === 0 ? (
            <div className="text-muted-foreground">No compute processes.</div>
          ) : (
            <table className="w-full table-fixed">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-[4.5rem] pb-1 pr-3 font-medium">PID</th>
                  <th className="w-20 pb-1 pr-3 font-medium">User</th>
                  <th className="pb-1 pr-3 font-medium">Process</th>
                  <th className="w-20 pb-1 text-right font-medium">Memory</th>
                </tr>
              </thead>
              <tbody>
                {gpu.procs.map((p) => (
                  <tr key={p.pid} className="border-t border-border/40 align-top">
                    <td className="py-1 pr-3 font-mono tabular-nums">{p.pid}</td>
                    <td className="truncate py-1 pr-3" title={p.user}>{p.user}</td>
                    <td className="break-all py-1 pr-3 font-mono" title={p.name}>
                      {p.name}
                    </td>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums">
                      {fmtBytesMiB(p.mem_mib)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function HostGrid({ hosts, stale, now }: {
  hosts: LiveStatus[];
  stale: string[];
  now: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {hosts.map((h) => {
        const isStale = stale.includes(h.host);
        const busy = h.gpus.filter((g) => (g.util_pct ?? 0) > 5).length;
        return (
          <Card key={h.host} className={cn(isStale && "opacity-60")}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="font-mono">{h.host}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {h.gpus.length}× {h.gpus[0]?.name.replace("NVIDIA ", "") ?? "GPU"}
                </span>
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {h.enforce ? (
                  <Badge variant="danger">enforce</Badge>
                ) : (
                  <Badge variant="muted">dry-run</Badge>
                )}
                <Badge variant={busy > 0 ? "ok" : "muted"}>{busy}/{h.gpus.length} busy</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border/60">
                {[...h.gpus]
                  .sort((a, b) => a.index - b.index)
                  .map((g) => (
                    <GpuRow key={g.uuid} gpu={g} enforce={h.enforce} />
                  ))}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>driver {h.driver} · CUDA {h.cuda}</span>
                <span className={cn(isStale && "text-amber-400")}>
                  {isStale ? "STALE · " : ""}
                  {fmtAge(now - h.ts)}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
