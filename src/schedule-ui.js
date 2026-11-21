import { get, element, tr, downloads, report, fileDrop } from "./import-tools.js";
const drop = fileDrop();
import { inspectCsv, decodeCsv } from "./csv-core.js";
import { eventsFrom, writeCalendar, googleCsv } from "./schedule.js";
const input = get("table"),
  mapping = get("mapping"),
  preview = get("preview"),
  status = get("status"),
  links = downloads(get("links"));
// Third-party iOS browsers can also advertise Safari. Only act on a known identifier.
const ua = navigator.userAgent;
get("safari-tip").hidden = !(
  /\biPhone\b/i.test(ua) &&
  /\b(?:CriOS|FxiOS|EdgiOS|OPiOS|MicroMessenger)\//i.test(ua)
);
const names = {
  title: tr("标题", "Title"),
  date: tr("开始日期", "Start date"),
  start: tr("开始时间或时间段", "Start time or range"),
  end: tr("结束时间", "End time"),
  endDate: tr("结束日期", "End date"),
};
const aliases = {
  title: /^(subject|title|event|shift|班次|标题|活动|科目|赛事)$/i,
  date: /^(date|start date|日期|开始日期)$/i,
  start: /^(start|start time|time|开始|时间|时间段|开始时间)$/i,
  end: /^(end|end time|结束|结束时间)$/i,
  endDate: /^(end date|结束日期)$/i,
};
const errors = {
  order: tr("请选择月/日或日/月顺序。", "Choose month/day or day/month order."),
  date: tr("请检查日期。", "Check the date."),
  time: tr(
    "请填写开始和结束时间，例如 22:00–06:00；全天事件可将两者留空。",
    "Enter both times, e.g. 22:00–06:00. Leave both blank for all-day events.",
  ),
  end: tr("结束必须晚于开始。", "End must be later than start."),
  title: tr("标题为空。", "Missing title."),
  mapping: tr(
    "请为标题、日期选择不同列，每列最多使用一次。",
    "Map title and date. Use each column only once.",
  ),
  empty: tr("没有事件。", "No events."),
};
let source = "file",
  rows = [],
  loadId = 0;
function invalidate() {
  links.clear();
  preview.replaceChildren();
  status.textContent = "";
  delete status.dataset.state;
  get("guide").hidden = true;
  get("schedule-result").hidden = true;
}
function reset() {
  invalidate();
  mapping.hidden = true;
  rows = [];
  get("columns").replaceChildren();
}
function error(text) {
  status.textContent = text;
  status.dataset.state = "error";
  report("generate_error", source, "input_rejected");
}
input.oninput = () => {
  loadId++;
  source = source === "sample" ? "mixed" : source;
  reset();
};
get("sample").onclick = () => {
  loadId++;
  reset();
  source = "sample";
  get("file").value = "";
  drop.refresh();
  input.value = tr(
    "班次\t日期\t时间段\n夜班\t2027-01-31\t22:00-06:00\n休息\t2027-02-01\t",
    "Title\tDate\tTime\nNight shift\t2027-01-31\t22:00-06:00\nDay off\t2027-02-01\t",
  );
};
get("file").onchange = async (e) => {
  const id = ++loadId;
  reset();
  input.value = "";
  source = "file";
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2000000) throw Error();
    const content = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    if (id === loadId) input.value = content;
  } catch {
    if (id === loadId) {
      get("file").value = "";
      drop.refresh();
      error(
        tr(
          "请选择 2 MB 以内的 UTF-8 或 UTF-16 CSV/TSV。",
          "Choose a UTF-8 or UTF-16 CSV/TSV up to 2 MB.",
        ),
      );
    }
  }
};
get("map").onclick = () => {
  reset();
  report("tool_start", source);
  const r = inspectCsv(input.value, { maxRows: 3000 });
  if (!r.ok || r.rows.length < 2) {
    error(
      tr(
        "请检查表头、引号和列数（最多 2999 个事件）。",
        "Check headers, quoting and column counts (up to 2,999 events).",
      ),
    );
    return;
  }
  rows = r.rows;
  for (const [key, label] of Object.entries(names)) {
    const select = element("select");
    select.id = "col-" + key;
    select.add(new Option(tr("未选择", "Unmapped"), "-1"));
    rows[0].forEach((h, i) =>
      select.add(new Option(h || String(i + 1), String(i))),
    );
    select.value = String(
      rows[0].findIndex((h) => aliases[key].test(h.trim())),
    );
    const l = element("label", label);
    l.append(select);
    get("columns").append(l);
  }
  mapping.hidden = false;
};
mapping.onchange = invalidate;
get("review").onclick = () => {
  invalidate();
  try {
    const cols = Object.fromEntries(
      Object.keys(names).map((k) => [k, +get("col-" + k).value]),
    );
    const events = eventsFrom(rows, cols, get("order").value);
    const ics = writeCalendar(events),
      csv = googleCsv(events);
    if (new Blob([ics]).size > 1000000 || new Blob([csv]).size > 1000000)
      throw Error("limit");
    const weekdays = new Intl.DateTimeFormat(document.documentElement.lang, {
      weekday: "short",
      timeZone: "UTC",
    });
    const showDay = (d) =>
      d + " " + weekdays.format(new Date(d + "T00:00:00Z"));
    preview.textContent = events
      .map(
        (e) =>
          e.title +
          " · " +
          showDay(e.startDate) +
          " " +
          (e.start || tr("全天", "all day")) +
          (e.end || e.endDate !== e.startDate
            ? " → " + showDay(e.endDate) + " " + e.end
            : "") +
          (e.start && e.endDate !== e.startDate
            ? tr("（跨日）", " (overnight)")
            : ""),
      )
      .join("\n");
    status.textContent =
      tr("请核对事件数和日期：", "Review event count and dates: ") +
      events.length;
    links.add(
      tr("下载 ICS", "Download ICS"),
      ics,
      "schedule.ics",
      "text/calendar;charset=utf-8",
      source,
    );
    links.add(
      tr("下载 Google CSV", "Download Google CSV"),
      csv,
      "schedule.csv",
      "text/csv;charset=utf-8",
      source,
    );
    get("guide").hidden = false;
    get("schedule-result").hidden = false;
    report("schedule_ready", source);
  } catch (e) {
    const [a, b] = e.message.split("|");
    error(
      (b ? tr("第 " + a + " 行：", "Row " + a + ": ") : "") +
        (errors[b || a] ||
          tr(
            "无法导出，请缩短表格并检查字符。",
            "Cannot export. Shorten the table and check its characters.",
          )),
    );
  }
};
window.addEventListener("beforeunload", (e) => {
  if (input.value) {
    e.preventDefault();
    e.returnValue = "";
  }
});
