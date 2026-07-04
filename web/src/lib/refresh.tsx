"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

/** Auto-refresh interval in ms; 0 means paused. Shared by all polling hooks. */
const RefreshCtx = createContext<{
  refreshMs: number;
  setRefreshMs: (ms: number) => void;
}>({ refreshMs: 10_000, setRefreshMs: () => {} });

export const REFRESH_OPTIONS: { label: string; ms: number }[] = [
  { label: "5s", ms: 5_000 },
  { label: "10s", ms: 10_000 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
];

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshMs, setRefreshMs] = useState(10_000);
  return (
    <RefreshCtx.Provider value={{ refreshMs, setRefreshMs }}>
      {children}
    </RefreshCtx.Provider>
  );
}

/** Interval to hand SWR: the shared value, or 0 (off) when paused. */
export function useRefreshMs(): number {
  return useContext(RefreshCtx).refreshMs;
}

export function useRefreshControl() {
  return useContext(RefreshCtx);
}
