import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ExifReader from "exifreader";

for (const [file, width, height, warning] of [
  ["private-original.jpg", 240, 180],
  ["private-original.heic", 240, 180],
  ["motion.jpg", 240, 180, "Motion photo marker detected"],
  ["gain-map.jpg", 64, 64, "HDR data detected"],
]) {
  test("export a private still from " + file, async ({ page }) => {
    const writes = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") writes.push(r.url());
    });
    await page.goto("/photo-privacy/");
    await page.locator("#photo").setInputFiles("tests/fixtures/" + file);
    const make = page.getByRole("button", { name: "Create private copy" });
    // HEIC loads the local WASM decoder on first use, including over the public network.
    await expect(make).toBeEnabled({timeout: file.endsWith(".heic") ? 30000 : 8000});
    if (warning)
      await expect(
        page.getByText(warning, { exact: false }).last(),
      ).toBeVisible();
    if (file !== "gain-map.jpg") {
      await expect(
        page.getByRole("textbox", { name: "Author", exact: true }),
      ).toHaveValue("Private Author");
      await expect(
        page.getByRole("textbox", { name: "Latitude", exact: true }),
      ).toHaveValue(/^25\.034/);
    }
    await make.click();
    const link = page.getByRole("link", { name: "Download still JPEG" });
    const download = page.waitForEvent("download");
    await link.click();
    const bytes = await readFile(await (await download).path());
    const tags = ExifReader.load(bytes, { expanded: true });
    expect(tags.gps).toBeUndefined();
    expect(tags.exif?.Artist).toBeUndefined();
    expect(bytes.includes(Buffer.from("Private Author"))).toBe(false);
    expect(bytes.includes(Buffer.from("PRIVATE_MOTION_PAYLOAD"))).toBe(false);
    expect(bytes.includes(Buffer.from("21496"))).toBe(false);
    expect([...bytes.subarray(-2)]).toEqual([255, 217]);
    expect(tags.file["Image Width"].value).toBe(width);
    expect(tags.file["Image Height"].value).toBe(height);
    await page.getByRole("button", { name: "Fill fictional details" }).click();
    await expect(link).toHaveCount(0);
    await make.click();
    const changed = page.waitForEvent("download");
    await link.click();
    const output = await readFile(await (await changed).path());
    expect(output.includes(Buffer.from("Example Traveler"))).toBe(true);
    expect(output.includes(Buffer.from("Private Author"))).toBe(false);
    expect(writes).toEqual([]);
  });
}
test("both homepages link to the organization repository and their localized tool", async ({
  page,
}) => {
  for (const prefix of ["", "/zh"]) {
    await page.goto(prefix + "/");
    await expect(
      page.locator(
        'footer a[href="https://github.com/NoCloudFiles/nocloudfiles"]',
      ),
    ).toBeVisible();
    await page.locator('main a[href="' + prefix + '/photo-privacy/"]').click();
    await expect(page.locator("#photo")).toBeVisible();
    await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
      "href",
      "https://nocloudfiles.com" + prefix + "/photo-privacy/",
    );
  }
});
test("invalid files recover; analytics reports bounded stages after consent", async ({
  page,
}) => {
  await page.route("**/analytics-config.json", (r) =>
    r.fulfill({ json: { measurementId: "G-TEST1234" } }),
  );
  await page.route("https://www.googletagmanager.com/**", (r) => r.abort());
  await page.goto("/photo-privacy/");
  await page
    .getByRole("button", { name: "Allow analytics", exact: true })
    .click();
  await page
    .locator("#photo")
    .setInputFiles({
      name: "private-name.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("broken"),
    });
  await expect(page.locator("#status")).toContainText("Choose a JPEG");
  await page
    .locator("#photo")
    .setInputFiles("tests/fixtures/private-original.jpg");
  await page.getByRole("button", { name: "Create private copy" }).click();
  await page.getByRole("link", { name: "Download still JPEG" }).click();
  const events = await page.evaluate(() =>
    window.dataLayer.filter((x) => x[0] === "event").map((x) => [x[1], x[2]]),
  );
  expect(events.map((e) => e[0])).toEqual([
    "page_view",
    "tool_start",
    "generate_error",
    "tool_start",
    "photo_inspected",
    "photo_ready",
    "download_click",
  ]);
  expect(events.every(([, p]) => p.tool_id === "photo_privacy")).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(
    /private-name|Private Author|25\.034/,
  );
});

test("24 MP HEIC exports within a constrained canvas budget", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      if (this.width * this.height > 16_777_216) return null;
      return getContext.apply(this, args);
    };
  });
  await page.goto("/photo-privacy/");
  await page.locator("#photo").setInputFiles("tests/fixtures/solid-24mp.heic");
  const make = page.getByRole("button", { name: "Create private copy" });
  await expect(make).toBeEnabled({ timeout: 20000 });
  await make.click();
  await expect(page.getByText(/Scaled proportionally/)).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download still JPEG" }).click();
  const image = ExifReader.load(await readFile(await (await pending).path()), { expanded: true });
  const width = image.file["Image Width"].value;
  const height = image.file["Image Height"].value;
  expect(width * height).toBeLessThanOrEqual(16_777_216);
  expect(width / height).toBeCloseTo(1.5, 2);
});
