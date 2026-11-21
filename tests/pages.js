// The deployable page list, read from Vite's build entries so tests follow new tools automatically.
import { readFileSync } from "node:fs";
export function buildPages() {
  const config = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
  const pages = [...config.matchAll(/:\s*'([^']+\/)?index\.html'/g)].map((m) => (m[1] ?? "") + "index.html");
  if (!pages.length) throw Error("No build entries found in vite.config.js");
  return [...new Set(pages)].sort();
}
export const buildRoutes = () =>
  buildPages().map((p) => "/" + p.replace(/index\.html$/, ""));
