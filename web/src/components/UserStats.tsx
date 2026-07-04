"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useUsers, useOverview, type TimeSelection } from "@/lib/client";
import { type Bucket, type UserUsage } from "@/lib/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TimeRangeControls } from "@/components/TimeRangeControls";

const BUCKET_LABELS: Record<Bucket, string> = {
  hourly: "Last 48h",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
};

function UserRow({ u, maxGpuHours }: { u: UserUsage; maxGpuHours: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="cursor-pointer border-t border-border/50 hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="py-1.5 pr-3 font-medium">
          <span className="flex items-center gap-1">
            <ChevronRight
              className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
            />
            {u.user}
          </span>
        </td>
        <td className="py-1.5 pr-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(u.gpu_hours / maxGpuHours) * 100}%` }}
              />
            </div>
            <span className="tabular-nums">{u.gpu_hours}</span>
          </div>
        </td>
        <td className="hidden py-1.5 pr-3 tabular-nums sm:table-cell">
          {u.util_mean}%
        </td>
        <td className="py-1.5 pr-3 tabular-nums">{u.mem_gib_hours}</td>
        <td className="hidden py-1.5 pr-3 tabular-nums md:table-cell">
          {u.mem_used_max_gib} GB
        </td>
        <td className="hidden py-1.5 lg:table-cell">
          <div className="flex flex-wrap gap-1">
            {u.hosts.map((h) => (
              <Badge key={h} variant="muted">
                {h}
              </Badge>
            ))}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border/30 bg-muted/20">
          <td colSpan={6} className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Per-host breakdown
            </div>
            <table className="mt-1 w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-1 pr-4 font-medium">Host</th>
                  <th className="pb-1 pr-4 font-medium">GPU-hours</th>
                  <th className="pb-1 pr-4 font-medium">Avg util</th>
                  <th className="pb-1 pr-4 font-medium">Mem (GB·h)</th>
                  <th className="pb-1 font-medium">Peak mem</th>
                </tr>
              </thead>
              <tbody>
                {u.byHost.map((h) => (
                  <tr key={h.host}>
                    <td className="py-0.5 pr-4 font-mono">{h.host}</td>
                    <td className="py-0.5 pr-4 tabular-nums">{h.gpu_hours}</td>
                    <td className="py-0.5 pr-4 tabular-nums">{h.util_mean}%</td>
                    <td className="py-0.5 pr-4 tabular-nums">{h.mem_gib_hours}</td>
                    <td className="py-0.5 tabular-nums">{h.mem_used_max_gib} GB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export function UserStats() {
  const [time, setTime] = useState<TimeSelection>({ kind: "preset", bucket: "weekly" });
  const { data, isLoading } = useUsers(time);
  const earliest = useOverview().data?.earliest ?? null;
  const users = data?.users ?? [];
  const maxGpuHours = Math.max(1, ...users.map((u) => u.gpu_hours));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Per-user usage</h2>
        <TimeRangeControls
          value={time}
          onChange={setTime}
          presetLabels={BUCKET_LABELS}
          earliest={earliest}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            GPU-hours &amp; memory by user · click a row for detail
          </CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isLoading ? "Loading…" : "No per-user usage recorded yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">User</th>
                    <th className="pb-2 pr-3 font-medium">GPU-hours</th>
                    <th className="hidden pb-2 pr-3 font-medium sm:table-cell">
                      Avg util
                    </th>
                    <th className="pb-2 pr-3 font-medium">Mem (GB·h)</th>
                    <th className="hidden pb-2 pr-3 font-medium md:table-cell">
                      Peak mem
                    </th>
                    <th className="hidden pb-2 font-medium lg:table-cell">Hosts</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <UserRow key={u.user} u={u} maxGpuHours={maxGpuHours} />
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                GPU-hours = Σ (GPUs held × time). A GPU&apos;s utilization is
                credited to every user occupying it, so shared-GPU util may
                double-count; memory is per-process.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
