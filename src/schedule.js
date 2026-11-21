import Papa from "papaparse";
import { escapeText, foldLine } from "./local-formats.js";
import { formulaPattern } from "./csv-core.js";
function day(text, order) {
  let y, m, d;
  const iso = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(text);
  if (iso) {
    y = +iso[1];
    m = +iso[3];
    d = +iso[4];
  } else {
    const local = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(text);
    if (!local) throw Error("date");
    if (order !== "mdy" && order !== "dmy") throw Error("order");
    y = +local[4];
    m = +(order === "mdy" ? local[1] : local[3]);
    d = +(order === "mdy" ? local[3] : local[1]);
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
  const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?:\s*([AaPp][Mm]))?$/.exec(
    t.trim(),
  );
  if (!m) throw Error("time");
  let h = +m[1];
  const min = m[2],
    sec = m[3] || "00",
    meridiem = m[4]?.toUpperCase();
  if (meridiem) {
    if (h < 1 || h > 12) throw Error("time");
    if (meridiem === "AM") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) {
    throw Error("time");
  }
  return (
    String(h).padStart(2, "0") + ":" + min + (sec !== "00" ? ":" + sec : "")
  );
}
function fullTime(t) {
  return t.length === 5 ? t + ":00" : t;
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
        const startFull = fullTime(start),
          endFull = fullTime(end);
        if (!cell("endDate") && endFull < startFull) endDate = next(startDate);
        if (endDate + endFull <= startDate + startFull) throw Error("end");
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
          ? name + ":" + compact(date) + "T" + fullTime(time).replaceAll(":", "")
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
    { newline: "\r\n", escapeFormulae: formulaPattern },
  );
}
