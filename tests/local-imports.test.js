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
  assert.match(text, /TEL:00123/);
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
