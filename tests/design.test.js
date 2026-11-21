// Design contract checks: DESIGN.md section 9. These keep new tools on the shared system.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { formatBytes } from "../src/core.js";
import { describeSelection } from "../src/dropzone.js";

import { buildPages, buildRoutes } from "./pages.js";

// Every page Vite builds and deploys is checked; a new tool cannot skip these rules.
const pages = buildPages();
const html = Object.fromEntries(pages.map((p) => [p, readFileSync(p, "utf8")]));
const css = readFileSync("src/style.css", "utf8");
const infoCss = readFileSync("public/info.css", "utf8");

function tokens(source) {
  const root = source.match(/:root\s*{([^}]*)}/)[1];
  return Object.fromEntries(
    [...root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const t = tokens(css);

test("formatBytes uses decimal units and never prints 1000.0 KB", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(999), "999 B");
  assert.equal(formatBytes(1000), "1.0 KB");
  assert.equal(formatBytes(999_949), "999.9 KB");
  assert.equal(formatBytes(999_950), "1.00 MB");
  assert.equal(formatBytes(1_000_000), "1.00 MB");
  assert.equal(formatBytes(2_500_000), "2.50 MB");
  assert.equal(formatBytes(Number.NaN), "");
  assert.equal(formatBytes(-1), "");
});

test("selection status names one file, totals several and reports none", () => {
  // Node has no document, so i18n resolves to Chinese.
  assert.equal(describeSelection(null), "未选择文件");
  assert.equal(describeSelection([]), "未选择文件");
  assert.equal(describeSelection([{ name: "a.csv", size: 2500 }]), "a.csv · 2.5 KB");
  assert.equal(
    describeSelection([
      { name: "a.jpg", size: 600_000 },
      { name: "b.jpg", size: 600_000 },
    ]),
    "已选择 2 个文件 · 1.20 MB",
  );
});

test("text and status colour pairs meet WCAG AA (4.5:1)", () => {
  const pairs = [
    ["ink", "paper"],
    ["ink-2", "paper"],
    ["ink-3", "paper"],
    ["ink-3", "surface"],
    ["ink-3", "sunken"],
    ["ink-2", "sunken"],
    ["accent", "paper"],
    ["accent", "accent-tint"],
    ["accent", "surface"],
    ["warn-ink", "paper"],
    ["error-ink", "surface"],
    ["warn-ink", "warn-bg"],
    ["error-ink", "error-bg"],
  ];
  for (const [fg, bg] of pairs) {
    assert.ok(t[fg] && t[bg], `missing token ${fg} or ${bg}`);
    const ratio = contrast(t[fg], t[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
  }
  assert.ok(contrast("#ffffff", t.accent) >= 4.5, "white on accent");
  assert.ok(contrast("#ffffff", t["accent-strong"]) >= 4.5, "white on accent-strong");
});

test("static info pages mirror the shared colour tokens", () => {
  const info = tokens(infoCss);
  for (const name of ["paper", "surface", "line", "ink", "ink-2", "ink-3", "accent", "focus"])
    assert.equal(info[name], t[name], `--${name} differs between style.css and info.css`);
});

test("no font weight above 650 and no rgba backgrounds in the stylesheet", () => {
  for (const m of css.matchAll(/font-weight:\s*(\d+)/g))
    assert.ok(Number(m[1]) <= 650, `font-weight ${m[1]}`);
  assert.doesNotMatch(css, /font-weight:\s*bold/);
  assert.doesNotMatch(css, /background(-color)?:\s*rgba/);
});

test("pages carry no inline styles or third-party fonts (CSP style-src/font-src 'self')", () => {
  for (const [p, s] of Object.entries(html)) {
    assert.doesNotMatch(s, /\sstyle=/i, `${p} has a style attribute`);
    assert.doesNotMatch(s, /<style[\s>]/i, `${p} has a <style> block`);
    assert.doesNotMatch(s, /fonts\.(googleapis|gstatic)|<link[^>]+rel="stylesheet"[^>]+https?:/i, p);
  }
  for (const p of ["public/about.html", "public/about-en.html"])
    assert.doesNotMatch(readFileSync(p, "utf8"), /\sstyle=|<style[\s>]|fonts\.googleapis/i, p);
  assert.doesNotMatch(css + infoCss, /@import|@font-face|url\(\s*["']?https?:/i);
});

test("every page shares the same header and footer for its language", () => {
  for (const [p, s] of Object.entries(html)) {
    const zh = p.startsWith("zh/");
    const header = s.match(/<header class="site-header">([\s\S]*?)<\/header>/);
    assert.ok(header, `${p} lacks .site-header`);
    assert.match(header[1], new RegExp(`class="brand" href="${zh ? "/zh/" : "/"}"`), p);
    assert.match(header[1], zh ? /免费 · 无需注册/ : /Free · No sign-up/, p);
    const sw = header[1].match(/class="language-switch" href="([^"]+)"/);
    assert.ok(sw, `${p} lacks language switch`);
    const target = sw[1].replace(/^\//, "") + "index.html";
    assert.ok(existsSync(target), `${p} switches to missing ${sw[1]}`);
    assert.equal(target, zh ? p.slice(3) : "zh/" + p, `${p} switch is not the counterpart`);
    const footer = s.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/);
    assert.ok(footer, `${p} lacks .site-footer`);
    const links = [...footer[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(links, [
      zh ? "/about.html" : "/about-en.html",
      "https://github.com/NoCloudFiles/nocloudfiles",
      "/third-party-notices.txt",
    ], p);
    assert.match(s, /<link rel="icon" href="\/favicon.svg"/, p);
  }
});

test("each page opens with the shared intro: optional eyebrow, one h1, a lead", () => {
  for (const [p, s] of Object.entries(html)) {
    assert.match(
      s,
      /<section class="intro( compact)?">\s*(<p class="eyebrow">[^<]+<\/p>\s*)?<h1>[\s\S]+?<\/h1>\s*<p class="lead">/,
      p,
    );
    assert.equal((s.match(/<h1>/g) || []).length, 1, `${p} must have one h1`);
  }
});

test("a scope section, when a tool has one, fills both sides", () => {
  // How much to explain is the tool's call (DESIGN.md); an empty half is never useful.
  for (const [p, s] of Object.entries(html)) {
    if (!s.includes('class="section scope"')) continue;
    for (const side of ["scope-does", "scope-not"]) {
      const block = s.match(new RegExp(`class="${side}">([\\s\\S]*?)</ul>`));
      assert.ok(block && /<li>/.test(block[1]), `${p} .${side} is empty`);
    }
  }
});

test("the page list comes from the build entries and covers both languages", () => {
  assert.ok(pages.length >= 16, `only ${pages.length} pages found`);
  for (const p of pages.filter((x) => !x.startsWith("zh/")))
    assert.ok(pages.includes("zh/" + p), `${p} has no Chinese build entry`);
});

test("native file inputs are never shown directly but always have an accessible name", () => {
  for (const [p, s] of Object.entries(html)) {
    for (const m of s.matchAll(/<input\b[^>]*type="file"[^>]*>/g)) {
      const tag = m[0];
      assert.match(tag, /\shidden[\s/>]|class="[^"]*visually-hidden/, `${p}: ${tag}`);
      const id = tag.match(/id="([^"]+)"/)?.[1];
      assert.ok(
        /aria-label="[^"]+"/.test(tag) || new RegExp(`<label[^>]+for="${id}"`).test(s),
        `${p}: file input ${id} has no label`,
      );
    }
  }
});

test("styles load from <head>, never injected by scripts (avoids an unstyled first paint)", () => {
  for (const [p, s] of Object.entries(html)) {
    const head = s.slice(0, s.indexOf("</head>"));
    assert.match(head, /<link rel="stylesheet" href="\/src\/style.css" \/>/, p);
  }
  for (const f of [
    "site.js",
    "csv-ui.js",
    "csv-diff-ui.js",
    "main.js",
    "privacy-ui.js",
    "interleave-ui.js",
    "schedule-ui.js",
    "contacts-ui.js",
    "import-tools.js",
    "page-ui.js",
    "analytics-ui.js",
    "dropzone.js",
  ])
    assert.doesNotMatch(readFileSync("src/" + f, "utf8"), /import\s+["'][^"']+\.css["']/, f);
});

const isHome = (p) => /^(zh\/)?index\.html$/.test(p);
const rows = (s) => [...s.matchAll(/<a class="task-row"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);

test("the home index offers every built tool once, in the page's language", () => {
  for (const home of pages.filter(isHome)) {
    const zh = home.startsWith("zh/");
    const tools = pages.filter((p) => !isHome(p) && p.startsWith("zh/") === zh);
    const homeRows = rows(html[home]);
    assert.equal(homeRows.length, tools.length, `${home} lists ${homeRows.length} of ${tools.length} tools`);
    for (const tool of tools) {
      const href = "/" + tool.replace(/index\.html$/, "");
      const row = homeRows.find((r) => r.includes(`href="${href}"`));
      assert.ok(row, `${home} has no row for ${href}`);
      const id = html[tool].match(/<html lang="[^"]+" data-tool="([^"]+)"/)[1];
      assert.match(row, new RegExp(`data-tool="${id}"`), `${href} row must report tool ${id}`);
      for (const part of ["task-need", "task-get", "task-meta"])
        assert.match(row, new RegExp(`class="${part}">[^<]+<`), `${href} row lacks ${part}`);
    }
  }
});

test("each tool page's other-tools list matches its home index, minus itself", () => {
  for (const tool of pages.filter((p) => !isHome(p))) {
    const home = tool.startsWith("zh/") ? "zh/index.html" : "index.html";
    const self = "/" + tool.replace(/index\.html$/, "");
    const section = html[tool].match(/<section class="section more-tools">([\s\S]*?)<\/section>/);
    assert.ok(section, `${tool} has no other-tools section`);
    assert.deepEqual(
      rows(section[1]),
      rows(html[home]).filter((r) => !r.includes(`href="${self}"`)),
      `${tool} other tools drifted from ${home}`,
    );
  }
});

test("each tool page states what you need, what you get and where files go", () => {
  for (const tool of pages.filter((p) => !isHome(p))) {
    const brief = html[tool].match(/<dl class="brief">([\s\S]*?)<\/dl>/);
    assert.ok(brief, `${tool} has no brief`);
    assert.equal((brief[1].match(/<dt>[^<]+<\/dt><dd>[\s\S]+?<\/dd>/g) || []).length, 3, tool);
    // The brief sits directly under the intro, before any step.
    assert.ok(html[tool].indexOf('class="brief"') < html[tool].indexOf('class="step"'), tool);
  }
});

test("in-page links point at existing help", () => {
  for (const [p, s] of Object.entries(html))
    for (const m of s.matchAll(/href="#([^"]+)"/g))
      assert.match(s, new RegExp(`id="${m[1]}"`), `${p} links to missing #${m[1]}`);
});

test("sitemap.xml matches buildRoutes() 1-to-1", () => {
  const xml = readFileSync("public/sitemap.xml", "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const expected = buildRoutes().map((r) => "https://nocloudfiles.com" + r).sort();
  assert.deepEqual(locs, expected);
});

test("package-source.py includes DESIGN.md and every top-level tool directory from vite.config.js", () => {
  const py = readFileSync("scripts/package-source.py", "utf8");
  assert.match(py, /['"]DESIGN\.md['"]/);
  const topDirs = [...new Set(pages.map((p) => p.split("/")[0]).filter((d) => d !== "index.html"))];
  for (const dir of topDirs) {
    assert.match(py, new RegExp(`['"]${dir}['"]`), `package-source.py is missing directory ${dir}`);
  }
});

// Layout: one content width per page (DESIGN.md "Widths").
test("single-column tools use the narrow column; two-column tools and home use the full one", () => {
  for (const [p, s] of Object.entries(html)) {
    const singleColumn = /class="(import-layout|privacy-layout)\b/.test(s);
    const narrow = /<main class="column-narrow">/.test(s);
    assert.equal(narrow, singleColumn, `${p}: <main class="column-narrow"> iff the workspace is one column`);
  }
  assert.match(css, /main > :not\(\.intro\)\s*{\s*max-width: var\(--column\);/);
  for (const block of [".brief", ".more-tools", ".privacy-layout", ".import-layout"]) {
    const rule = css.match(new RegExp(`\\n${block.replace(".", "\\.")} {([^}]*)}`));
    assert.ok(!rule || !/max-width/.test(rule[1]), `${block} must not set its own max-width`);
  }
});

// Copy: plain wording rules (DESIGN.md "Writing").
const visibleText = (s) =>
  s
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "");
const copyPages = { ...html, "public/about.html": readFileSync("public/about.html", "utf8"), "public/about-en.html": readFileSync("public/about-en.html", "utf8") };

test("visible copy avoids dashes as clause breaks, binary units and defensive 'silently' wording", () => {
  for (const [p, s] of Object.entries(copyPages)) {
    const text = visibleText(s);
    assert.doesNotMatch(text, /—/, `${p}: use a comma or a new sentence instead of a dash`);
    assert.doesNotMatch(text, /\bMiB\b/, `${p}: show limits in MB`);
    assert.doesNotMatch(text, /silently|悄悄|偷偷/, `${p}: state what happens instead`);
  }
});

test("the privacy promise appears once per tool page, in the brief, not again inside a step", () => {
  for (const [p, s] of Object.entries(html)) {
    assert.doesNotMatch(s, /class="local-note"><svg/, `${p}: drop the in-step privacy box; the brief says it`);
  }
});

test("every sample button uses one label per language", () => {
  for (const [p, s] of Object.entries(html)) {
    const zh = p.startsWith("zh/");
    for (const m of s.matchAll(/<button[^>]*id="(?:sample|example|csv-example|diff-sample)"[^>]*>([^<]+)</g))
      assert.equal(m[1], zh ? "试用示例" : "Try a sample", p);
  }
});
