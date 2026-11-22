// Real-browser checks for the shared design system (DESIGN.md section 9).
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { buildRoutes } from "../pages.js";

const pages = buildRoutes();

// Drop files onto an element the way a browser drag-and-drop does.
async function dropFiles(page, selector, files) {
  const handle = await page.evaluateHandle(
    async (list) => {
      const dt = new DataTransfer();
      for (const { name, type, base64 } of list) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], name, { type }));
      }
      return dt;
    },
    files.map((f) => ({ ...f, base64: Buffer.from(f.buffer).toString("base64") })),
  );
  for (const type of ["dragenter", "dragover", "drop"])
    await page.dispatchEvent(selector, type, { dataTransfer: handle });
}

test("no page scrolls sideways at phone width, including with results shown", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of pages) {
    await page.goto(path);
    if (path.includes("csv-check")) {
      await page.locator("#csv-example").click();
      await page.locator("#csv-check").click();
      await expect(page.locator("#csv-download")).toBeVisible();
    }
    if (path.includes("csv-diff")) {
      await page.locator("#diff-sample").click();
      await expect(page.locator("#diff-key1")).not.toHaveValue("");
      await page.locator("#diff-compare").click();
      await expect(page.locator("#diff-download")).toBeVisible();
    }
    if (path.includes("interleave-pdf")) {
      await page.locator("#sample").click();
      await expect(page.locator("#combine")).toBeEnabled();
      await page.locator("#combine").click();
      await expect(page.locator("#download")).toBeVisible();
    }
    if (path.includes("photos-to-pdf")) {
      await page.locator("#example").click();
      await expect(page.locator(".photo")).toHaveCount(3);
    }
    if (path.includes("schedule-to-calendar")) {
      await page.locator("#sample").click();
      await page.locator("#map").click();
      await page.locator("#review").click();
      await expect(page.locator("#links a").first()).toBeVisible();
    }
    if (path.includes("vcf-select")) {
      await page.locator("#sample").click();
      await expect(page.locator("#choose")).toBeVisible();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
    const weights = await page.evaluate(() =>
      [...document.querySelectorAll("h1,h2,h3")].map((h) => Number(getComputedStyle(h).fontWeight)),
    );
    expect(weights.length, path).toBeGreaterThan(0);
    for (const w of weights) expect(w, path).toBeLessThanOrEqual(650);
  }
});

test("a CSV dropped on the drop zone loads like a chosen file", async ({ page }) => {
  await page.goto("/csv-check/");
  await expect(page.locator("#csv-file-status")).toHaveText("No file selected");
  await dropFiles(page, "#csv-drop", [
    { name: "orders.csv", type: "text/csv", buffer: "id,qty\n007,2\n" },
  ]);
  await expect(page.locator("#csv-input")).toHaveValue("id,qty\n007,2\n");
  await expect(page.locator("#csv-file-status")).toHaveText("orders.csv · 13 B");
  await expect(page.locator("#csv-drop")).not.toHaveClass(/dragover/);
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.locator("#csv-download").click();
  expect(await readFile(await (await download).path(), "utf8")).toContain("007");
  await page.getByRole("button", { name: "Clear input", exact: true }).click();
  await expect(page.locator("#csv-file-status")).toHaveText("No file selected");
});

test("dropping several files on a single-file input keeps only the first", async ({ page }) => {
  await page.goto("/csv-check/");
  await dropFiles(page, "#csv-drop", [
    { name: "first.csv", type: "text/csv", buffer: "a,b\n1,2" },
    { name: "second.csv", type: "text/csv", buffer: "x,y\n9,9" },
  ]);
  await expect(page.locator("#csv-input")).toHaveValue("a,b\n1,2");
  await expect(page.locator("#csv-file-status")).toHaveText(/^first\.csv/);
});

test("a file dropped beside the drop zone does not replace the page or the input", async ({ page }) => {
  await page.goto("/csv-check/");
  await page.locator("#csv-input").fill("keep,me\n1,2");
  await dropFiles(page, "h1", [{ name: "x.csv", type: "text/csv", buffer: "x" }]);
  await expect(page).toHaveURL(/\/csv-check\/$/);
  await expect(page.locator("#csv-input")).toHaveValue("keep,me\n1,2");
});

test("without DataTransfer support the drop zone explains the fallback", async ({ page }) => {
  await page.goto("/csv-check/");
  // Build the dropped files first, then make the constructor fail the way older browsers do.
  const handle = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["a,b"], "a.csv", { type: "text/csv" }));
    window.DataTransfer = function () {
      throw new TypeError("unsupported");
    };
    return dt;
  });
  for (const type of ["dragenter", "dragover", "drop"])
    await page.dispatchEvent("#csv-drop", type, { dataTransfer: handle });
  await expect(page.locator("#csv-file-status")).toContainText("Use the button instead");
  await expect(page.locator("#csv-input")).toHaveValue("");
});

test("a photo dropped on the privacy drop zone starts the same inspection", async ({ page }) => {
  await page.goto("/photo-privacy/");
  await dropFiles(page, "#photo-drop", [
    {
      name: "private-original.jpg",
      type: "image/jpeg",
      buffer: await readFile("tests/fixtures/private-original.jpg"),
    },
  ]);
  await expect(page.getByRole("button", { name: "Create private copy" })).toBeEnabled();
  await expect(page.locator("#photo-file-status")).toHaveText(/^private-original\.jpg · /);
  await expect(page.locator(".found li").first()).toBeVisible();
});

test("a rejected photo is shown as an error state", async ({ page }) => {
  await page.goto("/photo-privacy/");
  await page.locator("#photo").setInputFiles({
    name: "not-a-photo.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("plain text"),
  });
  await expect(page.locator("#status")).toHaveAttribute("data-state", "error");
  await page.locator("#photo").setInputFiles("tests/fixtures/private-original.jpg");
  await expect(page.getByRole("button", { name: "Create private copy" })).toBeEnabled();
  await expect(page.locator("#status")).not.toHaveAttribute("data-state", "error");
});

test("CSV result metrics show the detected separator and error count", async ({ page }) => {
  await page.goto("/csv-check/");
  await page.getByRole("button", { name: "Try a sample", exact: true }).click();
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  const metrics = page.locator("#csv-metrics .metric");
  await expect(metrics).toHaveCount(5);
  await expect(metrics.nth(2)).toContainText("semicolon");
  await expect(metrics.nth(3)).toContainText("0");
  await expect(page.locator("#csv-result")).not.toHaveClass(/has-errors/);
  await page.locator("#csv-input").fill("a,b\n1,2,3");
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-result")).toHaveClass(/has-errors/);
  await expect(metrics.nth(3).locator("b")).not.toHaveText("0");
});

test("keyboard focus reaches the hidden file input and outlines its button", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "WebKit skips non-text controls on Tab by default");
  await page.goto("/csv-check/");
  await page.locator("#csv-file").focus();
  await expect(page.locator("#csv-file")).toBeFocused();
  const outline = await page
    .locator('label[for="csv-file"]')
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe("solid");
});

test("a dropped file is reported as the user's own input, not the example", async ({ page }) => {
  await page.route("https://www.googletagmanager.com/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/csv-check/");
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await page.getByRole("button", { name: "Try a sample", exact: true }).click();
  await dropFiles(page, "#csv-drop", [
    { name: "secret-orders.csv", type: "text/csv", buffer: "id,qty\n0099,1" },
  ]);
  await expect(page.locator("#csv-input")).toHaveValue("id,qty\n0099,1");
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-download")).toBeVisible();
  const events = await page.evaluate(() =>
    window.dataLayer.filter((x) => x[0] === "event").map((x) => [x[1], x[2]]),
  );
  expect(events.find((x) => x[0] === "csv_checked")[1]).toMatchObject({
    tool_id: "csv_check",
    input_source: "file",
  });
  expect(JSON.stringify(events)).not.toMatch(/secret-orders|0099/);
});

// Dispatch a cancelable drop carrying either text or a file; report whether the page cancelled it.
async function dropIsCancelled(page, selector, kind) {
  return page.evaluate(
    ({ selector, kind }) => {
      const dt = new DataTransfer();
      if (kind === "text") dt.setData("text/plain", "00123,4.50");
      else dt.items.add(new File(["a,b"], "x.csv", { type: "text/csv" }));
      const target = document.querySelector(selector);
      const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt });
      target.dispatchEvent(over);
      const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      target.dispatchEvent(drop);
      return { over: over.defaultPrevented, drop: drop.defaultPrevented };
    },
    { selector, kind },
  );
}

for (const [path, field] of [
  ["/csv-check/", "#csv-input"],
  ["/csv-diff/", "#before-input"],
  ["/interleave-pdf/", "#filename"],
  ["/schedule-to-calendar/", "#table"],
  ["/photos-to-pdf/", "#filename"],
]) {
  test(`dragging text into ${field} on ${path} is left to the browser`, async ({ page }) => {
    await page.goto(path);
    expect(await dropIsCancelled(page, field, "text")).toEqual({ over: false, drop: false });
    // A file dropped on the same field is still stopped from replacing the page.
    expect(await dropIsCancelled(page, field, "file")).toEqual({ over: true, drop: true });
  });
}

test("schedule and contact tools accept dropped files and show the file name", async ({ page }) => {
  await page.goto("/schedule-to-calendar/");
  await dropFiles(page, "#file-drop", [
    { name: "rota.csv", type: "text/csv", buffer: "Title,Date,Time\nEarly,2027-03-01,07:00-15:00\n" },
  ]);
  await expect(page.locator("#table")).toHaveValue(/Early,2027-03-01/);
  await expect(page.locator("#file-status")).toHaveText(/^rota\.csv · /);
  await page.locator("#sample").click();
  await expect(page.locator("#file-status")).toHaveText("No file selected");

  await page.goto("/vcf-select/");
  await dropFiles(page, "#file-drop", [
    { name: "backup.vcf", type: "text/vcard", buffer: "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Dana Example\r\nEND:VCARD\r\n" },
  ]);
  await expect(page.getByLabel("Dana Example", { exact: true })).toBeVisible();
  await expect(page.locator("#file-status")).toHaveText(/^backup\.vcf · /);
});

async function consentWithStubbedTag(page) {
  await page.route("https://www.googletagmanager.com/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
}
const toolChoices = (page) =>
  page.evaluate(() =>
    (window.dataLayer || []).filter((x) => x[0] === "event" && x[1] === "tool_select").map((x) => x[2]),
  );

test("choosing a task on the home page records the choice and opens the tool", async ({ page }) => {
  await consentWithStubbedTag(page);
  await page.goto("/zh/");
  await page.getByRole("button", { name: "允许使用统计", exact: true }).click();
  // First click: hold navigation so the recorded event can be read.
  await page.evaluate(() =>
    document.addEventListener("click", (e) => e.target.closest("a.task-row") && e.preventDefault(), { once: true }),
  );
  const row = page.getByRole("link", { name: /收到一张排班表/ });
  await row.click();
  expect(await toolChoices(page)).toEqual([
    { tool_id: "home", target_tool: "schedule_to_calendar", interface_language: "zh" },
  ]);
  await row.click();
  await expect(page).toHaveURL(/\/zh\/schedule-to-calendar\/$/);
});

test("other-tools rows record which tool page sent the user", async ({ page }) => {
  await consentWithStubbedTag(page);
  await page.goto("/csv-check/");
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  // Stop navigation so the recorded event can be read.
  await page.evaluate(() =>
    document.addEventListener("click", (e) => e.target.closest("a.task-row") && e.preventDefault()),
  );
  await page.getByRole("link", { name: /A website limits your upload size/ }).click();
  expect(await toolChoices(page)).toEqual([
    { tool_id: "csv_check", target_tool: "photos_to_pdf", interface_language: "en" },
  ]);
  await expect(page.locator(".more-tools a.task-row")).toHaveCount(6);
  await expect(page.locator('.more-tools a[href="/csv-check/"]')).toHaveCount(0);
});

test("without consent a task choice sends nothing and still navigates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /A spreadsheet import keeps failing/ }).click();
  await expect(page).toHaveURL(/\/csv-check\/$/);
  expect(await page.evaluate(() => (window.dataLayer || []).length)).toBe(0);
});

test("the brief's help link opens the collapsed instructions", async ({ page }) => {
  for (const path of ["/vcf-select/", "/zh/schedule-to-calendar/", "/photo-privacy/"]) {
    await page.goto(path);
    await expect(page.locator("#howto")).not.toHaveAttribute("open", "");
    await page.locator('.brief a[href="#howto"]').click();
    await expect(page.locator("#howto")).toHaveAttribute("open", "");
  }
});

// DESIGN.md "Widths": including the intro, every block on a page ends at the same right edge.
test("blocks on each page share one right edge at desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of pages) {
    await page.goto(path);
    const { edges, widths } = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll("main > *, .intro h1, .intro .lead")].filter(
        (e) => e.getBoundingClientRect().width > 0,
      );
      return {
        edges: [...new Set(blocks.map((e) => Math.round(e.getBoundingClientRect().right)))],
        widths: [...new Set(blocks.map((e) => Math.round(e.getBoundingClientRect().width)))],
      };
    });
    expect(edges, `${path} right edges`).toHaveLength(1);
    expect(widths, `${path} block widths`).toEqual([1136]);
  }
});

test("the home lead fits on one line at desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ["/", "/zh/"]) {
    await page.goto(path);
    const lines = await page.locator(".lead").evaluate(
      (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)),
    );
    expect(lines, path).toBe(1);
  }
});

for (const width of [1440, 768, 390]) {
  test("page headings follow the shared content width at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [...pages, "/about.html", "/about-en.html"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const heading = page.locator("main h1");
      await expect(heading).toBeVisible();
      const { left, right, viewport, overflow } = await heading.evaluate((element) => {
        const { left, right } = element.getBoundingClientRect();
        const { clientWidth: viewport, scrollWidth } = document.documentElement;
        return { left, right, viewport, overflow: scrollWidth - viewport };
      });
      const margin = Math.max(width <= 760 ? 16 : 24, (viewport - 1136) / 2);
      expect([left, right, overflow], path + " at " + width).toEqual([margin, viewport - margin, 0]);
    }
  });
}
