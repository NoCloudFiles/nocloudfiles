import { tr } from "./i18n.js";
import { decodeCsv } from "./csv-core.js";
import { setupAnalytics, track } from "./analytics-ui.js";
import { setupDropzone } from "./dropzone.js";
import "./page-ui.js";

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 2_000_000;
const encoder = new TextEncoder();

let worker = null;
let inspectWorker = null;
let inspectTimer = null;
let url = null;
let version = 0;
let inspectVersion = 0;
let downloaded = false;
let pendingSampleNumeric = "";
const startedSources = new Set();
const readySources = new Set();

const sides = {
  before: {
    source: "file",
    originalText: null,
    readVersion: 0,
    pending: false,
    dropzone: setupDropzone({
      zone: $("before-drop"),
      input: $("before-file"),
      status: $("before-file-status"),
    }),
  },
  after: {
    source: "file",
    originalText: null,
    readVersion: 0,
    pending: false,
    dropzone: setupDropzone({
      zone: $("after-drop"),
      input: $("after-file"),
      status: $("after-file-status"),
    }),
  },
};

const inputSource = () =>
  sides.before.source === sides.after.source ? sides.before.source : "mixed";

const event = (name, params = {}) =>
  track(name, { input_source: inputSource(), ...params });

const sideLabel = (side) =>
  side === "before"
    ? tr("修改前原表", "Original table (Before)")
    : tr("修改后新表", "Updated table (After)");

const changeLabels = {
  column_removed: tr("删除列", "Column removed"),
  column_added: tr("新增列", "Column added"),
  wiped: tr("已清空", "Wiped"),
  modified: tr("已修改", "Modified"),
  removed: tr("已删除行", "Removed"),
  added: tr("新增行", "Added"),
};

function formatError(res) {
  const prefix = res.side ? `${sideLabel(res.side)}: ` : "";
  const rowText = res.row
    ? tr(`第 ${res.row} 条记录`, `record ${res.row}`)
    : "";
  switch (res.code) {
    case "empty":
      return (
        prefix +
        tr("内容为空，请添加包含表头的表格。", "Table is empty. Add a table with a header row.")
      );
    case "limit":
      return (
        prefix +
        tr(
          "超过限制：单表最多 2 MB、20,000 条记录或 200 列。",
          "Limit exceeded: up to 2 MB, 20,000 records or 200 columns per table.",
        )
      );
    case "binary":
      return (
        prefix +
        tr(
          "含有空字节，请检查编码或选择 CSV 文本文件。",
          "Null bytes found. Check encoding or choose a CSV text file.",
        )
      );
    case "delimiter":
      return (
        prefix +
        tr(
          "无法自动确定分隔符，请手动选择分隔符后重试。",
          "Separator could not be detected automatically. Choose a separator explicitly and retry.",
        )
      );
    case "quotes":
      return (
        prefix +
        (rowText ? `${rowText}：` : "") +
        tr(
          "引号结构错误，无法安全确定单元格边界。",
          "Broken quoting: cell boundaries cannot be safely determined.",
        )
      );
    case "columns":
      return (
        prefix +
        (rowText ? `${rowText}：` : "") +
        tr(
          "该记录的列数与首行表头不一致。",
          "This record has a different column count from the header row.",
        )
      );
    case "duplicate_headers":
      return (
        prefix +
        tr(
          `存在重复表头列名「${res.column || ""}」，请先确保待对比列名唯一。`,
          `Duplicate header column "${res.column || ""}". Make compared header names unique first.`,
        )
      );
    case "missing_key_column":
      return (
        prefix +
        tr(
          `缺少所选主键列「${res.column || ""}」。`,
          `Missing selected key column "${res.column || ""}".`,
        )
      );
    case "missing_numeric_column":
      return (
        prefix +
        tr(
          `缺少所选数值列「${res.column || ""}」。`,
          `Missing selected numeric column "${res.column || ""}".`,
        )
      );
    case "invalid_key_column":
      return tr(
        "请选择 1 个主键列，或选择 2 个不同的主键列。",
        "Choose 1 key column, or 2 different key columns.",
      );
    case "blank_key":
      return (
        prefix +
        tr(
          `第 ${res.row} 条记录的主键为空。为避免错误匹配，已停止对比。`,
          `Blank key at record ${res.row}. Comparison stopped instead of guessing matches.`,
        )
      );
    case "duplicate_key":
      return (
        prefix +
        tr(
          `第 ${res.row} 条记录的主键与第 ${res.firstRow} 条重复。为避免静默覆盖，已停止对比。`,
          `Duplicate key at record ${res.row} (first seen at record ${res.firstRow}). Comparison stopped instead of overwriting rows.`,
        )
      );
    default:
      return tr(
        "无法解析表格，请检查格式、编码和分隔符。",
        "Could not parse the tables. Check format, encoding and separator.",
      );
  }
}

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

function addNotice(container, text) {
  const p = document.createElement("p");
  p.className = "notice";
  p.textContent = text;
  container.append(p);
}

function showError(text) {
  $("diff-error").textContent = text;
  $("diff-error").hidden = false;
}

function clearOutput() {
  if (url) URL.revokeObjectURL(url);
  url = null;
  $("diff-download").hidden = true;
  $("diff-download").removeAttribute("href");
  downloaded = false;
}

function updateCompareEnabled() {
  $("diff-compare").disabled = sides.before.pending || sides.after.pending;
}

function invalidateCompare() {
  version++;
  worker?.terminate();
  worker = null;
  clearOutput();
  $("diff-result").hidden = true;
  $("diff-error").hidden = true;
  $("diff-cancel").hidden = true;
  updateCompareEnabled();
}

function resetColumnSelects(placeholderText) {
  const key1 = $("diff-key1");
  const key2 = $("diff-key2");
  const numeric = $("diff-numeric");
  key1.replaceChildren(
    new Option(
      placeholderText || tr("请先添加两份表格", "Load both tables first"),
      "",
    ),
  );
  key2.replaceChildren(new Option(tr("无", "None"), ""));
  numeric.replaceChildren(new Option(tr("不核对数值列", "None"), ""));
}

function populateColumnSelects(sharedHeaders, beforeOnly, afterOnly) {
  const key1 = $("diff-key1");
  const key2 = $("diff-key2");
  const numeric = $("diff-numeric");
  const prevKey1 = key1.value;
  const prevKey2 = key2.value;
  const prevNumeric = pendingSampleNumeric || numeric.value;
  pendingSampleNumeric = "";

  if (!sharedHeaders.length) {
    resetColumnSelects(tr("两份表格没有相同列名", "No matching headers found"));
    $("diff-columns-status").textContent = tr(
      "未找到两份表格共有的表头列名，请检查第一行表头或分隔符。",
      "No shared column headers found between both tables. Check the first row or separators.",
    );
    return;
  }

  key1.replaceChildren();
  key2.replaceChildren(new Option(tr("无", "None"), ""));
  numeric.replaceChildren(new Option(tr("不核对数值列", "None"), ""));

  for (const h of sharedHeaders) {
    key1.add(new Option(h, h));
    key2.add(new Option(h, h));
    numeric.add(new Option(h, h));
  }

  if (sharedHeaders.includes(prevKey1)) {
    key1.value = prevKey1;
  } else {
    const guessedKey = sharedHeaders.find((h) =>
      /^(id|sku|handle|code|key|编号|商品编码|单号|工号)$/i.test(h),
    );
    key1.value = guessedKey || sharedHeaders[0];
  }
  key2.value =
    sharedHeaders.includes(prevKey2) && prevKey2 !== key1.value ? prevKey2 : "";
  numeric.value = sharedHeaders.includes(prevNumeric) ? prevNumeric : "";

  const extraNote = [];
  if (beforeOnly.length) {
    extraNote.push(
      tr(
        `${beforeOnly.length} 列仅在原表中存在`,
        `${beforeOnly.length} column(s) only in Before`,
      ),
    );
  }
  if (afterOnly.length) {
    extraNote.push(
      tr(
        `${afterOnly.length} 列仅在新表中存在`,
        `${afterOnly.length} column(s) only in After`,
      ),
    );
  }
  $("diff-columns-status").textContent =
    tr(
      `已读取 ${sharedHeaders.length} 个共同列。`,
      `Loaded ${sharedHeaders.length} shared columns.`,
    ) + (extraNote.length ? " " + extraNote.join("；") + "。" : "");
}

function getSideText(side) {
  return sides[side].originalText ?? $(`${side}-input`).value;
}

function inspectColumns(explicit = false) {
  clearTimeout(inspectTimer);
  inspectWorker?.terminate();
  inspectWorker = null;
  inspectVersion++;

  const beforeText = getSideText("before");
  const afterText = getSideText("after");
  if (!beforeText.trim() || !afterText.trim()) {
    resetColumnSelects();
    $("diff-columns-status").textContent = tr(
      "先在上方添加两份表格，即可自动读取共同列名。",
      "Add both tables above to load shared column headers.",
    );
    if (explicit) {
      showError(
        tr(
          "请先同时添加修改前原表和修改后新表。",
          "Add both the original and updated tables first.",
        ),
      );
    }
    return;
  }

  if (
    encoder.encode(beforeText).length > MAX_BYTES ||
    encoder.encode(afterText).length > MAX_BYTES
  ) {
    if (explicit) {
      showError(formatError({ code: "limit" }));
      event("generate_error", { error_code: "input_rejected" });
    }
    return;
  }

  const currentInspect = inspectVersion;
  $("diff-columns-status").textContent = tr(
    "正在读取列名…",
    "Reading column headers...",
  );

  try {
    inspectWorker = new Worker(
      new URL("./csv-diff-worker.js", import.meta.url),
      { type: "module" },
    );
    inspectWorker.onerror = () => {
      if (currentInspect !== inspectVersion) return;
      inspectWorker?.terminate();
      inspectWorker = null;
      if (explicit) {
        showError(
          tr("读取列名失败，请重试。", "Could not read column headers. Please retry."),
        );
      }
    };
    inspectWorker.onmessage = ({ data: r }) => {
      if (currentInspect !== inspectVersion) return;
      inspectWorker?.terminate();
      inspectWorker = null;
      if (r.failed) {
        if (explicit) {
          showError(
            tr("读取列名失败，请重试。", "Could not read column headers. Please retry."),
          );
        }
        return;
      }
      if (!r.ok) {
        resetColumnSelects(tr("表格格式有误", "Fix table format first"));
        $("diff-columns-status").textContent = formatError(r);
        if (explicit) showError(formatError(r));
        return;
      }
      $("diff-error").hidden = true;
      populateColumnSelects(
        r.sharedHeaders,
        r.beforeOnlyHeaders,
        r.afterOnlyHeaders,
      );
    };
    inspectWorker.postMessage({
      action: "inspect",
      beforeText,
      afterText,
      beforeDelimiter: $("before-delimiter").value,
      afterDelimiter: $("after-delimiter").value,
    });
  } catch {
    if (explicit) {
      showError(
        tr("浏览器无法启动列名读取。", "Your browser could not start header inspection."),
      );
    }
  }
}

function scheduleInspect() {
  clearTimeout(inspectTimer);
  inspectTimer = setTimeout(() => inspectColumns(false), 250);
}

async function readSideFile(side, file) {
  invalidateCompare();
  const state = sides[side];
  state.readVersion++;
  const currentRead = state.readVersion;
  state.source = "file";
  state.originalText = null;
  $(`${side}-input`).value = "";

  if (!file.size) {
    $(`${side}-file`).value = "";
    state.dropzone.refresh();
    inspectColumns(false);
    showError(formatError({ side, code: "empty" }));
    event("generate_error", { error_code: "input_rejected" });
    return;
  }

  if (file.size > MAX_BYTES) {
    $(`${side}-file`).value = "";
    state.dropzone.refresh();
    inspectColumns(false);
    showError(formatError({ side, code: "limit" }));
    event("generate_error", { error_code: "input_rejected" });
    return;
  }

  state.pending = true;
  updateCompareEnabled();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (currentRead !== state.readVersion) return;
    state.originalText = decodeCsv(bytes, $(`${side}-encoding`).value);
    $(`${side}-input`).value = state.originalText;
  } catch {
    if (currentRead !== state.readVersion) return;
    showError(
      `${sideLabel(side)}: ` +
        tr(
          "无法按所选编码读取。请选择正确编码后重试，不会用乱码替换原内容。",
          "Cannot decode using this encoding. Select the correct encoding and retry; invalid bytes will not be replaced silently.",
        ),
    );
    event("generate_error", { error_code: "decode_failed" });
  } finally {
    if (currentRead === state.readVersion) {
      state.pending = false;
      updateCompareEnabled();
      inspectColumns(false);
    }
  }
}

for (const side of ["before", "after"]) {
  $(`${side}-input`).oninput = () => {
    sides[side].originalText = null;
    if (sides[side].source === "sample") sides[side].source = "mixed";
    invalidateCompare();
    scheduleInspect();
  };
  $(`${side}-file`).onchange = (e) => {
    if (e.target.files[0]) readSideFile(side, e.target.files[0]);
  };
  $(`${side}-encoding`).onchange = () => {
    invalidateCompare();
    const file = $(`${side}-file`).files[0];
    if (file) readSideFile(side, file);
  };
  $(`${side}-delimiter`).onchange = () => {
    invalidateCompare();
    inspectColumns(false);
  };
}

for (const id of ["diff-key1", "diff-key2", "diff-numeric", "diff-formula"]) {
  $(id).onchange = () => invalidateCompare();
}

$("diff-load-cols").onclick = () => {
  invalidateCompare();
  inspectColumns(true);
};

$("diff-sample").onclick = () => {
  invalidateCompare();
  for (const side of ["before", "after"]) {
    sides[side].source = "sample";
    sides[side].originalText = null;
    sides[side].readVersion++;
    sides[side].pending = false;
    $(`${side}-file`).value = "";
    $(`${side}-delimiter`).value = "";
    sides[side].dropzone.refresh();
  }
  updateCompareEnabled();
  $("before-input").value = tr(
    [
      "商品编码,规格,名称,单价,图片链接,库存",
      "SKU-001,红色,帆布托特包,24.50,https://example.com/tote-red.jpg,15",
      "SKU-002,蓝色,帆布托特包,24.50,https://example.com/tote-blue.jpg,8",
      "SKU-003,黑色,羊毛围巾,39.90,https://example.com/scarf.jpg,12",
      "SKU-004,灰色,亚麻鸭舌帽,18.00,https://example.com/cap.jpg,5",
    ].join("\n"),
    [
      "sku,variant,title,price,image_url,stock",
      "SKU-001,Red,Canvas Tote,24.50,https://example.com/tote-red.jpg,15",
      "SKU-002,Blue,Canvas Tote,24.50,https://example.com/tote-blue.jpg,8",
      "SKU-003,Black,Wool Scarf,39.90,https://example.com/scarf.jpg,12",
      "SKU-004,Gray,Linen Cap,18.00,https://example.com/cap.jpg,5",
    ].join("\n"),
  );
  $("after-input").value = tr(
    [
      "商品编码,规格,名称,单价,图片链接,库存",
      "SKU-001,红色,帆布托特包,26.00,https://example.com/tote-red.jpg,15",
      "SKU-002,蓝色,帆布托特包,26.00,,8",
      "SKU-003,黑色,羊毛围巾,39.90,https://example.com/scarf.jpg,12",
      "SKU-005,绿色,纯棉渔夫帽,22.10,https://example.com/hat.jpg,20",
    ].join("\n"),
    [
      "sku,variant,title,price,image_url,stock",
      "SKU-001,Red,Canvas Tote,26.00,https://example.com/tote-red.jpg,15",
      "SKU-002,Blue,Canvas Tote,26.00,,8",
      "SKU-003,Black,Wool Scarf,39.90,https://example.com/scarf.jpg,12",
      "SKU-005,Green,Cotton Hat,22.10,https://example.com/hat.jpg,20",
    ].join("\n"),
  );
  $("diff-formula").value = "ask";
  pendingSampleNumeric = tr("单价", "price");
  inspectColumns(false);
};

$("diff-clear").onclick = () => {
  clearTimeout(inspectTimer);
  inspectWorker?.terminate();
  inspectWorker = null;
  inspectVersion++;
  invalidateCompare();
  startedSources.clear();
  readySources.clear();
  pendingSampleNumeric = "";
  for (const side of ["before", "after"]) {
    sides[side].source = "file";
    sides[side].originalText = null;
    sides[side].readVersion++;
    sides[side].pending = false;
    $(`${side}-input`).value = "";
    $(`${side}-file`).value = "";
    $(`${side}-delimiter`).value = "";
    sides[side].dropzone.refresh();
  }
  resetColumnSelects();
  $("diff-columns-status").textContent = tr(
    "先在上方添加两份表格，即可自动读取共同列名。",
    "Add both tables above to load shared column headers.",
  );
  updateCompareEnabled();
};

$("diff-cancel").onclick = () => {
  invalidateCompare();
  showError(tr("已取消对比，输入仍保留。", "Cancelled. Your inputs are preserved."));
  event("generate_cancel");
};

function renderResult(r) {
  $("diff-result").hidden = false;

  const summaryText =
    r.totalReportRows === 0 && !r.removedColumns.length && !r.addedColumns.length
      ? tr(
          `未发现差异：共匹配 ${r.unchangedRows.toLocaleString("en-US")} 行，内容完全一致。`,
          `No differences found across ${r.unchangedRows.toLocaleString("en-US")} matched rows.`,
        )
      : tr(
          `发现 ${r.totalReportRows.toLocaleString("en-US")} 处差异（${r.modifiedRows} 行修改、${r.addedRows} 行新增、${r.removedRows} 行删除）。`,
          `Found ${r.totalReportRows.toLocaleString("en-US")} differences (${r.modifiedRows} modified, ${r.addedRows} added, ${r.removedRows} removed rows).`,
        );
  $("diff-summary").textContent = summaryText;

  $("diff-metrics").replaceChildren(
    metric(
      r.unchangedRows.toLocaleString("en-US"),
      tr("未变动行", "unchanged rows"),
      r.modifiedRows === 0 && r.addedRows === 0 && r.removedRows === 0 ? "ok" : "",
    ),
    metric(
      r.modifiedRows.toLocaleString("en-US"),
      tr("修改行", "modified rows"),
      r.modifiedRows > 0 ? "warn" : "",
    ),
    metric(r.addedRows.toLocaleString("en-US"), tr("新增行", "added rows")),
    metric(
      r.removedRows.toLocaleString("en-US"),
      tr("删除行", "removed rows"),
      r.removedRows > 0 ? "warn" : "",
    ),
    metric(
      r.wipedCells.toLocaleString("en-US"),
      tr("被清空单元格", "wiped cells"),
      r.wipedCells > 0 ? "warn" : "ok",
    ),
  );

  const warnings = $("diff-warnings");
  warnings.replaceChildren();
  if (r.wipedCells > 0) {
    addNotice(
      warnings,
      tr(
        `注意：有 ${r.wipedCells} 个单元格从有值变成了空白。导入前请确认是否为误删字段（例如图片链接或描述）。`,
        `Warning: ${r.wipedCells} cell(s) changed from non-empty to blank. Check whether fields such as image URLs or descriptions were accidentally wiped before importing.`,
      ),
    );
  }
  if (r.removedColumns.length > 0) {
    addNotice(
      warnings,
      tr(
        `注意：修改后新表缺少原表中的 ${r.removedColumns.length} 列：${r.removedColumns.join("、")}。`,
        `Warning: ${r.removedColumns.length} column(s) present in Before are missing from After: ${r.removedColumns.join(", ")}.`,
      ),
    );
  }
  if (r.numericSummary?.signFlipped) {
    addNotice(
      warnings,
      tr(
        `警告：数值列「${r.numericSummary.column}」所有匹配的非零行在新表中正负号全部反转（例如 +12.50 变成 -12.50），请核对借贷或收支符号方向！`,
        `Warning: Every matched non-zero value in "${r.numericSummary.column}" flipped sign in After (for example +12.50 to -12.50). Check debit/credit sign direction before importing.`,
      ),
    );
  }
  if (r.numericSummary && r.numericSummary.unparseableCount > 0) {
    addNotice(
      warnings,
      tr(
        `注意：数值列「${r.numericSummary.column}」中有 ${r.numericSummary.unparseableCount} 个单元格不是标准十进制数字（可能含货币符号、千分位逗号、科学计数法或文字），已跳过未按 0 计入总和。`,
        `Warning: ${r.numericSummary.unparseableCount} cell(s) in "${r.numericSummary.column}" are not plain decimal numbers (for example currency symbols, commas, scientific notation or text). They were excluded rather than counted as 0.`,
      ),
    );
  }
  if (r.needsFormulaChoice) {
    addNotice(
      warnings,
      tr(
        "差异内容中发现可能被表格软件执行为公式的单元格。请在上方「导出中疑似公式的单元格」中选择加前导单引号或原样保留后重新对比，再下载报告。",
        'Formula-like cells were found in the diff output. Choose "Prefix an apostrophe" or "Preserve exactly" under "Formula-like cells in export" and compare again to download.',
      ),
    );
  } else if (r.hasFormulaLike && $("diff-formula").value === "escape") {
    addNotice(
      warnings,
      tr(
        "差异报告中的疑似公式单元格已自动添加前导单引号（'）以防止表格软件执行。",
        "Formula-like cells in the downloadable report have been prefixed with an apostrophe (') to prevent spreadsheet execution.",
      ),
    );
  }

  // Numeric summary box
  const numBox = $("diff-numeric-box");
  const numFields = $("diff-numeric-fields");
  numFields.replaceChildren();
  if (r.numericSummary) {
    numBox.hidden = false;
    const ns = r.numericSummary;
    const pairs = [
      [tr("核对列", "Column"), ns.column],
      [tr("修改前总和", "Before total"), ns.beforeSum],
      [tr("修改后总和", "After total"), ns.afterSum],
      [tr("净变化（新 − 旧）", "Net change (After − Before)"), ns.netDelta],
      [
        tr("单元格统计", "Cell breakdown"),
        tr(
          `有效数字 ${ns.parsedCount} · 空白 ${ns.blankCount} · 无法解析 ${ns.unparseableCount}`,
          `${ns.parsedCount} parsed · ${ns.blankCount} blank · ${ns.unparseableCount} unparseable`,
        ),
      ],
    ];
    for (const [k, v] of pairs) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      numFields.append(dt, dd);
    }
  } else {
    numBox.hidden = true;
  }

  // Per-column summary list
  const colList = $("diff-columns-summary");
  colList.replaceChildren();
  for (const col of r.columnSummary) {
    const li = document.createElement("li");
    li.textContent =
      col.wipedCount > 0
        ? tr(
            `列「${col.column}」：${col.changedCount} 处变更（其中 ${col.wipedCount} 处被清空）`,
            `Column "${col.column}": ${col.changedCount} changed (${col.wipedCount} wiped to blank)`,
          )
        : tr(
            `列「${col.column}」：${col.changedCount} 处变更`,
            `Column "${col.column}": ${col.changedCount} changed`,
          );
    colList.append(li);
  }
  if (r.addedColumns.length > 0) {
    const li = document.createElement("li");
    li.textContent = tr(
      `仅在新表中新增的列：${r.addedColumns.join("、")}`,
      `Columns added in After: ${r.addedColumns.join(", ")}`,
    );
    colList.append(li);
  }

  // Diff preview table (first 100 rows)
  const previewBody = $("diff-preview");
  previewBody.replaceChildren();
  if (r.preview.length > 0) {
    $("diff-preview-wrap").hidden = false;
    $("diff-preview-note").textContent =
      r.totalReportRows > r.preview.length
        ? tr(
            `预览显示前 ${r.preview.length} 条差异（共 ${r.totalReportRows.toLocaleString("en-US")} 条；被清空单元格排在最前）。下载 CSV 包含全部差异。`,
            `Showing first ${r.preview.length} of ${r.totalReportRows.toLocaleString("en-US")} differences (wiped cells listed first). The downloaded CSV includes all differences.`,
          )
        : tr(
            `共显示全部 ${r.preview.length} 条差异（被清空单元格排在最前）。`,
            `Showing all ${r.preview.length} differences (wiped cells listed first).`,
          );

    const headerRow = document.createElement("tr");
    for (const heading of [
      tr("变更类型", "Change"),
      tr("主键", "Key"),
      tr("列名", "Column"),
      tr("修改前", "Before"),
      tr("修改后", "After"),
    ]) {
      const td = document.createElement("td");
      td.textContent = heading;
      headerRow.append(td);
    }
    previewBody.append(headerRow);

    for (const row of r.preview) {
      const trEl = document.createElement("tr");
      const cells = [
        changeLabels[row[0]] || row[0],
        row[1],
        row[2],
        row[3],
        row[4],
      ];
      for (const cell of cells) {
        const td = document.createElement("td");
        td.textContent = cell;
        trEl.append(td);
      }
      previewBody.append(trEl);
    }
  } else {
    $("diff-preview-wrap").hidden = true;
    $("diff-preview-note").textContent = tr(
      "两份表格的匹配行内容一致，没有单元格或行级差异。",
      "Matched rows have no cell or row differences to preview.",
    );
  }

  if (r.output !== null) {
    url = URL.createObjectURL(
      new Blob([r.output], { type: "text/csv;charset=utf-8" }),
    );
    $("diff-download").href = url;
    $("diff-download").hidden = false;
  }
}

$("diff-compare").onclick = () => {
  invalidateCompare();
  const beforeText = getSideText("before");
  const afterText = getSideText("after");

  if (!beforeText.trim() || !afterText.trim()) {
    showError(
      tr(
        "请先同时添加修改前原表和修改后新表。",
        "Add both the original and updated tables before comparing.",
      ),
    );
    event("generate_error", { error_code: "input_rejected" });
    return;
  }
  if (
    encoder.encode(beforeText).length > MAX_BYTES ||
    encoder.encode(afterText).length > MAX_BYTES
  ) {
    showError(formatError({ code: "limit" }));
    event("generate_error", { error_code: "input_rejected" });
    return;
  }

  const key1 = $("diff-key1").value;
  const key2 = $("diff-key2").value;
  if (!key1) {
    showError(
      tr(
        "请先点击「读取列名」并选择一个主键列。",
        'Click "Load columns" and choose a key column first.',
      ),
    );
    event("generate_error", { error_code: "input_rejected" });
    return;
  }
  if (key2 && key2 === key1) {
    showError(formatError({ code: "invalid_key_column" }));
    event("generate_error", { error_code: "input_rejected" });
    return;
  }

  const keyColumns = key2 ? [key1, key2] : [key1];
  const numericColumn = $("diff-numeric").value;
  const formula = $("diff-formula").value;

  const startSrc = inputSource();
  if (!startedSources.has(startSrc)) {
    startedSources.add(startSrc);
    event("tool_start");
  }
  $("diff-compare").disabled = true;
  $("diff-cancel").hidden = false;
  const current = version;

  try {
    worker = new Worker(new URL("./csv-diff-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onerror = () => {
      if (current !== version) return;
      invalidateCompare();
      showError(
        tr(
          "对比未完成，请减少内容后重试。",
          "Could not finish comparing. Try smaller inputs.",
        ),
      );
      event("generate_error", { error_code: "generation_failed" });
    };
    worker.onmessage = ({ data: r }) => {
      if (current !== version) return;
      worker.terminate();
      worker = null;
      $("diff-cancel").hidden = true;
      updateCompareEnabled();

      if (r.failed) {
        showError(
          tr("无法完成表格对比。", "Could not complete the comparison."),
        );
        event("generate_error", { error_code: "generation_failed" });
        return;
      }
      if (!r.ok) {
        showError(formatError(r));
        event("generate_error", { error_code: "input_rejected" });
        return;
      }
      renderResult(r);
      if (r.output !== null) {
        const readySrc = inputSource();
        if (!readySources.has(readySrc)) {
          readySources.add(readySrc);
          event("csv_diff_ready");
        }
      }
    };
    worker.postMessage({
      action: "compare",
      beforeText,
      afterText,
      beforeDelimiter: $("before-delimiter").value,
      afterDelimiter: $("after-delimiter").value,
      keyColumns,
      numericColumn,
      formula,
    });
  } catch {
    invalidateCompare();
    showError(
      tr("浏览器无法启动对比任务。", "Your browser could not start the comparison."),
    );
    event("generate_error", { error_code: "generation_failed" });
  }
};

$("diff-download").onclick = () => {
  if (url && !downloaded) {
    downloaded = true;
    event("download_click");
  }
};

window.addEventListener("beforeunload", (e) => {
  if ($("before-input").value || $("after-input").value) {
    e.preventDefault();
    e.returnValue = "";
  }
});

setupAnalytics();
