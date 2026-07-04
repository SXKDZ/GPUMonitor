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

/**
 * Timezone all times are displayed in. Set NEXT_PUBLIC_TZ (an IANA name such
 * as "America/Los_Angeles") to pin the dashboard to the cluster's timezone;
 * leave it unset to use each viewer's own browser timezone. Pinning avoids the
 * confusion of the same UTC bucket reading as a different clock time depending
 * on where the viewer sits.
 */
export const DISPLAY_TZ: string | undefined =
  process.env.NEXT_PUBLIC_TZ || undefined;

/** Short label for the active display timezone, e.g. "PDT" or "local". */
export function tzLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: DISPLAY_TZ,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "local";
  } catch {
    return "local";
  }
}

/** Format a bucket-start epoch (seconds) for an axis tick, given the
 * granularity ("hourly" | "daily" | "weekly" | "monthly"). */
export function fmtBucketTick(t: number, granularity: string): string {
  const d = new Date(t * 1000);
  const tz = DISPLAY_TZ;
  if (granularity === "hourly") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz });
  }
  if (granularity === "monthly") {
    return d.toLocaleDateString([], { month: "short", year: "2-digit", timeZone: tz });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", timeZone: tz });
}

/** Wall-clock fields of an instant, evaluated in the display timezone. */
function partsInTz(epochSec: number) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(epochSec * 1000)).map((x) => [x.type, x.value]),
  );
  // "24" hour can appear at midnight in some engines; normalize to "00".
  const hh = p.hour === "24" ? "00" : p.hour;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +hh, mi: +p.minute };
}

/** Offset (seconds) of the display tz at a given instant: local - UTC. */
function tzOffsetSec(epochSec: number): number {
  const f = partsInTz(epochSec);
  const asUtc = Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi) / 1000;
  return asUtc - Math.floor(epochSec / 60) * 60;
}

/** "YYYY-MM-DDTHH:MM" in the display tz, for <input type="datetime-local">. */
export function toDateTimeInput(epochSec: number): string {
  const f = partsInTz(epochSec);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${f.y}-${p(f.mo)}-${p(f.d)}T${p(f.h)}:${p(f.mi)}`;
}

/** Parse "YYYY-MM-DDTHH:MM" (wall-clock in the display tz) into epoch seconds. */
export function fromDateTimeInput(value: string): number | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Interpret the fields as UTC, then correct by the tz offset at that instant.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi) / 1000;
  const off = tzOffsetSec(asUtc);
  return Math.floor(asUtc - off);
}

/** Reassemble wall-clock fields (in the display tz) into epoch seconds. */
function composeEpoch(date: string, hour24: number, minute: number): number | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, hour24, minute) / 1000;
  return Math.floor(asUtc - tzOffsetSec(asUtc));
}

/** 12-hour clock components of an instant, in the display tz. */
export type ClockParts = { date: string; hour12: number; minute: number; ampm: "AM" | "PM" };

export function toClockParts(epochSec: number): ClockParts {
  const f = partsInTz(epochSec);
  const p = (n: number) => String(n).padStart(2, "0");
  const ampm: "AM" | "PM" = f.h >= 12 ? "PM" : "AM";
  const hour12 = f.h % 12 === 0 ? 12 : f.h % 12;
  return { date: `${f.y}-${p(f.mo)}-${p(f.d)}`, hour12, minute: f.mi, ampm };
}

/** Build epoch seconds from 12-hour clock components (in the display tz). */
export function fromClockParts(c: ClockParts): number | null {
  let h24 = c.hour12 % 12;
  if (c.ampm === "PM") h24 += 12;
  return composeEpoch(c.date, h24, c.minute);
}
