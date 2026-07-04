"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";
const ORDER: Theme[] = ["system", "light", "dark"];

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  // Read the persisted choice once on mount (matches the no-FOUC head script).
  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Theme) || "system";
    setTheme(saved);
    setMounted(true);
  }, []);

  // When following the system, re-apply if the OS setting flips live.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    localStorage.setItem("theme", next);
    apply(next);
  }

  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  const label = theme[0].toUpperCase() + theme.slice(1);

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${label} (click to change)`}
      aria-label={`Theme: ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border",
        "bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground",
        "transition-colors hover:text-foreground",
      )}
    >
      {/* Render icon only after mount to avoid a hydration mismatch. */}
      {mounted ? <Icon className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
      <span className="hidden sm:inline">{mounted ? label : "System"}</span>
    </button>
  );
}
