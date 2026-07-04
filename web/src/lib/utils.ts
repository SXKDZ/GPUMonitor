import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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

/** Format a bucket-start epoch (seconds) for an axis tick, given the bucket. */
export function fmtBucketTick(t: number, bucket: string): string {
  const d = new Date(t * 1000);
  if (bucket === "hourly") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
