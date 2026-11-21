import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

async function makePdfBuffer(pageCount) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([400, 600]);
  }
  return Buffer.from(await doc.save());
}

test("sample flow interleaves 3+3 pages, supports normal order and 180° back rotation with no uploads", async ({
  page,
}) => {
  const writes = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });

  await page.goto("/interleave-pdf/");
  await expect(page.locator("#combine")).toBeDisabled();

  await page.locator("#sample").click();
  await expect(page.locator("#plan-panel")).toBeVisible();
  await expect(page.locator("#plan-metrics")).toContainText("Matched");
  await expect(page.locator("#plan-metrics")).toContainText("6");
  // Default reversed back order pairs output page 2 with back page 3.
  await expect(page.locator("#plan-table tr").nth(2)).toContainText("Page 3");
  await expect(page.locator("#combine")).toBeEnabled();

  await page.locator("#combine").click();
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#download")).toBeVisible();

  const dl1 = page.waitForEvent("download");
  await page.locator("#download").click();
  const pdf1 = await PDFDocument.load(await readFile(await (await dl1).path()));
  expect(pdf1.getPageCount()).toBe(6);
  expect(pdf1.getPage(1).getRotation().angle).toBe(0);

  // Switching to forward back order invalidates previous output and updates plan table.
  await page.locator("#back-order").selectOption("normal");
  await expect(page.locator("#result")).toBeHidden();
  await expect(page.locator("#plan-table tr").nth(2)).toContainText("Page 1");

  // Enabling 180° back rotation annotates preview and rotates even pages in output PDF.
  await page.locator("#rotate-back").selectOption("180");
  await expect(page.locator("#plan-table tr").nth(2)).toContainText("+180°");

  await page.locator("#combine").click();
  await expect(page.locator("#download")).toBeVisible();
  const dl2 = page.waitForEvent("download");
  await page.locator("#download").click();
  const pdf2 = await PDFDocument.load(await readFile(await (await dl2).path()));
  expect(pdf2.getPageCount()).toBe(6);
  expect(pdf2.getPage(0).getRotation().angle).toBe(0);
  expect(pdf2.getPage(1).getRotation().angle).toBe(180);
  expect(pdf2.getPage(2).getRotation().angle).toBe(0);
  expect(pdf2.getPage(3).getRotation().angle).toBe(180);
  expect(pdf2.getPage(4).getRotation().angle).toBe(0);
  expect(pdf2.getPage(5).getRotation().angle).toBe(180);
  expect(writes).toEqual([]);
});

test("odd last sheet and page-count mismatch warnings preserve all trailing pages", async ({
  page,
}) => {
  await page.goto("/interleave-pdf/");

  // 3 front + 2 back -> odd last sheet warning, 5 total pages
  await page.locator("#front-file").setInputFiles({
    name: "front3.pdf",
    mimeType: "application/pdf",
    buffer: await makePdfBuffer(3),
  });
  await page.locator("#back-file").setInputFiles({
    name: "back2.pdf",
    mimeType: "application/pdf",
    buffer: await makePdfBuffer(2),
  });
  await expect(page.locator("#plan-warning")).toBeVisible();
  await expect(page.locator("#plan-warning")).toContainText("1 more page");
  await expect(page.locator("#plan-metrics")).toContainText("Odd last sheet");

  await page.locator("#combine").click();
  const dlOdd = page.waitForEvent("download");
  await page.locator("#download").click();
  const oddPdf = await PDFDocument.load(await readFile(await (await dlOdd).path()));
  expect(oddPdf.getPageCount()).toBe(5);

  // 4 front + 1 back -> mismatch warning, 5 total pages (none dropped)
  await page.locator("#front-file").setInputFiles({
    name: "front4.pdf",
    mimeType: "application/pdf",
    buffer: await makePdfBuffer(4),
  });
  await page.locator("#back-file").setInputFiles({
    name: "back1.pdf",
    mimeType: "application/pdf",
    buffer: await makePdfBuffer(1),
  });
  await expect(page.locator("#plan-warning")).toBeVisible();
  await expect(page.locator("#plan-warning")).toContainText("differ by 3");
  await expect(page.locator("#plan-metrics")).toContainText("Mismatch");
});

test("rejected non-PDF shows clear error and recovers cleanly", async ({ page }) => {
  await page.goto("/interleave-pdf/");
  await page.locator("#front-file").setInputFiles({
    name: "not-a-scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("plain text pretending to be a pdf"),
  });
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#error")).toContainText("%PDF-");
  await expect(page.locator("#combine")).toBeDisabled();

  await page.locator("#sample").click();
  await expect(page.locator("#error")).toBeHidden();
  await expect(page.locator("#combine")).toBeEnabled();
  await page.locator("#combine").click();
  await expect(page.locator("#download")).toBeVisible();
});

test("analytics records bounded interleave_pdf events without leaking filenames or PDF content", async ({
  page,
}) => {
  await page.route("**/analytics-config.json", (r) =>
    r.fulfill({ json: { measurementId: "G-TEST1234" } }),
  );
  await page.route("https://www.googletagmanager.com/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/interleave-pdf/");
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();

  await page.locator("#front-file").setInputFiles({
    name: "secret-tax-return-front.pdf",
    mimeType: "application/pdf",
    buffer: await makePdfBuffer(2),
  });
  await page.locator("#back-file").setInputFiles({
    name: "secret-tax-return-back.pdf",
    mimeType: "application/pdf",
    buffer: await makePdfBuffer(2),
  });
  await expect(page.locator("#combine")).toBeEnabled();
  await page.locator("#combine").click();
  await expect(page.locator("#download")).toBeVisible();
  await page.locator("#download").click();

  const events = await page.evaluate(() =>
    window.dataLayer.filter((x) => x[0] === "event").map((x) => [x[1], x[2]]),
  );
  expect(events.map((x) => x[0])).toEqual([
    "page_view",
    "tool_start",
    "interleave_ready",
    "download_click",
  ]);
  expect(
    events
      .slice(1)
      .every((x) => x[1].tool_id === "interleave_pdf" && x[1].input_source === "file"),
  ).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/secret-tax-return|front|back/);
});
