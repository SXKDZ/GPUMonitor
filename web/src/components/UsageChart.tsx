"use client";
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageSeries } from "@/lib/contract";
import { fmtBucketTick } from "@/lib/utils";
import { useIsDark } from "@/lib/useIsDark";

/**
 * Dual-axis chart for one aggregated series:
 *   left  y-axis: mean utilization (%), 0-100
 *   right y-axis: mean memory used (GB), 0..GPU capacity
 */
export function UsageChart({ series }: { series: UsageSeries }) {
  const dark = useIsDark();
  // Neutral chrome adapts to theme; the util (blue) / mem (purple) data colors
  // read well on both backgrounds.
  const grid = dark ? "hsl(220 16% 20%)" : "hsl(214 22% 86%)";
  const axis = dark ? "hsl(220 16% 30%)" : "hsl(214 20% 75%)";
  const tickMuted = dark ? "hsl(215 15% 60%)" : "hsl(215 16% 42%)";
  const tooltipBg = dark ? "hsl(222 20% 11%)" : "hsl(0 0% 100%)";
  const tooltipBorder = dark ? "hsl(220 16% 20%)" : "hsl(214 22% 86%)";

  const data = series.points.map((p) => ({
    t: p.t,
    util: p.util_mean,
    mem: p.mem_used_gb_mean,
  }));

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No data yet for this range — collecting…
      </div>
    );
  }

  // right-axis top: round GPU memory capacity up to a sensible bound
  const memTotalGb = (series.points[0]?.mem_total ?? 0) / 1024;
  const memMax = Math.max(...data.map((d) => d.mem), memTotalGb || 1);
  const memDomainTop = Math.ceil(memMax / 10) * 10 || 10;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="gUtil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(199 89% 58%)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="hsl(199 89% 58%)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={(t) => fmtBucketTick(t, series.bucket)}
          tick={{ fontSize: 11, fill: tickMuted }}
          minTickGap={28}
          stroke={axis}
        />
        <YAxis
          yAxisId="util"
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: dark ? "hsl(199 80% 65%)" : "hsl(199 80% 38%)" }}
          stroke={axis}
          unit="%"
          width={44}
        />
        <YAxis
          yAxisId="mem"
          orientation="right"
          domain={[0, memDomainTop]}
          tick={{ fontSize: 11, fill: dark ? "hsl(280 70% 72%)" : "hsl(280 55% 48%)" }}
          stroke={axis}
          unit=" GB"
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: tooltipBg,
            border: `1px solid ${tooltipBorder}`,
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(t) => fmtBucketTick(Number(t), series.bucket)}
          formatter={(v: number, n) =>
            n === "Utilization (mean)" ? [`${v}%`, n] : [`${v} GB`, n]
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          yAxisId="util"
          type="monotone"
          dataKey="util"
          name="Utilization (mean)"
          stroke="hsl(199 89% 58%)"
          fill="url(#gUtil)"
          strokeWidth={2}
        />
        <Line
          yAxisId="mem"
          type="monotone"
          dataKey="mem"
          name="Memory (mean)"
          stroke="hsl(280 70% 68%)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
