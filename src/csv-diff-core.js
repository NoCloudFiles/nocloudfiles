import Papa from "papaparse";
import { inspectCsv, formulaPattern } from "./csv-core.js";

export const MAX_BYTES = 2_000_000;
export const MAX_ROWS = 20_000;
export const MAX_COLS = 200;
export const MAX_FRACTION_DIGITS = 18;

const textEncoder = new TextEncoder();

export function isFormulaLikeCell(value) {
  return typeof value === "string" && formulaPattern.test(value);
}

/**
 * Parse a standard decimal string into exact BigInt representation scaled to 10^18.
 * Rejects scientific notation, currency symbols, thousand separators, and non-numeric text.
 */
export function parseExactDecimal(value) {
  if (typeof value !== "string") return { ok: false, blank: false };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, blank: true };
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return { ok: false, blank: false };
  const sign = match[1] === "-" ? -1n : 1n;
  const intPart = match[2];
  const fracPart = match[3] || "";
  if (fracPart.length > MAX_FRACTION_DIGITS || intPart.length > 100) {
    return { ok: false, blank: false };
  }
  const padded = intPart + fracPart.padEnd(MAX_FRACTION_DIGITS, "0");
  const magnitude = BigInt(padded);
  const scaled18 = magnitude === 0n ? 0n : sign * magnitude;
  return { ok: true, blank: false, scaled18, scale: fracPart.length };
}

/**
 * Format an exact 10^18-scaled BigInt decimal at the given fractional precision.
 */
export function formatExactDecimal(scaled18, scale = 0) {
  const clampedScale = Math.max(0, Math.min(MAX_FRACTION_DIGITS, scale));
  if (scaled18 === 0n) {
    return clampedScale === 0 ? "0" : "0." + "0".repeat(clampedScale);
  }
  const negative = scaled18 < 0n;
  const abs = negative ? -scaled18 : scaled18;
  const divisor =
    clampedScale === MAX_FRACTION_DIGITS
      ? 1n
      : 10n ** BigInt(MAX_FRACTION_DIGITS - clampedScale);
  const units = abs / divisor;
  const prefix = negative ? "-" : "";
  if (clampedScale === 0) return prefix + units.toString();
  const digits = units.toString().padStart(clampedScale + 1, "0");
  const intPart = digits.slice(0, -clampedScale);
  const fracPart = digits.slice(-clampedScale);
  return `${prefix}${intPart}.${fracPart}`;
}

export function parseTable(
  text,
  {
    delimiter = "",
    maxRows = MAX_ROWS,
    maxChars = MAX_BYTES,
    maxBytes = MAX_BYTES,
  } = {},
) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, code: "empty", rows: [], delimiter };
  }
  if (text.length > maxChars || textEncoder.encode(text).length > maxBytes) {
    return { ok: false, code: "limit", rows: [], delimiter };
  }
  const result = inspectCsv(text, { delimiter, maxRows, maxChars });
  if (!result.ok) {
    const firstError = result.issues.find((i) => i.severity === "error");
    return {
      ok: false,
      code: firstError?.code || "invalid",
      row: firstError?.row,
      rows: [],
      delimiter: result.delimiter,
      issues: result.issues,
    };
  }
  if (!result.rows.length || !result.rows[0].length) {
    return { ok: false, code: "empty", rows: [], delimiter: result.delimiter };
  }
  return {
    ok: true,
    rows: result.rows,
    headers: result.rows[0].map((h) => h.trim()),
    delimiter: result.delimiter,
    issues: result.issues,
  };
}

function countHeaders(headers) {
  const counts = new Map();
  const firstIndex = new Map();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    counts.set(h, (counts.get(h) || 0) + 1);
    if (!firstIndex.has(h)) firstIndex.set(h, i);
  }
  return { counts, firstIndex };
}

export function inspectTablePair(
  beforeText,
  afterText,
  { beforeDelimiter = "", afterDelimiter = "" } = {},
) {
  const before = parseTable(beforeText, { delimiter: beforeDelimiter });
  if (!before.ok) {
    return { ok: false, side: "before", code: before.code, row: before.row };
  }
  const after = parseTable(afterText, { delimiter: afterDelimiter });
  if (!after.ok) {
    return { ok: false, side: "after", code: after.code, row: after.row };
  }
  const bInfo = countHeaders(before.headers);
  const aInfo = countHeaders(after.headers);
  const seenBefore = new Set();
  const sharedHeaders = [];
  const beforeOnlyHeaders = [];
  for (const h of before.headers) {
    if (!h || seenBefore.has(h)) continue;
    seenBefore.add(h);
    if (aInfo.counts.has(h)) sharedHeaders.push(h);
    else beforeOnlyHeaders.push(h);
  }
  const seenAfter = new Set();
  const afterOnlyHeaders = [];
  for (const h of after.headers) {
    if (!h || seenAfter.has(h)) continue;
    seenAfter.add(h);
    if (!bInfo.counts.has(h)) afterOnlyHeaders.push(h);
  }
  return {
    ok: true,
    before: {
      records: before.rows.length,
      columns: before.headers.length,
      delimiter: before.delimiter,
      headers: before.headers,
    },
    after: {
      records: after.rows.length,
      columns: after.headers.length,
      delimiter: after.delimiter,
      headers: after.headers,
    },
    sharedHeaders,
    beforeOnlyHeaders,
    afterOnlyHeaders,
  };
}

function summarizeRowValues(row, headers, keySet) {
  const parts = [];
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i];
    if (!name || keySet.has(name)) continue;
    const val = row[i] ?? "";
    if (val !== "") parts.push(`${name}=${val}`);
  }
  return parts.join(" | ");
}

function indexTableRows(rows, keyIndices, side) {
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const parts = keyIndices.map((idx) => (row[idx] ?? "").trim());
    if (parts.every((p) => p === "")) {
      return { ok: false, side, code: "blank_key", row: i + 1 };
    }
    const mapKey = JSON.stringify(parts);
    const existing = map.get(mapKey);
    if (existing) {
      return {
        ok: false,
        side,
        code: "duplicate_key",
        row: i + 1,
        firstRow: existing.rowNumber,
      };
    }
    const displayKey = parts.length === 1 ? parts[0] : parts.join(" / ");
    map.set(mapKey, { rowNumber: i + 1, row, displayKey });
  }
  return { ok: true, map };
}

export function compareTables(
  beforeRows,
  afterRows,
  { keyColumns = [], numericColumn = "" } = {},
) {
  if (!Array.isArray(beforeRows) || beforeRows.length < 1 || !beforeRows[0]?.length) {
    return { ok: false, side: "before", code: "empty" };
  }
  if (!Array.isArray(afterRows) || afterRows.length < 1 || !afterRows[0]?.length) {
    return { ok: false, side: "after", code: "empty" };
  }

  const rawKeys = Array.isArray(keyColumns) ? keyColumns : [keyColumns];
  const cleanedKeys = rawKeys
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter((k) => k !== "");
  if (cleanedKeys.length < 1 || cleanedKeys.length > 2) {
    return { ok: false, code: "invalid_key_column" };
  }
  if (cleanedKeys.length === 2 && cleanedKeys[0] === cleanedKeys[1]) {
    return { ok: false, code: "invalid_key_column" };
  }

  const beforeHeaders = beforeRows[0].map((h) => String(h ?? "").trim());
  const afterHeaders = afterRows[0].map((h) => String(h ?? "").trim());
  const bInfo = countHeaders(beforeHeaders);
  const aInfo = countHeaders(afterHeaders);

  // Verify chosen key columns exist and are not duplicated in either table.
  for (const keyCol of cleanedKeys) {
    const bCount = bInfo.counts.get(keyCol) || 0;
    const aCount = aInfo.counts.get(keyCol) || 0;
    if (bCount === 0) {
      return { ok: false, side: "before", code: "missing_key_column", column: keyCol };
    }
    if (aCount === 0) {
      return { ok: false, side: "after", code: "missing_key_column", column: keyCol };
    }
    if (bCount > 1) {
      return { ok: false, side: "before", code: "duplicate_headers", column: keyCol };
    }
    if (aCount > 1) {
      return { ok: false, side: "after", code: "duplicate_headers", column: keyCol };
    }
  }

  // Compute shared, removed, and added columns, rejecting duplicate shared headers.
  const sharedColumns = [];
  const removedColumns = [];
  const addedColumns = [];
  const seenBefore = new Set();
  for (const h of beforeHeaders) {
    if (seenBefore.has(h)) continue;
    seenBefore.add(h);
    if (aInfo.counts.has(h)) {
      if (bInfo.counts.get(h) > 1) {
        return { ok: false, side: "before", code: "duplicate_headers", column: h };
      }
      if (aInfo.counts.get(h) > 1) {
        return { ok: false, side: "after", code: "duplicate_headers", column: h };
      }
      sharedColumns.push(h);
    } else if (h !== "") {
      removedColumns.push(h);
    }
  }
  const seenAfter = new Set();
  for (const h of afterHeaders) {
    if (seenAfter.has(h)) continue;
    seenAfter.add(h);
    if (!bInfo.counts.has(h) && h !== "") {
      addedColumns.push(h);
    }
  }

  // Validate optional numeric column.
  const trimmedNumeric =
    typeof numericColumn === "string" ? numericColumn.trim() : "";
  if (trimmedNumeric) {
    const bCount = bInfo.counts.get(trimmedNumeric) || 0;
    const aCount = aInfo.counts.get(trimmedNumeric) || 0;
    if (bCount === 0) {
      return {
        ok: false,
        side: "before",
        code: "missing_numeric_column",
        column: trimmedNumeric,
      };
    }
    if (aCount === 0) {
      return {
        ok: false,
        side: "after",
        code: "missing_numeric_column",
        column: trimmedNumeric,
      };
    }
    if (bCount > 1) {
      return {
        ok: false,
        side: "before",
        code: "duplicate_headers",
        column: trimmedNumeric,
      };
    }
    if (aCount > 1) {
      return {
        ok: false,
        side: "after",
        code: "duplicate_headers",
        column: trimmedNumeric,
      };
    }
  }

  const beforeKeyIndices = cleanedKeys.map((k) => bInfo.firstIndex.get(k));
  const afterKeyIndices = cleanedKeys.map((k) => aInfo.firstIndex.get(k));

  const beforeIndexed = indexTableRows(beforeRows, beforeKeyIndices, "before");
  if (!beforeIndexed.ok) return beforeIndexed;
  const afterIndexed = indexTableRows(afterRows, afterKeyIndices, "after");
  if (!afterIndexed.ok) return afterIndexed;

  const keySet = new Set(cleanedKeys);
  const comparedColumns = sharedColumns
    .filter((c) => !keySet.has(c))
    .map((column) => ({
      column,
      beforeIdx: bInfo.firstIndex.get(column),
      afterIdx: aInfo.firstIndex.get(column),
      changedCount: 0,
      wipedCount: 0,
    }));

  let unchangedRows = 0;
  let modifiedRows = 0;
  let addedRows = 0;
  let removedRows = 0;
  let wipedCells = 0;
  let filledCells = 0;
  let changedCells = 0;

  const cellDiffs = [];
  const addedEntries = [];
  const removedEntries = [];

  for (const [mapKey, bEntry] of beforeIndexed.map.entries()) {
    const aEntry = afterIndexed.map.get(mapKey);
    if (!aEntry) {
      removedRows++;
      removedEntries.push({
        rowKey: bEntry.displayKey,
        rowNumber: bEntry.rowNumber,
        summary: summarizeRowValues(bEntry.row, beforeHeaders, keySet),
      });
      continue;
    }
    let rowModified = false;
    for (const col of comparedColumns) {
      const beforeValue = bEntry.row[col.beforeIdx] ?? "";
      const afterValue = aEntry.row[col.afterIdx] ?? "";
      if (beforeValue === afterValue) continue;
      rowModified = true;
      col.changedCount++;
      let kind = "changed";
      if (beforeValue.trim() !== "" && afterValue.trim() === "") {
        kind = "wiped";
        col.wipedCount++;
        wipedCells++;
      } else if (beforeValue.trim() === "" && afterValue.trim() !== "") {
        kind = "filled";
        filledCells++;
      } else {
        changedCells++;
      }
      cellDiffs.push({
        rowKey: bEntry.displayKey,
        column: col.column,
        beforeValue,
        afterValue,
        kind,
      });
    }
    if (rowModified) modifiedRows++;
    else unchangedRows++;
  }

  for (const [mapKey, aEntry] of afterIndexed.map.entries()) {
    if (!beforeIndexed.map.has(mapKey)) {
      addedRows++;
      addedEntries.push({
        rowKey: aEntry.displayKey,
        rowNumber: aEntry.rowNumber,
        summary: summarizeRowValues(aEntry.row, afterHeaders, keySet),
      });
    }
  }

  const columnSummary = comparedColumns
    .filter((c) => c.changedCount > 0)
    .map(({ column, changedCount, wipedCount }) => ({
      column,
      changedCount,
      wipedCount,
    }));

  // Optional exact BigInt numeric audit.
  let numericSummary = null;
  if (trimmedNumeric) {
    const bNumIdx = bInfo.firstIndex.get(trimmedNumeric);
    const aNumIdx = aInfo.firstIndex.get(trimmedNumeric);
    let beforeTotal18 = 0n;
    let afterTotal18 = 0n;
    let maxScale = 0;
    let parsedCount = 0;
    let blankCount = 0;
    let unparseableCount = 0;
    let beforeUnparseableCount = 0;
    let afterUnparseableCount = 0;

    for (let i = 1; i < beforeRows.length; i++) {
      const p = parseExactDecimal(beforeRows[i][bNumIdx] ?? "");
      if (p.ok) {
        beforeTotal18 += p.scaled18;
        if (p.scale > maxScale) maxScale = p.scale;
        parsedCount++;
      } else if (p.blank) {
        blankCount++;
      } else {
        unparseableCount++;
        beforeUnparseableCount++;
      }
    }

    for (let i = 1; i < afterRows.length; i++) {
      const p = parseExactDecimal(afterRows[i][aNumIdx] ?? "");
      if (p.ok) {
        afterTotal18 += p.scaled18;
        if (p.scale > maxScale) maxScale = p.scale;
        parsedCount++;
      } else if (p.blank) {
        blankCount++;
      } else {
        unparseableCount++;
        afterUnparseableCount++;
      }
    }

    // Sign-flip detection across matched rows.
    let matchedNonZeroPairs = 0;
    let allNegated = true;
    for (const [mapKey, bEntry] of beforeIndexed.map.entries()) {
      const aEntry = afterIndexed.map.get(mapKey);
      if (!aEntry) continue;
      const bParsed = parseExactDecimal(bEntry.row[bNumIdx] ?? "");
      const aParsed = parseExactDecimal(aEntry.row[aNumIdx] ?? "");
      if (bParsed.ok && aParsed.ok) {
        if (bParsed.scaled18 === 0n && aParsed.scaled18 === 0n) continue;
        if (bParsed.scaled18 !== 0n && aParsed.scaled18 === -bParsed.scaled18) {
          matchedNonZeroPairs++;
        } else {
          allNegated = false;
        }
      } else if (bParsed.blank && aParsed.blank) {
        continue;
      } else {
        allNegated = false;
      }
    }

    numericSummary = {
      column: trimmedNumeric,
      beforeSum: formatExactDecimal(beforeTotal18, maxScale),
      afterSum: formatExactDecimal(afterTotal18, maxScale),
      netDelta: formatExactDecimal(afterTotal18 - beforeTotal18, maxScale),
      parsedCount,
      blankCount,
      unparseableCount,
      beforeUnparseableCount,
      afterUnparseableCount,
      signFlipped: matchedNonZeroPairs >= 2 && allNegated,
    };
  }

  // Order report rows so highest-risk wiped cells appear first, then modified, removed, added.
  const wipedReport = [];
  const modifiedReport = [];
  for (const d of cellDiffs) {
    if (d.kind === "wiped") {
      wipedReport.push(["wiped", d.rowKey, d.column, d.beforeValue, d.afterValue]);
    } else {
      modifiedReport.push([
        "modified",
        d.rowKey,
        d.column,
        d.beforeValue,
        d.afterValue,
      ]);
    }
  }
  const removedReport = removedEntries.map((e) => [
    "removed",
    e.rowKey,
    "",
    e.summary,
    "",
  ]);
  const addedReport = addedEntries.map((e) => [
    "added",
    e.rowKey,
    "",
    "",
    e.summary,
  ]);
  const reportRows = [
    ...wipedReport,
    ...modifiedReport,
    ...removedReport,
    ...addedReport,
  ];

  const hasFormulaLike = reportRows.some((r) =>
    r.some((cell) => isFormulaLikeCell(cell)),
  );

  return {
    ok: true,
    keyColumns: cleanedKeys,
    sharedColumns,
    removedColumns,
    addedColumns,
    unchangedRows,
    modifiedRows,
    addedRows,
    removedRows,
    wipedCells,
    filledCells,
    changedCells,
    totalCellDiffs: cellDiffs.length,
    cellDiffs,
    addedEntries,
    removedEntries,
    columnSummary,
    numericSummary,
    reportRows,
    hasFormulaLike,
    beforeDataRows: beforeRows.length - 1,
    afterDataRows: afterRows.length - 1,
  };
}

export function compareCsvTexts(
  beforeText,
  afterText,
  {
    beforeDelimiter = "",
    afterDelimiter = "",
    keyColumns = [],
    numericColumn = "",
  } = {},
) {
  const before = parseTable(beforeText, { delimiter: beforeDelimiter });
  if (!before.ok) {
    return { ok: false, side: "before", code: before.code, row: before.row };
  }
  const after = parseTable(afterText, { delimiter: afterDelimiter });
  if (!after.ok) {
    return { ok: false, side: "after", code: after.code, row: after.row };
  }
  const comparison = compareTables(before.rows, after.rows, {
    keyColumns,
    numericColumn,
  });
  if (!comparison.ok) return comparison;
  return {
    ...comparison,
    beforeMeta: {
      records: before.rows.length,
      columns: before.headers.length,
      delimiter: before.delimiter,
    },
    afterMeta: {
      records: after.rows.length,
      columns: after.headers.length,
      delimiter: after.delimiter,
    },
  };
}

export function exportDiffCsv(
  diffResult,
  { formula = "escape", bom = true } = {},
) {
  if (!diffResult || !diffResult.ok) throw Error("invalid");
  const rows = [
    ["change_type", "key", "column", "before_value", "after_value"],
    ...(diffResult.reportRows || []),
  ];
  const hasFormula =
    typeof diffResult.hasFormulaLike === "boolean"
      ? diffResult.hasFormulaLike
      : rows.some((r) => r.some((cell) => isFormulaLikeCell(cell)));
  if (hasFormula && !["escape", "preserve"].includes(formula)) {
    throw Error("formula_choice");
  }
  return (
    (bom ? "\uFEFF" : "") +
    Papa.unparse(rows, {
      delimiter: ",",
      newline: "\r\n",
      quotes: true,
      escapeFormulae: formula === "escape" ? formulaPattern : false,
    })
  );
}
