import { tr, pageCount } from "./i18n.js";
import { formatBytes } from "./core.js";
import { setupAnalytics, track } from "./analytics-ui.js";
import { setupDropzone } from "./dropzone.js";
import "./page-ui.js";
import {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_COMBINED_PAGES,
  loadValidatedPdf,
  planInterleave,
  buildInterleavedPdf,
  createSampleScanPdfs,
} from "./interleave-core.js";

const $ = (id) => document.getElementById(id);

let front = null;
let back = null;
let busy = false;
let frontVersion = 0;
let backVersion = 0;
let combineVersion = 0;
let resultUrl = null;
let downloadTracked = false;
const startedSources = new Set();

const frontDrop = setupDropzone({
  zone: $("front-drop"),
  input: $("front-file"),
  status: $("front-status"),
});
const backDrop = setupDropzone({
  zone: $("back-drop"),
  input: $("back-file"),
  status: $("back-status"),
});

function inputSource(fallback = "file") {
  const sources = new Set([front?.source, back?.source].filter(Boolean));
  if (sources.size > 1) return "mixed";
  if (sources.size === 1) return [...sources][0];
  return fallback;
}

const taskEvent = (name, extra = {}) =>
  track(name, { input_source: inputSource(), ...extra });

function markStarted() {
  const src = inputSource();
  if (!startedSources.has(src)) {
    startedSources.add(src);
    taskEvent("tool_start");
  }
}

function showError(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function errorMessage(code) {
  switch (code) {
    case "empty":
      return tr(
        "文件为空，无法读取。请重新选择 PDF 文件。",
        "This file is empty. Please choose a valid PDF file.",
      );
    case "not_pdf":
      return tr(
        "这不是有效的 PDF 文件（缺少 %PDF- 文件头）。请选择扫描生成的 PDF。",
        "This does not appear to be a PDF file (missing %PDF- header). Please choose a PDF.",
      );
    case "file_too_large":
      return tr(
        "单个 PDF 不能超过 50 MB。",
        "Each PDF must be 50 MB or smaller.",
      );
    case "total_too_large":
      return tr(
        "两份 PDF 合并前总大小不能超过 80 MB。",
        "Both PDFs combined must be 80 MB or smaller.",
      );
    case "encrypted":
      return tr(
        "这份 PDF 受密码保护或已加密，本工具无法读取加密 PDF。请先用 PDF 阅读器解除密码后再试。",
        "This PDF is password-protected or encrypted and cannot be read here. Unlock it in a PDF viewer first.",
      );
    case "no_pages":
      return tr(
        "这份 PDF 不包含任何页面。",
        "This PDF contains no pages.",
      );
    case "too_many_pages":
      return tr(
        "两份 PDF 合计最多支持 500 页，请分批处理。",
        "Up to 500 combined pages are supported. Please split into smaller batches.",
      );
    default:
      return tr(
        "无法读取这份 PDF，文件可能已损坏或格式不受支持。",
        "Could not read this PDF. The file may be damaged or unsupported.",
      );
  }
}

function analyticsErrorCode(code) {
  if (
    code === "empty" ||
    code === "not_pdf" ||
    code === "file_too_large" ||
    code === "total_too_large" ||
    code === "too_many_pages"
  ) {
    return "input_rejected";
  }
  if (code === "encrypted" || code === "invalid_pdf" || code === "no_pages") {
    return "decode_failed";
  }
  return "generation_failed";
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

function invalidateResult() {
  combineVersion++;
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  downloadTracked = false;
  $("result").hidden = true;
  $("download").removeAttribute("href");
  $("pdf-preview").removeAttribute("src");
  $("pdf-preview").hidden = true;
  $("preview").textContent = tr("预览 PDF", "Preview PDF");
}

function setBusy(value) {
  busy = value;
  for (const id of [
    "front-file",
    "back-file",
    "sample",
    "clear",
    "back-order",
    "rotate-back",
    "filename",
  ]) {
    $(id).disabled = value;
  }
  updateCombineButton();
}

function hasValidPair() {
  if (!front || !back) return false;
  if (front.size + back.size > MAX_TOTAL_BYTES) return false;
  if (front.pageCount + back.pageCount > MAX_COMBINED_PAGES) return false;
  return true;
}

function updateCombineButton() {
  $("combine").disabled = busy || !hasValidPair();
}

function downloadName() {
  const value = $("filename")
    .value.trim()
    .replace(/\.pdf$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .slice(0, 60);
  return `${value || tr("双面合并文档", "combined-scan")}.pdf`;
}

function makeRow(cells) {
  const trEl = document.createElement("tr");
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    trEl.append(td);
  }
  return trEl;
}

function formatStepRow(step) {
  const sourceLabel =
    step.source === "front"
      ? tr("正面（奇数页）", "Front (odd)")
      : tr("背面（偶数页）", "Back (even)");
  const pageLabel = step.rotated180
    ? tr(`第 ${step.sourcePage} 页（旋转 180°）`, `Page ${step.sourcePage} (+180°)`)
    : tr(`第 ${step.sourcePage} 页`, `Page ${step.sourcePage}`);
  return makeRow([String(step.outputPage), sourceLabel, pageLabel]);
}

function renderPlan() {
  if (!front || !back) {
    $("plan-panel").hidden = true;
    updateCombineButton();
    return;
  }

  if (front.size + back.size > MAX_TOTAL_BYTES) {
    $("plan-panel").hidden = true;
    showError(errorMessage("total_too_large"));
    updateCombineButton();
    return;
  }

  if (front.pageCount + back.pageCount > MAX_COMBINED_PAGES) {
    $("plan-panel").hidden = true;
    showError(errorMessage("too_many_pages"));
    updateCombineButton();
    return;
  }

  const reverseBack = $("back-order").value === "reverse";
  const rotateBack180 = $("rotate-back").value === "180";
  const plan = planInterleave(front.pageCount, back.pageCount, {
    reverseBack,
    rotateBack180,
  });

  const statusText =
    plan.status === "matched"
      ? tr("页数一致", "Matched")
      : plan.status === "odd_last_sheet"
        ? tr("末页单面", "Odd last sheet")
        : tr("页数不符", "Mismatch");
  const statusTone = plan.status === "matched" ? "ok" : "warn";

  $("plan-metrics").replaceChildren(
    metric(String(front.pageCount), tr("正面页数", "front pages")),
    metric(String(back.pageCount), tr("背面页数", "back pages")),
    metric(String(plan.totalPages), tr("合并后总页数", "total output")),
    metric(statusText, tr("核对状态", "status"), statusTone),
  );

  const warning = $("plan-warning");
  if (plan.status === "odd_last_sheet") {
    warning.textContent = tr(
      `正面比背面多 1 页（${front.pageCount} 页对 ${back.pageCount} 页）。如果最后一页背面为空白未扫描，这是常见情况；正面第 ${front.pageCount} 页会放在末尾，不会丢弃任何页面。`,
      `Front has 1 more page than Back (${front.pageCount} vs ${back.pageCount}). This is common when the last sheet had a blank back. Front page ${front.pageCount} will be placed at the end—no page is dropped.`,
    );
    warning.hidden = false;
  } else if (plan.status === "mismatch") {
    const diff = Math.abs(plan.difference);
    warning.textContent = tr(
      `正反两份页数相差 ${diff} 页（正面 ${front.pageCount} 页，背面 ${back.pageCount} 页），可能是扫描仪重张进纸或漏扫。合并时会把多余页面追加在末尾，不会丢弃任何页面，请核对下方页序。`,
      `Page counts differ by ${diff} (${front.pageCount} front vs ${back.pageCount} back). Check for a missed page or double-feed in your scanner. All extra pages will be appended at the end so nothing is dropped.`,
    );
    warning.hidden = false;
  } else {
    warning.textContent = "";
    warning.hidden = true;
  }

  const tbody = $("plan-table");
  tbody.replaceChildren(
    makeRow([
      tr("输出页码", "Output page"),
      tr("来源文件", "Source"),
      tr("原页码", "Source page"),
    ]),
  );

  const MAX_VISIBLE = 40;
  if (plan.steps.length <= MAX_VISIBLE) {
    for (const step of plan.steps) tbody.append(formatStepRow(step));
    $("plan-note").textContent = tr(
      "下方列出合并后的全部页序，可先核对首页与尾页是否配对正确。",
      "Showing every page in output order. Check the first and last pairs before combining.",
    );
  } else {
    const headCount = 20;
    const tailCount = 20;
    const omitted = plan.steps.length - headCount - tailCount;
    for (const step of plan.steps.slice(0, headCount))
      tbody.append(formatStepRow(step));
    tbody.append(
      makeRow([
        "…",
        tr(`中间省略 ${omitted} 页`, `${omitted} middle pages omitted`),
        "…",
      ]),
    );
    for (const step of plan.steps.slice(-tailCount))
      tbody.append(formatStepRow(step));
    $("plan-note").textContent = tr(
      `预览仅显示前 ${headCount} 页和后 ${tailCount} 页，方便核对首尾配对；导出的 PDF 包含全部 ${plan.steps.length} 页。`,
      `Preview shows the first ${headCount} and last ${tailCount} pages to verify head and tail pairing. The combined PDF includes all ${plan.steps.length} pages.`,
    );
  }

  $("plan-panel").hidden = false;
  updateCombineButton();
}

async function loadSide(side, file) {
  const isFront = side === "front";
  const currentVersion = isFront ? ++frontVersion : ++backVersion;
  const fileInput = $(isFront ? "front-file" : "back-file");
  const statusEl = $(isFront ? "front-status" : "back-status");
  const sideLabel = isFront ? tr("正面 PDF", "Front PDF") : tr("背面 PDF", "Back PDF");

  invalidateResult();
  showError();
  if (isFront) front = null;
  else back = null;
  renderPlan();

  if (!file) {
    if (isFront) frontDrop.refresh();
    else backDrop.refresh();
    return;
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    fileInput.value = "";
    statusEl.textContent = tr("读取失败", "Could not read file");
    showError(`${sideLabel}：${errorMessage("empty")}`);
    track("generate_error", { input_source: "file", error_code: "input_rejected" });
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    fileInput.value = "";
    statusEl.textContent = tr("读取失败", "Could not read file");
    showError(`${sideLabel}：${errorMessage("file_too_large")}`);
    track("generate_error", { input_source: "file", error_code: "input_rejected" });
    return;
  }

  statusEl.textContent = tr(
    `${file.name} · 正在读取…`,
    `${file.name} · Reading…`,
  );

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loaded = await loadValidatedPdf(bytes);
    if (currentVersion !== (isFront ? frontVersion : backVersion)) return;

    const record = {
      doc: loaded.doc,
      bytes: loaded.bytes,
      pageCount: loaded.pageCount,
      size: loaded.byteLength,
      source: "file",
    };
    if (isFront) front = record;
    else back = record;

    statusEl.textContent = `${file.name} · ${formatBytes(loaded.byteLength)} · ${pageCount(loaded.pageCount)}`;

    if (
      front &&
      back &&
      (front.size + back.size > MAX_TOTAL_BYTES ||
        front.pageCount + back.pageCount > MAX_COMBINED_PAGES)
    ) {
      taskEvent("generate_error", { error_code: "input_rejected" });
    } else {
      markStarted();
    }
    renderPlan();
  } catch (err) {
    if (currentVersion !== (isFront ? frontVersion : backVersion)) return;
    if (isFront) front = null;
    else back = null;
    fileInput.value = "";
    statusEl.textContent = tr("读取失败", "Could not read file");
    showError(`${sideLabel}：${errorMessage(err?.code)}`);
    track("generate_error", {
      input_source: "file",
      error_code: analyticsErrorCode(err?.code),
    });
    renderPlan();
  }
}

$("front-file").addEventListener("change", (e) => {
  loadSide("front", e.target.files?.[0] ?? null);
});

$("back-file").addEventListener("change", (e) => {
  loadSide("back", e.target.files?.[0] ?? null);
});

$("sample").onclick = async () => {
  if (busy) return;
  frontVersion++;
  backVersion++;
  invalidateResult();
  showError();
  setBusy(true);
  try {
    const sample = await createSampleScanPdfs();
    const [frontLoaded, backLoaded] = await Promise.all([
      loadValidatedPdf(sample.frontBytes),
      loadValidatedPdf(sample.backBytes),
    ]);
    $("front-file").value = "";
    $("back-file").value = "";
    front = {
      doc: frontLoaded.doc,
      bytes: frontLoaded.bytes,
      pageCount: frontLoaded.pageCount,
      size: frontLoaded.byteLength,
      source: "sample",
    };
    back = {
      doc: backLoaded.doc,
      bytes: backLoaded.bytes,
      pageCount: backLoaded.pageCount,
      size: backLoaded.byteLength,
      source: "sample",
    };
    $("front-status").textContent = `${sample.frontName} · ${formatBytes(frontLoaded.byteLength)} · ${pageCount(frontLoaded.pageCount)}`;
    $("back-status").textContent = `${sample.backName} · ${formatBytes(backLoaded.byteLength)} · ${pageCount(backLoaded.pageCount)}`;
    $("back-order").value = "reverse";
    $("rotate-back").value = "0";
    markStarted();
    renderPlan();
  } catch {
    showError(
      tr("无法生成示例 PDF，请重试。", "Could not create sample PDFs. Please try again."),
    );
    track("generate_error", {
      input_source: "sample",
      error_code: "generation_failed",
    });
  } finally {
    setBusy(false);
  }
};

$("clear").onclick = () => {
  if (busy) return;
  frontVersion++;
  backVersion++;
  front = null;
  back = null;
  startedSources.clear();
  $("front-file").value = "";
  $("back-file").value = "";
  frontDrop.refresh();
  backDrop.refresh();
  invalidateResult();
  showError();
  renderPlan();
};

for (const id of ["back-order", "rotate-back"]) {
  $(id).addEventListener("change", () => {
    invalidateResult();
    showError();
    renderPlan();
  });
}

$("filename").addEventListener("input", () => {
  if (resultUrl) $("download").download = downloadName();
});

$("combine").onclick = async () => {
  if (busy || !hasValidPair()) return;
  invalidateResult();
  showError();
  markStarted();
  const currentCombine = ++combineVersion;
  const reverseBack = $("back-order").value === "reverse";
  const rotateBack180 = $("rotate-back").value === "180";

  setBusy(true);
  $("combine").textContent = tr("正在合并…", "Combining…");
  try {
    const { bytes, plan } = await buildInterleavedPdf(front, back, {
      reverseBack,
      rotateBack180,
    });
    if (currentCombine !== combineVersion) return;

    resultUrl = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
    $("result-title").textContent = tr("PDF 已穿插合并完成", "Combined PDF is ready");
    $("result-stats").textContent = `${pageCount(plan.totalPages)} · ${formatBytes(bytes.length)}`;
    $("download").href = resultUrl;
    $("download").download = downloadName();
    $("result").hidden = false;
    taskEvent("interleave_ready");
    $("result").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "nearest",
    });
  } catch (err) {
    if (currentCombine !== combineVersion) return;
    showError(errorMessage(err?.code));
    taskEvent("generate_error", {
      error_code: analyticsErrorCode(err?.code),
    });
  } finally {
    $("combine").textContent = tr("穿插合并 PDF", "Combine front & back");
    setBusy(false);
  }
};

$("download").addEventListener("click", () => {
  if (resultUrl && !downloadTracked) {
    downloadTracked = true;
    taskEvent("download_click");
  }
});

$("preview").onclick = () => {
  if (!resultUrl) return;
  const frame = $("pdf-preview");
  frame.hidden = !frame.hidden;
  if (!frame.hidden) frame.src = resultUrl;
  $("preview").textContent = frame.hidden
    ? tr("预览 PDF", "Preview PDF")
    : tr("收起预览", "Hide preview");
};

window.addEventListener("beforeunload", (e) => {
  if (front || back) {
    e.preventDefault();
    e.returnValue = "";
  }
});

renderPlan();
setupAnalytics();
