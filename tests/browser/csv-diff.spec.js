import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("sample flow flags wiped cells, displays exact numeric summary and exports diff CSV without uploads", async ({
  page,
}) => {
  const writes = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });

  await page.goto("/csv-diff/");
  await page.locator("#diff-sample").click();
  await expect(page.locator("#diff-key1")).toHaveValue("sku");
  await expect(page.locator("#diff-numeric")).toHaveValue("price");

  await page.locator("#diff-compare").click();
  await expect(page.locator("#diff-result")).toBeVisible();
  await expect(page.locator("#diff-warnings")).toContainText("1 cell(s) changed from non-empty to blank");
  await expect(page.locator("#diff-numeric-box")).toBeVisible();
  await expect(page.locator("#diff-numeric-fields")).toContainText("price");
  await expect(page.locator("#diff-numeric-fields")).toContainText("106.90");
  await expect(page.locator("#diff-numeric-fields")).toContainText("114.00");
  await expect(page.locator("#diff-numeric-fields")).toContainText("7.10");

  const dl = page.waitForEvent("download");
  await page.locator("#diff-download").click();
  const csv = await readFile(await (await dl).path(), "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('"change_type","key","column","before_value","after_value"');
  expect(csv).toContain('"wiped","SKU-002","image_url","https://example.com/tote-blue.jpg",""');
  expect(csv).toContain('"modified","SKU-001","price","24.50","26.00"');
  expect(csv).toContain('"removed","SKU-004"');
  expect(csv).toContain('"added","SKU-005"');
  expect(writes).toEqual([]);
});

test("duplicate keys stop comparison with exact record numbers and block export", async ({
  page,
}) => {
  await page.goto("/csv-diff/");
  await page.locator("#before-input").fill("id,price\nA1,10.00\nA1,12.00\n");
  await page.locator("#after-input").fill("id,price\nA1,15.00\n");
  await page.locator("#diff-load-cols").click();
  await expect(page.locator("#diff-key1")).toHaveValue("id");

  await page.locator("#diff-compare").click();
  await expect(page.locator("#diff-error")).toBeVisible();
  await expect(page.locator("#diff-error")).toContainText("Duplicate key at record 3");
  await expect(page.locator("#diff-error")).toContainText("record 2");
  await expect(page.locator("#diff-download")).toBeHidden();
});

test("analytics records bounded csv_diff events without leaking filenames or cell values", async ({
  page,
}) => {
  await page.route("**/analytics-config.json", (r) =>
    r.fulfill({ json: { measurementId: "G-TEST1234" } }),
  );
  await page.route("https://www.googletagmanager.com/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/csv-diff/");
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();

  await page.locator("#before-file").setInputFiles({
    name: "secret-payroll-before.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("emp_id,salary,note\nEMP-999,5000.00,CONFIDENTIAL_OLD\n"),
  });
  await page.locator("#after-file").setInputFiles({
    name: "secret-payroll-after.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("emp_id,salary,note\nEMP-999,5250.00,CONFIDENTIAL_NEW\n"),
  });
  await expect(page.locator("#diff-key1")).toHaveValue("emp_id");
  await page.locator("#diff-compare").click();
  await expect(page.locator("#diff-download")).toBeVisible();
  await page.locator("#diff-download").click();

  const events = await page.evaluate(() =>
    window.dataLayer.filter((x) => x[0] === "event").map((x) => [x[1], x[2]]),
  );
  expect(events.map((x) => x[0])).toEqual([
    "page_view",
    "tool_start",
    "csv_diff_ready",
    "download_click",
  ]);
  expect(
    events
      .slice(1)
      .every((x) => x[1].tool_id === "csv_diff" && x[1].input_source === "file"),
  ).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/secret-payroll|EMP-999|CONFIDENTIAL|5250/);
});

test("download preserves schema changes and distinct two-column keys", async ({ page }) => {
  await page.goto("/csv-diff/");
  await page.locator("#before-input").fill("a,b,value,old\nA / B,C,1,x\nA,B / C,2,y");
  await page.locator("#after-input").fill("a,b,value,new\nA / B,C,3,x\nA,B / C,4,y");
  await expect(page.locator("#diff-key1")).toHaveValue("a");
  await page.locator("#diff-key2").selectOption("b");
  await page.locator("#diff-compare").click();
  await expect(page.locator("#diff-preview")).toContainText("Column removed");
  await expect(page.locator("#diff-preview")).toContainText("Column added");
  const pending = page.waitForEvent("download");
  await page.locator("#diff-download").click();
  const text = await readFile(await (await pending).path(), "utf8");
  expect(text).toContain('"column_removed","","old","",""');
  expect(text).toContain('"column_added","","new","",""');
  expect(text).toContain('"modified","[""A / B"",""C""]","value","1","3"');
  expect(text).toContain('"modified","[""A"",""B / C""]","value","2","4"');
});
