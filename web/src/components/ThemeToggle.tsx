"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";

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

  function choose(next: Theme) {
    setTheme(next);
    localStorage.setItem("theme", next);
    apply(next);
  }

  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;

  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
      {mounted ? <Icon className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
      <select
        value={mounted ? theme : "system"}
        onChange={(e) => choose(e.target.value as Theme)}
        aria-label="Theme"
        className="bg-transparent text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
