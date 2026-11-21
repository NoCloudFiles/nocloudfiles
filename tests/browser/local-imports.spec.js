import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
async function readDownload(page, label) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: label, exact: true }).click();
  return fs.readFile(await (await pending).path(), "utf8");
}
test("shift table to two exports, explicit ambiguity and stale download invalidation", async ({
  page,
}) => {
  const writes = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(r.url());
  });
  await page.goto("/schedule-to-calendar/");
  await page
    .locator("#table")
    .fill("Date\tTitle\tTime\n03/04/2027\tLate\t22:00-06:00");
  await page.locator("#map").click();
  await page.locator("#review").click();
  await expect(page.locator("#status")).toContainText("month/day");
  await page.locator("#order").selectOption("dmy");
  await page.locator("#review").click();
  await expect(page.locator("#preview")).toContainText("2027-04-04");
  expect(await readDownload(page, "Download ICS")).toContain(
    "DTEND:20270404T060000",
  );
  expect(await readDownload(page, "Download Google CSV")).toContain(
    "04/04/2027",
  );
  await page.locator("#order").selectOption("mdy");
  await expect(page.locator("#links a")).toHaveCount(0);
  expect(writes).toEqual([]);
});
test("backup search selects only one person and one phone, export matches preview", async ({
  page,
}) => {
  const writes = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(r.url());
  });
  await page.goto("/zh/vcf-select/");
  const v =
    "BEGIN:VCARD\r\nVERSION:2.1\r\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=\r\n=A0=E4=B8=89\r\nTEL:00123\r\nTEL:999\r\nNOTE:不要分享\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nFN:Other\r\nEND:VCARD";
  await page
    .locator("#file")
    .setInputFiles({
      name: "private.vcf",
      mimeType: "text/vcard",
      buffer: Buffer.from(v),
    });
  await page.locator("#search").fill("张");
  await page.getByLabel("张三", { exact: true }).check();
  await page.getByLabel("电话 · 00123").check();
  await page.locator("#build").click();
  const text = await readDownload(page, "下载所选联系人");
  expect(text).toContain("TEL:00123");
  expect(text).not.toMatch(/Other|999|NOTE|不要分享/);
  expect(await page.locator("#raw").textContent()).toBe(text);
  await page.getByLabel("电话 · 00123").uncheck();
  await expect(page.locator("#links a")).toHaveCount(0);
  expect(writes).toEqual([]);
});
test("both sample funnels report only bounded fields with consent; rejections remain usable", async ({
  page,
}) => {
  await page.route("**/analytics-config.json", (r) =>
    r.fulfill({ json: { measurementId: "G-TEST1234" } }),
  );
  await page.route("https://www.googletagmanager.com/**", (r) => r.abort());
  for (const [route, tool, event] of [
    ["schedule-to-calendar", "schedule_to_calendar", "schedule_ready"],
    ["vcf-select", "vcf_select", "contacts_ready"],
  ]) {
    await page.goto("/" + route + "/");
    if (route === "schedule-to-calendar")
      await page
        .getByRole("button", { name: "Allow analytics", exact: true })
        .click();
    await page.locator("#sample").click();
    if (route === "vcf-select") {
      await page.getByLabel("Alex Lin", { exact: true }).check();
      await page.locator("#build").click();
    } else {
      await page.locator("#map").click();
      await page.locator("#review").click();
    }
    await page.locator("#links a").first().click();
    const events = await page.evaluate(() =>
      window.dataLayer.filter((x) => x[0] === "event").map((x) => [x[1], x[2]]),
    );
    expect(events.map((x) => x[0])).toEqual([
      "page_view",
      "tool_start",
      event,
      "download_click",
    ]);
    expect(
      events
        .slice(1)
        .every((x) => x[1].input_source === "sample" && x[1].tool_id === tool),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(
      /Alex Lin|Night shift|2027-01-31/,
    );
  }
});

test('Safari tip appears before entering a schedule only on recognized iPhone browsers',async({page})=>{
  for(const [ua,expected] of [
    ['iPhone AppleWebKit CriOS/143 Mobile/15E148 Safari/604.1',true],
    ['iPhone AppleWebKit Version/18.0 Mobile/15E148 Safari/604.1',false],
    ['Android Chrome/143 Mobile Safari/537.36',false],
    ['iPhone AppleWebKit Mobile/15E148',false],
  ]){
    await page.addInitScript(value=>Object.defineProperty(navigator,'userAgent',{get:()=>value,configurable:true}),ua);
    await page.goto('/zh/schedule-to-calendar/');
    await page.locator('#sample').click();
    await expect(page.locator('#safari-tip')).toBeVisible({visible:expected});
    await page.locator('#map').click();await page.locator('#review').click();
    await expect(page.getByRole('link',{name:'下载 ICS',exact:true})).toBeVisible();
    await expect(page.locator('#guide')).toContainText('添加全部');
  }
});
