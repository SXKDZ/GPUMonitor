import type { Metadata } from "next";
import "./globals.css";
import { RefreshProvider } from "@/lib/refresh";

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_TITLE || "GPUMonitor",
  description:
    "Live GPU utilization & memory across a cluster, with an idle-guard",
};

// Applied before paint to avoid a flash of the wrong theme. Reads the saved
// choice ("light"/"dark"/"system"); "system" (default) follows the OS setting.
const themeInit = `
(function () {
  try {
    var t = localStorage.getItem("theme") || "system";
    var dark = t === "dark" ||
      (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <RefreshProvider>{children}</RefreshProvider>
      </body>
    </html>
  );
}
