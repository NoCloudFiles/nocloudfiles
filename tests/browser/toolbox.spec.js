import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("home task index leads to the CSV tool", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "File tools that run in your browser" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /A spreadsheet import keeps failing/ }).click();
  await expect(page.locator("h1")).toHaveText("Check and clean a CSV");
});
test("CSV example exports preserved identifiers, edits invalidate result, no content requests", async ({
  page,
}) => {
  const writes = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });
  await page.goto("/csv-check/");
  await page
    .getByRole("button", { name: "Try a sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-summary")).toContainText("3 records");
  const d = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download cleaned CSV", exact: true })
    .click();
  const text = await readFile(await (await d).path(), "utf8");
  expect(text).toContain("00123");
  expect(text).toContain("00004");
  expect(writes).toEqual([]);
  await page.locator("#csv-input").fill("a,b\n1,2,3");
  await expect(page.locator("#csv-download")).toBeHidden();
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-summary")).toContainText("Fix the errors");
  await expect(page.locator("#csv-download")).toBeHidden();
});
test("CSV consent events carry tool id and sample provenance without text", async ({
  page,
}) => {
  await page.route("https://www.googletagmanager.com/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/csv-check/");
  await page
    .getByRole("button", { name: "Allow analytics", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Try a sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-download")).toBeVisible();
  const events = await page.evaluate(() =>
    window.dataLayer.filter((x) => x[0] === "event").map((x) => [x[1], x[2]]),
  );
  expect(events.find((x) => x[0] === "csv_checked")[1]).toMatchObject({
    tool_id: "csv_check",
    input_source: "sample",
  });
  expect(JSON.stringify(events)).not.toContain("00123");
});
test("CSV formula handling requires a choice and invalid bytes allow recovery", async ({
  page,
}) => {
  await page.goto("/csv-check/");
  await page.locator("#csv-input").fill("name,value\nsecret,=1+1");
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-download")).toBeHidden();
  await page.locator("#csv-formula").selectOption("escape");
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-download")).toBeVisible();
  await page
    .locator("#csv-file")
    .setInputFiles({
      name: "bad.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([0xff]),
    });
  await expect(page.locator("#csv-error")).toBeVisible();
  await expect(page.locator("#csv-download")).toBeHidden();
  await page
    .getByRole("button", { name: "Try a sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-download")).toBeVisible();
});

test("oversized pasted content is rejected whole, never truncated into a valid export", async ({
  page,
}) => {
  await page.goto("/csv-check/");
  await expect(page.locator("#csv-input")).not.toHaveAttribute(
    "maxlength",
    /.+/,
  );
  const content = "id,note\n1," + "x".repeat(2000000) + "\n2,IMPORTANT";
  await page.locator("#csv-input").fill(content);
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  await expect(page.locator("#csv-error")).toContainText("Limit exceeded");
  await expect(page.locator("#csv-download")).toBeHidden();
  await expect(page.locator("#csv-input")).toHaveValue(content);
});
test("file loading preserves embedded CRLF and CR until the user edits text", async ({
  page,
}) => {
  await page.goto("/csv-check/");
  await page
    .locator("#csv-file")
    .setInputFiles({
      name: "multiline.csv",
      mimeType: "text/csv",
      buffer: Buffer.from('id,note\r\n1,"first\r\nsecond\rthird"\r\n'),
    });
  await expect(page.locator("#csv-input")).not.toHaveValue("");
  await page.getByRole("button", { name: "Check CSV", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.locator("#csv-download").click();
  const content = await readFile(await (await download).path(), "utf8");
  expect(content).toContain('"first\r\nsecond\rthird"');
});
test("changing options while file decoding is pending keeps the chosen file", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => {
        window.finishCsvRead = resolve;
      });
      return original.call(this);
    };
  });
  await page.goto("/csv-check/");
  await page
    .locator("#csv-file")
    .setInputFiles({
      name: "pending.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,v\n1,data"),
    });
  await page.locator("#csv-delimiter").selectOption(",");
  await page.locator("#csv-formula").selectOption("preserve");
  await page.evaluate(() => window.finishCsvRead());
  await expect(page.locator("#csv-input")).toHaveValue("id,v\n1,data");
  await page.locator("#csv-check").click();
  await expect(page.locator("#csv-download")).toBeVisible();
});
