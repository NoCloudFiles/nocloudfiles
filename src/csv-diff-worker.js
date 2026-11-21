import {
  inspectTablePair,
  compareCsvTexts,
  exportDiffCsv,
} from "./csv-diff-core.js";

const PREVIEW_LIMIT = 100;
const CELL_PREVIEW_CHARS = 500;

self.onmessage = ({ data }) => {
  try {
    if (data.action === "inspect") {
      const result = inspectTablePair(data.beforeText, data.afterText, {
        beforeDelimiter: data.beforeDelimiter,
        afterDelimiter: data.afterDelimiter,
      });
      self.postMessage({ action: "inspect", ...result });
      return;
    }

    const result = compareCsvTexts(data.beforeText, data.afterText, {
      beforeDelimiter: data.beforeDelimiter,
      afterDelimiter: data.afterDelimiter,
      keyColumns: data.keyColumns,
      numericColumn: data.numericColumn,
    });

    if (!result.ok) {
      self.postMessage({
        action: "compare",
        ok: false,
        side: result.side,
        code: result.code,
        row: result.row,
        firstRow: result.firstRow,
        column: result.column,
      });
      return;
    }

    let output = null;
    let needsFormulaChoice = false;
    try {
      output = exportDiffCsv(result, { formula: data.formula });
    } catch (err) {
      if (err?.message === "formula_choice") {
        needsFormulaChoice = true;
      } else {
        throw err;
      }
    }

    const preview = result.reportRows
      .slice(0, PREVIEW_LIMIT)
      .map((row) => row.map((cell) => String(cell ?? "").slice(0, CELL_PREVIEW_CHARS)));

    self.postMessage({
      action: "compare",
      ok: true,
      keyColumns: result.keyColumns,
      removedColumns: result.removedColumns,
      addedColumns: result.addedColumns,
      unchangedRows: result.unchangedRows,
      modifiedRows: result.modifiedRows,
      addedRows: result.addedRows,
      removedRows: result.removedRows,
      wipedCells: result.wipedCells,
      filledCells: result.filledCells,
      changedCells: result.changedCells,
      totalCellDiffs: result.totalCellDiffs,
      totalReportRows: result.reportRows.length,
      columnSummary: result.columnSummary,
      numericSummary: result.numericSummary,
      hasFormulaLike: result.hasFormulaLike,
      needsFormulaChoice,
      beforeMeta: result.beforeMeta,
      afterMeta: result.afterMeta,
      preview,
      output,
    });
  } catch {
    self.postMessage({ action: data?.action || "compare", failed: true });
  }
};
