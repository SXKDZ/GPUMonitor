import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Current time in epoch seconds (client-safe; data.ts has a server variant). */
export function nowSecClient(): number {
  return Math.floor(Date.now() / 1000);
}

/** Utilization color ramp: red (idle) -> amber -> green (busy). */
export function utilColor(pct: number | null): string {
  if (pct === null) return "hsl(215 15% 45%)";
  if (pct <= 5) return "hsl(0 72% 55%)";
  if (pct < 40) return "hsl(38 92% 55%)";
  return "hsl(142 71% 45%)";
}

export function fmtBytesMiB(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GiB`;
  return `${mib} MiB`;
}

export function fmtAge(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

/** Format a bucket-start epoch (seconds) for an axis tick, given the
 * granularity ("hourly" | "daily" | "weekly" | "monthly"). */
export function fmtBucketTick(t: number, granularity: string): string {
  const d = new Date(t * 1000);
  if (granularity === "hourly") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (granularity === "monthly") {
    return d.toLocaleDateString([], { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** YYYY-MM-DD (local) for <input type="date"> values. */
export function toDateInput(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parse a YYYY-MM-DD date input into epoch seconds at local midnight;
 * endOfDay=true snaps to 23:59:59 of that day. */
export function fromDateInput(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59)
    : new Date(y, m - 1, d, 0, 0, 0);
  return Math.floor(dt.getTime() / 1000);
}
