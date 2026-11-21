import Papa from "papaparse";
import { escapeText, foldLine } from "./local-formats.js";
function day(text, order) {
  let y, m, d;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (iso) [, y, m, d] = iso.map(Number);
  else {
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!local) throw Error("date");
    if (!order) throw Error("order");
    y = +local[3];
    m = +local[order === "mdy" ? 1 : 2];
    d = +local[order === "mdy" ? 2 : 1];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 1000 ||
    y > 9999 ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    throw Error("date");
  return date.toISOString().slice(0, 10);
}
function next(date) {
  const n = new Date(date + "T00:00:00Z");
  n.setUTCDate(n.getUTCDate() + 1);
  if (n.getUTCFullYear() > 9999) throw Error("date");
  return n.toISOString().slice(0, 10);
}
function clock(t) {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(t.trim());
  if (!m || +m[1] > 23) throw Error("time");
  return m[1].padStart(2, "0") + ":" + m[2];
}
export function eventsFrom(rows, cols, order) {
  if (
    cols.title < 0 ||
    cols.date < 0 ||
    new Set(Object.values(cols).filter((c) => c >= 0)).size !==
      Object.values(cols).filter((c) => c >= 0).length
  )
    throw Error("mapping");
  const result = [];
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.every((c) => !c.trim())) continue;
    const cell = (k) => row[cols[k]]?.trim() ?? "";
    try {
      const title = cell("title"),
        startDate = day(cell("date"), order);
      if (!title) throw Error("title");
      escapeText(title);
      let start = cell("start"),
        end = cell("end"),
        endDate = cell("endDate") ? day(cell("endDate"), order) : startDate;
      if (start && !end) {
        const range = start.split(/\s*[-–—~至]\s*/);
        if (range.length === 2) [start, end] = range;
      }
      if (start || end) {
        start = clock(start);
        end = clock(end);
        if (!cell("endDate") && end < start) endDate = next(startDate);
        if (endDate + end <= startDate + start) throw Error("end");
      } else if (endDate < startDate) throw Error("end");
      result.push({ title, startDate, endDate, start, end });
    } catch (e) {
      throw Error(index + 2 + "|" + e.message);
    }
  }
  if (!result.length) throw Error("empty");
  return result;
}
export function writeCalendar(events) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NoCloudFiles//Schedules//EN",
    "CALSCALE:GREGORIAN",
  ];
  const compact = (d) => d.replaceAll("-", "");
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + crypto.randomUUID() + "@nocloudfiles.com",
      "DTSTAMP:" + stamp,
      "SUMMARY:" + escapeText(e.title),
    );
    for (const [name, date, time] of [
      ["DTSTART", e.startDate, e.start],
      ["DTEND", e.endDate, e.end],
    ]) {
      lines.push(
        time
          ? name + ":" + compact(date) + "T" + time.replace(":", "") + "00"
          : name +
              ";VALUE=DATE:" +
              compact(name === "DTEND" ? next(date) : date),
      );
    }
    lines.push("END:VEVENT");
  }
  return [...lines, "END:VCALENDAR"].map(foldLine).join("\r\n") + "\r\n";
}
export function googleCsv(events) {
  const date = (d) => d.slice(5, 7) + "/" + d.slice(8) + "/" + d.slice(0, 4);
  const time = (t) =>
    t
      ? (+t.slice(0, 2) % 12 || 12) +
        t.slice(2) +
        (+t.slice(0, 2) >= 12 ? " PM" : " AM")
      : "";
  return Papa.unparse(
    [
      [
        "Subject",
        "Start Date",
        "Start Time",
        "End Date",
        "End Time",
        "All Day Event",
      ],
      ...events.map((e) => [
        e.title,
        date(e.startDate),
        time(e.start),
        date(e.endDate),
        time(e.end),
        e.start ? "False" : "True",
      ]),
    ],
    { newline: "\r\n", escapeFormulae: true },
  );
}
