import { tr } from "./i18n.js";
import { decodeCsv } from "./csv-core.js";
import { setupAnalytics, track } from "./analytics-ui.js";
import { setupDropzone } from "./dropzone.js";
import "./page-ui.js";
const $ = (id) => document.getElementById(id);
let worker = null,
  url = null,
  version = 0,
  source = "file",
  downloaded = false,
  originalText = null,
  readVersion = 0,
  filePending = false;
const dropzone = setupDropzone({
  zone: $("csv-drop"),
  input: $("csv-file"),
  status: $("csv-file-status"),
});
const delimiterNames = {
  ",": tr("逗号", "comma"),
  ";": tr("分号", "semicolon"),
  "\t": "Tab",
  "|": "|",
};
function metric(value, label, tone) {
  const li = document.createElement("li");
  li.className = "metric" + (tone ? " " + tone : "");
  const b = document.createElement("b");
  b.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  li.append(b, span);
  return li;
}
const event = (name, params = {}) =>
  track(name, { input_source: source, ...params });
const messages = {
  empty: tr("没有可检查的内容。", "There is no content to check."),
  limit: tr(
    "超过限制：2 MB、20,000 条记录或 200 列。",
    "Limit exceeded: 2 MB, 20,000 records or 200 columns.",
  ),
  binary: tr(
    "含有空字节，请检查编码或选择 CSV 文本文件。",
    "Null bytes found. Check encoding or choose a CSV text file.",
  ),
  quotes: tr(
    "引号结构错误，无法安全确定单元格边界。",
    "Broken quoting: cell boundaries cannot be safely determined.",
  ),
  columns: tr(
    "此记录的列数与首行不同。",
    "This record has a different column count from the first row.",
  ),
  headers: tr(
    "首行存在重复或空列名；未自动改名。",
    "The first row has duplicate or empty column names; names are unchanged.",
  ),
  formula: tr(
    "发现可能被表格软件执行的公式。导出前请选择保留或加前导单引号。",
    "Some cells may execute as spreadsheet formulas. Choose preserve or prefix with an apostrophe before export.",
  ),
  date: tr(
    "发现可能有歧义的日期；原值保留，未转换。",
    "Potentially ambiguous dates found; original values are preserved, not converted.",
  ),
  scientific: tr(
    "发现科学计数法；无法恢复已丢失的精度或前导零。",
    "Scientific notation found. Lost precision or leading zeros cannot be recovered.",
  ),
  delimiter: tr(
    "无法确定分隔符，请检查预览并手动选择。",
    "Delimiter could not be confidently detected. Review the preview and choose explicitly.",
  ),
};
function clearOutput() {
  if (url) URL.revokeObjectURL(url);
  url = null;
  $("csv-download").hidden = true;
  $("csv-download").removeAttribute("href");
  downloaded = false;
}
function invalidate(cancelRead = true) {
  version++;
  if (cancelRead) {
    readVersion++;
    filePending = false;
  }
  worker?.terminate();
  worker = null;
  clearOutput();
  $("csv-result").hidden = true;
  $("csv-error").hidden = true;
  $("csv-check").disabled = filePending;
  $("csv-cancel").hidden = true;
}
function error(text) {
  $("csv-error").textContent = text;
  $("csv-error").hidden = false;
}
$("csv-input").oninput = () => {
  originalText = null;
  if (source === "sample") source = "mixed";
  invalidate();
};
for (const id of ["csv-delimiter", "csv-formula"])
  $(id).onchange = () => invalidate(false);
$("csv-encoding").onchange = () => {
  invalidate();
  if ($("csv-file").files[0]) readFile($("csv-file").files[0]);
};
async function readFile(file) {
  invalidate();
  source = "file";
  originalText = null;
  $("csv-input").value = "";
  const current = readVersion;
  if (file.size > 2000000) {
    error(messages.limit);
    event("generate_error", { error_code: "input_rejected" });
    return;
  }
  filePending = true;
  $("csv-check").disabled = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (current !== readVersion) return;
    originalText = decodeCsv(bytes, $("csv-encoding").value);
    $("csv-input").value = originalText;
  } catch {
    if (current !== readVersion) return;
    error(
      tr(
        "无法按所选编码读取。请选择正确编码后重试，不会用乱码替换原内容。",
        "Cannot decode using this encoding. Select the correct encoding and retry; invalid bytes will not be replaced silently.",
      ),
    );
    event("generate_error", { error_code: "decode_failed" });
  } finally {
    if (current === readVersion) {
      filePending = false;
      $("csv-check").disabled = false;
    }
  }
}
$("csv-file").onchange = (e) => {
  if (e.target.files[0]) readFile(e.target.files[0]);
};
$("csv-example").onclick = () => {
  invalidate();
  source = "sample";
  originalText = null;
  $("csv-file").value = "";
  dropzone.refresh();
  $("csv-input").value =
    'sku;amount;note\r\n00123;1.2300;"Two lines\nhere"\r\n00004;2.00;"Keep leading zeros"';
  $("csv-delimiter").value = "";
  $("csv-formula").value = "ask";
};
$("csv-clear").onclick = () => {
  invalidate();
  originalText = null;
  $("csv-input").value = "";
  $("csv-file").value = "";
  dropzone.refresh();
  source = "file";
};
$("csv-cancel").onclick = () => {
  invalidate();
  error(tr("已取消，输入仍保留。", "Cancelled. Your input is preserved."));
  event("generate_cancel");
};
$("csv-check").onclick = () => {
  invalidate();
  const text = originalText ?? $("csv-input").value;
  if (new TextEncoder().encode(text).length > 2000000) {
    error(messages.limit);
    event("generate_error", { error_code: "input_rejected" });
    return;
  }
  event("tool_start");
  event("csv_check_start");
  $("csv-check").disabled = true;
  $("csv-cancel").hidden = false;
  const current = version;
  try {
    worker = new Worker(new URL("./csv-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onerror = () => {
      if (current !== version) return;
      invalidate();
      error(
        tr(
          "检查未完成，请减少内容后重试。",
          "Could not finish checking. Try a smaller input.",
        ),
      );
      event("generate_error", { error_code: "generation_failed" });
    };
    worker.onmessage = ({ data: r }) => {
      if (current !== version) return;
      worker.terminate();
      worker = null;
      $("csv-check").disabled = false;
      $("csv-cancel").hidden = true;
      if (r.failed) {
        error(tr("无法完成检查。", "Could not complete the check."));
        event("generate_error", { error_code: "generation_failed" });
        return;
      }
      $("csv-result").hidden = false;
      $("csv-summary").textContent = r.ok
        ? tr(
            `${r.records} 条记录（含首行），${r.columns} 列。`,
            `${r.records} records (including first row), ${r.columns} columns.`,
          )
        : tr(
            "请先修正错误，未生成下载文件。",
            "Fix the errors before exporting. No download was created.",
          );
      const errors = r.issues.filter((i) => i.severity === "error").length;
      const warnings = r.issues.length - errors;
      $("csv-result").classList.toggle("has-errors", !r.ok);
      $("csv-metrics").replaceChildren(
        metric(r.records.toLocaleString("en-US"), tr("条记录（含首行）", "records incl. first row")),
        metric(String(r.columns), tr("列", "columns")),
        metric(
          delimiterNames[r.delimiter] ?? "?",
          tr("分隔符", "separator"),
        ),
        metric(String(errors), tr("个错误", "errors"), errors ? "warn" : "ok"),
        metric(String(warnings), tr("条提示", "notes"), warnings ? "warn" : ""),
      );
      $("csv-issues").replaceChildren();
      for (const issue of r.issues.slice(0, 20)) {
        const li = document.createElement("li");
        li.textContent =
          (issue.row
            ? tr(`记录 ${issue.row}：`, `Record ${issue.row}: `)
            : "") + messages[issue.code];
        $("csv-issues").append(li);
      }
      $("csv-preview").replaceChildren();
      for (const row of r.preview) {
        const trEl = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          td.textContent = cell;
          trEl.append(td);
        }
        $("csv-preview").append(trEl);
      }
      if (r.ok) event("csv_checked");
      else event("generate_error", { error_code: "input_rejected" });
      if (r.output !== null) {
        url = URL.createObjectURL(
          new Blob([r.output], { type: "text/csv;charset=utf-8" }),
        );
        $("csv-download").href = url;
        $("csv-download").hidden = false;
        event("csv_ready");
      }
    };
    worker.postMessage({
      text,
      delimiter: $("csv-delimiter").value,
      formula: $("csv-formula").value,
    });
  } catch {
    invalidate();
    error(
      tr("浏览器无法启动检查。", "Your browser could not start the check."),
    );
    event("generate_error", { error_code: "generation_failed" });
  }
};
$("csv-download").onclick = () => {
  if (url && !downloaded) {
    downloaded = true;
    event("download_click");
  }
};
window.addEventListener("beforeunload", (e) => {
  if ($("csv-input").value) {
    e.preventDefault();
    e.returnValue = "";
  }
});
setupAnalytics();
