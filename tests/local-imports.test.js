import test from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import { eventsFrom, writeCalendar, googleCsv } from "../src/schedule.js";
import { parseCards, writeCards } from "../src/contacts.js";
const cols = { date: 0, title: 1, start: 2, end: -1, endDate: -1 };
const rows = [
  ["Date", "Title", "Time"],
  ["31/12/2027", "夜班, A", "22:00-06:00"],
  ["01/01/2028", "Off", ""],
];
test("local calendar crosses years and preserves all-day bounds and CSV quoting", () => {
  assert.throws(() => eventsFrom(rows, cols, ""), /order/);
  const ev = eventsFrom(rows, cols, "dmy"),
    ics = writeCalendar(ev);
  assert.match(ics, /DTSTART:20271231T220000\r\nDTEND:20280101T060000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20280101\r\nDTEND;VALUE=DATE:20280102/);
  assert.deepEqual(Papa.parse(googleCsv(ev)).data[1], [
    "夜班, A",
    "12/31/2027",
    "10:00 PM",
    "01/01/2028",
    "6:00 AM",
    "False",
  ]);
});
test("invalid dates, duplicate mappings, identical times reject the batch", () => {
  for (const [date, time] of [
    ["2027-02-29", ""],
    ["2028-02-29", "09:00-09:00"],
    ["2027-03-01", "24:30-08:00"],
  ])
    assert.throws(() => eventsFrom([rows[0], [date, "x", time]], cols, ""));
  assert.throws(() => eventsFrom(rows, { ...cols, title: 0 }, "dmy"));
});
test("schedule supports seconds, 12-hour AM/PM, dotted and hyphenated dates, and safe formula escaping", () => {
  const splitCols = { date: 0, title: 1, start: 2, end: 3, endDate: -1 };
  const ev = eventsFrom(
    [
      ["Date", "Title", "Start", "End"],
      ["2027.03.15", "-5", "9:00 AM", "5:15 pm"],
      ["03-04-2027", "=cmd|' /C calc'!A0", "12:30 AM", "12:00 PM"],
      ["2027-04-05", "Exact seconds", "09:00:00", "09:15:30"],
      ["2027-04-06", "AM seconds", "9:00:00 AM", "9:30:45 AM"],
    ],
    splitCols,
    "dmy",
  );
  assert.equal(ev[0].startDate, "2027-03-15");
  assert.equal(ev[0].start, "09:00");
  assert.equal(ev[0].end, "17:15");
  assert.equal(ev[1].startDate, "2027-04-03");
  assert.equal(ev[1].start, "00:30");
  assert.equal(ev[1].end, "12:00");
  assert.equal(ev[2].start, "09:00");
  assert.equal(ev[2].end, "09:15:30");
  assert.equal(ev[3].start, "09:00");
  assert.equal(ev[3].end, "09:30:45");

  const ics = writeCalendar(ev);
  assert.match(ics, /DTSTART:20270315T090000\r\nDTEND:20270315T171500/);
  assert.match(ics, /DTSTART:20270403T003000\r\nDTEND:20270403T120000/);
  assert.match(ics, /DTSTART:20270405T090000\r\nDTEND:20270405T091530/);
  assert.match(ics, /DTSTART:20270406T090000\r\nDTEND:20270406T093045/);

  const csvRows = Papa.parse(googleCsv(ev)).data;
  assert.equal(csvRows[1][0], "-5");
  assert.equal(csvRows[1][2], "9:00 AM");
  assert.equal(csvRows[1][4], "5:15 PM");
  assert.equal(csvRows[2][0], "'=cmd|' /C calc'!A0");
  assert.equal(csvRows[2][2], "12:30 AM");
  assert.equal(csvRows[2][4], "12:00 PM");
  assert.equal(csvRows[3][2], "9:00 AM");
  assert.equal(csvRows[3][4], "9:15:30 AM");

  // Hyphenated DD-MM-YYYY / MM-DD-YYYY requires explicit order
  assert.throws(
    () =>
      eventsFrom(
        [
          ["Date", "Title", "Time"],
          ["03-04-2027", "Shift", "9:00 AM - 5:15 pm"],
        ],
        cols,
        "",
      ),
    /order/,
  );
  assert.equal(
    eventsFrom(
      [
        ["Date", "Title", "Time"],
        ["03-04-2027", "Shift", "9:00 AM - 5:15 pm"],
      ],
      cols,
      "mdy",
    )[0].startDate,
    "2027-03-04",
  );

  // Invalid 12-hour times, seconds, and mixed date separators are rejected
  for (const [date, start, end] of [
    ["2027-03-01", "0:00 AM", "9:00 AM"],
    ["2027-03-01", "13:00 PM", "5:00 PM"],
    ["2027-03-01", "12:60 PM", "1:00 PM"],
    ["2027-03-01", "09:00:60", "10:00:00"],
    ["2027-03-01", "09:00:00", "09:00"],
    ["2027-03/01", "09:00", "10:00"],
    ["03/04-2027", "09:00", "10:00"],
  ])
    assert.throws(() =>
      eventsFrom(
        [
          ["Date", "Title", "Start", "End"],
          [date, "x", start, end],
        ],
        splitCols,
        "dmy",
      ),
    );
});
const parse = (s) => parseCards(new TextEncoder().encode(s));
test("v2.1 QP split inside a Chinese character, large photo and exclusion", () => {
  const photo = "A".repeat(25 * 1024 * 1024);
  const cards = parse(
    "BEGIN:VCARD\r\nVERSION:2.1\r\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=\r\n=A0=E4=B8=89\r\nitem1.TEL;CELL:00123\r\nNOTE:Sensitive\r\nPHOTO;ENCODING=BASE64:" +
      photo +
      "\r\nX-TEST:private\r\nEND:VCARD",
  );
  assert.equal(cards[0].name, "张三");
  const text = writeCards([{ ...cards[0], fields: [cards[0].fields[0]] }]);
  assert.match(text, /TEL;TYPE=CELL:00123/);
  assert.doesNotMatch(text, /NOTE|Sensitive|PHOTO|X-TEST|private/);
  assert.equal(parse(text)[0].name, "张三");
});
test("legacy charset, folded UTF-8, escape and reject truncated or invalid input", () => {
  const t =
    "BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=GBK;ENCODING=QUOTED-PRINTABLE:=D5=C5=C8=FD\nNOTE:line\\nTEL:secret\nEND:VCARD";
  assert.equal(parse(t)[0].name, "张三");
  const rebuilt = writeCards(parse(t));
  assert.doesNotMatch(rebuilt, /\r\nTEL:secret/);
  assert.throws(() => parse(t.replace("=D5", "=XX")));
  assert.throws(() => parse(t.replace("END:VCARD", "")));
  const long = "名".repeat(60);
  const lines = writeCards([{ name: long, fields: [] }]).split("\r\n");
  assert.ok(lines.every((x) => Buffer.byteLength(x) <= 75));
  assert.equal(parse(lines.join("\r\n"))[0].name, long);
});
test("recover legacy split escape introducer; structured address stays in its slots", () => {
  const [card] = parse(
    "BEGIN:VCARD\nVERSION:2.1\nFN;ENCODING=QUOTED-PRINTABLE:=E4=BD=\nA0\nADR:;;123 Main St;City;State;01234;Earth\nEND:VCARD",
  );
  assert.equal(card.name, "你");
  assert.match(writeCards([card]), /ADR:;;123 Main St;City;State;01234;Earth/);
});
test("vCard trims VERSION, decodes BASE64/B readable fields, preserves structured N and safe TEL/EMAIL TYPEs", () => {
  const gbkZhangSanB64 = Buffer.from([0xd5, 0xc5, 0xc8, 0xfd]).toString("base64");
  const noteB64 = Buffer.from("公司备注", "utf8").toString("base64");
  const vcf = [
    "BEGIN:VCARD",
    "version:3.0 ",
    "FN;ENCODING=BASE64;CHARSET=UTF-8:5byg",
    " 5LiJ",
    "N:张;三;;先生;",
    "TEL:00123",
    "TEL;TYPE=WORK,VOICE;TYPE=PREF:+1-555-0100",
    'EMAIL;TYPE=INTERNET;TYPE="home":a@example.org',
    "NOTE;ENCODING=B;CHARSET=UTF-8:" + noteB64,
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:2.1 ",
    "FN;ENCODING=BASE64;CHARSET=GBK:",
    gbkZhangSanB64.slice(0, 4),
    gbkZhangSanB64.slice(4),
    "",
    "N:Lin;Alex",
    "TEL;CELL:13800138000",
    "END:VCARD",
  ].join("\r\n");

  const cards = parse(vcf);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].name, "张三");
  assert.deepEqual(cards[0].nameParts, ["张", "三", "", "先生", ""]);
  assert.equal(cards[0].fields[0].types, undefined);
  assert.deepEqual(cards[0].fields[1].types, ["WORK", "VOICE"]);
  assert.deepEqual(cards[0].fields[2].types, ["HOME"]);
  assert.equal(cards[0].fields[3].value, "公司备注");

  assert.equal(cards[1].name, "张三");
  assert.deepEqual(cards[1].nameParts, ["Lin", "Alex", "", "", ""]);
  assert.deepEqual(cards[1].fields[0].types, ["CELL"]);

  const out = writeCards(cards);
  assert.match(out, /N:张;三;;先生;/);
  assert.match(out, /N:Lin;Alex;;;/);
  assert.match(out, /\r\nTEL:00123\r\n/);
  assert.match(out, /\r\nTEL;TYPE=WORK,VOICE:\+1-555-0100\r\n/);
  assert.match(out, /\r\nEMAIL;TYPE=HOME:a@example\.org\r\n/);
  assert.match(out, /\r\nTEL;TYPE=CELL:13800138000\r\n/);

  // Malformed base64 on a readable field is rejected
  assert.throws(
    () =>
      parse(
        "BEGIN:VCARD\r\nVERSION:2.1\r\nFN;ENCODING=BASE64:not!valid!\r\nEND:VCARD",
      ),
    /encoding/,
  );

  // Non-readable binary property (LOGO/SOUND/KEY) with short header and >64KB continuation line is skipped safely
  const largeLogoCard = parse(
    "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Logo Contact\r\nLOGO;ENCODING=b:AAAA\r\n " +
      "B".repeat(70000) +
      "\r\nTEL:12345\r\nEND:VCARD",
  );
  assert.equal(largeLogoCard[0].name, "Logo Contact");
  assert.equal(largeLogoCard[0].fields[0].value, "12345");
});
