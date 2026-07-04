"use client";
import { useState } from "react";
import { Check, Github } from "lucide-react";
import { useOverview } from "@/lib/client";
import { HostGrid } from "@/components/HostGrid";
import { AccumulatedUsage } from "@/components/AccumulatedUsage";
import { UserStats } from "@/components/UserStats";
import { EventsLog } from "@/components/EventsLog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { RefreshControl } from "@/components/RefreshControl";
import { Card, CardContent } from "@/components/ui/card";
import { cn, fmtBytesMiB } from "@/lib/utils";

function HostPill({
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function Page() {
  const { data } = useOverview();
  const hosts = data?.hosts ?? [];
  const now = data?.generatedAt ?? Math.floor(Date.now() / 1000);

  const [hostSel, setHostSel] = useState<Set<string>>(new Set());
  const hostNames = hosts.map((h) => h.host);
  const shownHosts =
    hostSel.size === 0 ? hosts : hosts.filter((h) => hostSel.has(h.host));

  const allGpus = hosts.flatMap((h) => h.gpus);
  const totalGpus = allGpus.length;
  const busyGpus = allGpus.filter((g) => (g.util_pct ?? 0) > 5).length;
  const idleOccupied = allGpus.filter(
    (g) => g.occupied && (g.util_pct ?? 0) <= 5,
  ).length;
  const memUsed = allGpus.reduce((a, g) => a + g.mem_used_mib, 0);
  const memTotal = allGpus.reduce((a, g) => a + g.mem_total_mib, 0);
  const avgUtil =
    totalGpus > 0
      ? Math.round(
          allGpus.reduce((a, g) => a + (g.util_pct ?? 0), 0) / totalGpus,
        )
      : 0;

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {process.env.NEXT_PUBLIC_TITLE || "GPUMonitor"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Live GPU utilization &amp; memory · idle-guard reclaims stalled GPUs
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{hosts.length} hosts</span>
          <RefreshControl />
          <ThemeToggle />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="GPUs" value={`${totalGpus}`} sub={`${hosts.length} hosts`} />
        <Stat label="Busy now" value={`${busyGpus}`} sub={`of ${totalGpus}`} />
        <Stat label="Avg util" value={`${avgUtil}%`} sub="cluster mean" />
        <Stat
          label="Idle-but-held"
          value={`${idleOccupied}`}
          sub="guard candidates"
        />
        <Stat
          label="Memory"
          value={`${Math.round((memUsed / (memTotal || 1)) * 100)}%`}
          sub={`${fmtBytesMiB(memUsed)} / ${fmtBytesMiB(memTotal)}`}
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Live status</h2>
          {hostNames.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <HostPill
                active={hostSel.size === 0}
                onClick={() => setHostSel(new Set())}
              >
                All
              </HostPill>
              {hostNames.map((h) => (
                <HostPill
                  key={h}
                  active={hostSel.has(h)}
                  onClick={() =>
                    setHostSel((prev) => {
                      const next = new Set(prev);
                      if (next.has(h)) next.delete(h);
                      else next.add(h);
                      return next;
                    })
                  }
                >
                  {h}
                </HostPill>
              ))}
            </div>
          )}
        </div>
        <HostGrid hosts={shownHosts} stale={data?.stale ?? []} now={now} />
      </section>

      <AccumulatedUsage />

      <UserStats />

      <EventsLog />

      <footer className="flex flex-col items-center gap-2 pt-4 text-center text-xs text-muted-foreground">
        <a
          href="https://github.com/SXKDZ/GPUMonitor"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <Github className="h-4 w-4" />
          SXKDZ/GPUMonitor
        </a>
      </footer>
    </main>
  );
}
