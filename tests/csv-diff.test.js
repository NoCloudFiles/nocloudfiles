import test from "node:test";
import assert from "node:assert/strict";
import { inspectCsv } from "../src/csv-core.js";
import {
  parseExactDecimal,
  formatExactDecimal,
  inspectTablePair,
  compareTables,
  compareCsvTexts,
  exportDiffCsv,
  isFormulaLikeCell,
} from "../src/csv-diff-core.js";

test("single-key matching detects modified, wiped, filled, added, removed and unchanged rows", () => {
  const before = [
    ["sku", "title", "price", "image_url", "note"],
    ["SKU-1", "Tote", "24.50", "https://ex.com/1.jpg", ""],
    ["SKU-2", "Scarf", "39.90", "https://ex.com/2.jpg", "warm"],
    ["SKU-3", "Cap", "18.00", "https://ex.com/3.jpg", "cotton"],
  ];
  const after = [
    ["sku", "title", "price", "image_url", "note"],
    ["SKU-1", "Tote", "26.00", "", "sale"],
    ["SKU-2", "Scarf", "39.90", "https://ex.com/2.jpg", "warm"],
    ["SKU-4", "Hat", "22.00", "https://ex.com/4.jpg", "new"],
  ];

  const r = compareTables(before, after, { keyColumns: ["sku"] });
  assert.equal(r.ok, true);
  assert.equal(r.unchangedRows, 1);
  assert.equal(r.modifiedRows, 1);
  assert.equal(r.addedRows, 1);
  assert.equal(r.removedRows, 1);
  assert.equal(r.wipedCells, 1);
  assert.equal(r.filledCells, 1);
  assert.equal(r.changedCells, 1);

  const wiped = r.cellDiffs.find((d) => d.kind === "wiped");
  assert.deepEqual(wiped, {
    rowKey: "SKU-1",
    column: "image_url",
    beforeValue: "https://ex.com/1.jpg",
    afterValue: "",
    kind: "wiped",
  });

  const filled = r.cellDiffs.find((d) => d.kind === "filled");
  assert.equal(filled.column, "note");
  assert.equal(filled.afterValue, "sale");

  assert.deepEqual(r.columnSummary, [
    { column: "price", changedCount: 1, wipedCount: 0 },
    { column: "image_url", changedCount: 1, wipedCount: 1 },
    { column: "note", changedCount: 1, wipedCount: 0 },
  ]);
  // Wiped cells are placed first in reportRows.
  assert.equal(r.reportRows[0][0], "wiped");
  assert.equal(r.reportRows[0][2], "image_url");
});

test("composite-key matching pairs Handle + Option1 Value without separator collisions", () => {
  const before = [
    ["Handle", "Option1 Value", "Price"],
    ["tee", "S", "15.00"],
    ["tee", "M", "15.00"],
    ["a / b", "c", "10.00"],
    ["a", "b / c", "20.00"],
  ];
  const after = [
    ["Handle", "Option1 Value", "Price"],
    ["tee", "M", "16.50"],
    ["tee", "S", "15.00"],
    ["a / b", "c", "10.00"],
    ["a", "b / c", "21.00"],
  ];

  const r = compareTables(before, after, {
    keyColumns: ["Handle", "Option1 Value"],
  });
  assert.equal(r.ok, true);
  assert.equal(r.unchangedRows, 2);
  assert.equal(r.modifiedRows, 2);
  assert.equal(r.addedRows, 0);
  assert.equal(r.removedRows, 0);
  assert.equal(r.cellDiffs[0].rowKey, "tee / M");
  assert.equal(r.cellDiffs[0].afterValue, "16.50");
  assert.equal(r.cellDiffs[1].rowKey, "a / b / c");
  assert.equal(r.cellDiffs[1].afterValue, "21.00");
});

test("dropped and added columns are reported separately from shared columns", () => {
  const before = [
    ["sku", "price", "old_col", "image_url"],
    ["A1", "10.00", "legacy", "https://ex.com/a.jpg"],
  ];
  const after = [
    ["sku", "image_url", "price", "new_col"],
    ["A1", "https://ex.com/a.jpg", "10.00", "fresh"],
  ];

  const r = compareTables(before, after, { keyColumns: ["sku"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.removedColumns, ["old_col"]);
  assert.deepEqual(r.addedColumns, ["new_col"]);
  assert.equal(r.unchangedRows, 1);
  assert.equal(r.modifiedRows, 0);
});

test("duplicate keys and blank keys are rejected with exact 1-based record numbers", () => {
  const dupBefore = [
    ["sku", "price"],
    ["A1", "10"],
    ["A2", "20"],
    ["A1", "30"],
  ];
  const okAfter = [
    ["sku", "price"],
    ["A1", "10"],
    ["A2", "20"],
  ];
  const r1 = compareTables(dupBefore, okAfter, { keyColumns: ["sku"] });
  assert.deepEqual(r1, {
    ok: false,
    side: "before",
    code: "duplicate_key",
    row: 4,
    firstRow: 2,
  });

  const dupAfter = [
    ["sku", "price"],
    ["A1", "10"],
    ["A2", "20"],
    ["A2", "25"],
  ];
  const r2 = compareTables(okAfter, dupAfter, { keyColumns: ["sku"] });
  assert.deepEqual(r2, {
    ok: false,
    side: "after",
    code: "duplicate_key",
    row: 4,
    firstRow: 3,
  });

  const blankBefore = [
    ["sku", "price"],
    ["A1", "10"],
    ["   ", "20"],
  ];
  const r3 = compareTables(blankBefore, okAfter, { keyColumns: ["sku"] });
  assert.deepEqual(r3, {
    ok: false,
    side: "before",
    code: "blank_key",
    row: 3,
  });

  // Composite key with one blank part and one non-blank part is allowed; all-blank is rejected.
  const compOk = [
    ["Handle", "Option1 Value", "Price"],
    ["single-item", "", "12.00"],
  ];
  const compBlank = [
    ["Handle", "Option1 Value", "Price"],
    ["  ", "   ", "12.00"],
  ];
  assert.equal(
    compareTables(compOk, compOk, { keyColumns: ["Handle", "Option1 Value"] })
      .ok,
    true,
  );
  assert.deepEqual(
    compareTables(compOk, compBlank, {
      keyColumns: ["Handle", "Option1 Value"],
    }),
    { ok: false, side: "after", code: "blank_key", row: 2 },
  );
});

test("duplicate headers for key or shared compared columns are rejected", () => {
  const dupKeyHeader = [
    ["sku", "sku", "price"],
    ["A1", "A1", "10"],
  ];
  const clean = [
    ["sku", "price"],
    ["A1", "10"],
  ];
  const r1 = compareTables(dupKeyHeader, clean, { keyColumns: ["sku"] });
  assert.equal(r1.ok, false);
  assert.equal(r1.side, "before");
  assert.equal(r1.code, "duplicate_headers");

  const dupSharedHeader = [
    ["sku", "price", "price"],
    ["A1", "10", "11"],
  ];
  const r2 = compareTables(clean, dupSharedHeader, { keyColumns: ["sku"] });
  assert.equal(r2.ok, false);
  assert.equal(r2.side, "after");
  assert.equal(r2.code, "duplicate_headers");
});

test("exact BigInt decimal parsing and summation avoids float rounding error", () => {
  assert.equal(parseExactDecimal("0.1").ok, true);
  assert.equal(parseExactDecimal("  -12345.678901234567890123  ").ok, true);
  assert.equal(parseExactDecimal("").blank, true);
  assert.equal(parseExactDecimal("$12.50").ok, false);
  assert.equal(parseExactDecimal("1,234.56").ok, false);
  assert.equal(parseExactDecimal("1.2e3").ok, false);
  assert.equal(parseExactDecimal("N/A").ok, false);
  assert.equal(parseExactDecimal("0.1234567890123456789").ok, false);

  const p1 = parseExactDecimal("0.1");
  const p2 = parseExactDecimal("0.2");
  assert.equal(formatExactDecimal(p1.scaled18 + p2.scaled18, 1), "0.3");

  const before = [
    ["id", "amount"],
    ["1", "0.1"],
    ["2", "0.2"],
    ["3", "-1000000000000.05"],
  ];
  const after = [
    ["id", "amount"],
    ["1", "0.1"],
    ["2", "0.2"],
    ["3", "-1000000000000.00"],
    ["4", "0.05"],
  ];
  const r = compareTables(before, after, {
    keyColumns: ["id"],
    numericColumn: "amount",
  });
  assert.equal(r.ok, true);
  assert.equal(r.numericSummary.beforeSum, "-999999999999.75");
  assert.equal(r.numericSummary.afterSum, "-999999999999.65");
  assert.equal(r.numericSummary.netDelta, "0.10");
  assert.equal(r.numericSummary.unparseableCount, 0);
  assert.equal(r.numericSummary.signFlipped, false);
});

test("sign-flip detection catches bank statement sign inversion without false positives", () => {
  const before = [
    ["tx_id", "amount"],
    ["T1", "12.50"],
    ["T2", "-4.25"],
    ["T3", "0.00"],
  ];
  const flipped = [
    ["tx_id", "amount"],
    ["T1", "-12.50"],
    ["T2", "4.25"],
    ["T3", "0.00"],
  ];
  const rFlipped = compareTables(before, flipped, {
    keyColumns: ["tx_id"],
    numericColumn: "amount",
  });
  assert.equal(rFlipped.ok, true);
  assert.equal(rFlipped.numericSummary.signFlipped, true);
  assert.equal(rFlipped.numericSummary.beforeSum, "8.25");
  assert.equal(rFlipped.numericSummary.afterSum, "-8.25");
  assert.equal(rFlipped.numericSummary.netDelta, "-16.50");

  // Single non-zero row negated must NOT trigger full-column sign flip.
  const singleBefore = [
    ["tx_id", "amount"],
    ["T1", "12.50"],
  ];
  const singleAfter = [
    ["tx_id", "amount"],
    ["T1", "-12.50"],
  ];
  const rSingle = compareTables(singleBefore, singleAfter, {
    keyColumns: ["tx_id"],
    numericColumn: "amount",
  });
  assert.equal(rSingle.numericSummary.signFlipped, false);

  // Mixed rows where one flips and one stays same must NOT trigger sign flip.
  const partialAfter = [
    ["tx_id", "amount"],
    ["T1", "-12.50"],
    ["T2", "-4.25"],
    ["T3", "0.00"],
  ];
  const rPartial = compareTables(before, partialAfter, {
    keyColumns: ["tx_id"],
    numericColumn: "amount",
  });
  assert.equal(rPartial.numericSummary.signFlipped, false);
});

test("unparseable numeric cells are counted and never silently coerced to 0", () => {
  const before = [
    ["id", "amount"],
    ["1", "10.00"],
    ["2", "$20.00"],
    ["3", ""],
    ["4", "1,000.00"],
  ];
  const after = [
    ["id", "amount"],
    ["1", "15.00"],
    ["2", "TBD"],
    ["3", "1e4"],
    ["4", ""],
  ];
  const r = compareTables(before, after, {
    keyColumns: ["id"],
    numericColumn: "amount",
  });
  assert.equal(r.ok, true);
  assert.equal(r.numericSummary.beforeSum, "10.00");
  assert.equal(r.numericSummary.afterSum, "15.00");
  assert.equal(r.numericSummary.netDelta, "5.00");
  assert.equal(r.numericSummary.parsedCount, 2);
  assert.equal(r.numericSummary.blankCount, 2);
  assert.equal(r.numericSummary.unparseableCount, 4);
});

test("header-only table (0 data rows) works for all-added or all-removed comparisons", () => {
  const emptyAfter = compareCsvTexts(
    "sku,price\nA1,10.00\nA2,20.00",
    "sku,price\n",
    { keyColumns: ["sku"], numericColumn: "price" },
  );
  assert.equal(emptyAfter.ok, true);
  assert.equal(emptyAfter.removedRows, 2);
  assert.equal(emptyAfter.addedRows, 0);
  assert.equal(emptyAfter.numericSummary.beforeSum, "30.00");
  assert.equal(emptyAfter.numericSummary.afterSum, "0.00");
  assert.equal(emptyAfter.numericSummary.netDelta, "-30.00");
});

test("compareCsvTexts supports different delimiters per side and flags structural errors with side", () => {
  const r = compareCsvTexts(
    "sku;price\nA1;10.00\n",
    "sku,price\nA1,12.50\n",
    { keyColumns: ["sku"], numericColumn: "price" },
  );
  assert.equal(r.ok, true);
  assert.equal(r.beforeMeta.delimiter, ";");
  assert.equal(r.afterMeta.delimiter, ",");
  assert.equal(r.numericSummary.netDelta, "2.50");

  const brokenQuotes = compareCsvTexts(
    'sku,price\nA1,5\n"unterminated,10',
    "sku,price\nA1,10",
    { beforeDelimiter: ",", keyColumns: ["sku"] },
  );
  assert.equal(brokenQuotes.ok, false);
  assert.equal(brokenQuotes.side, "before");
  assert.equal(brokenQuotes.code, "quotes");

  const autoBrokenQuotes = compareCsvTexts(
    'sku,price\n"a"b,10\nA2,20',
    "sku,price\nA2,20",
    { keyColumns: ["sku"] },
  );
  assert.equal(autoBrokenQuotes.ok, false);
  assert.equal(autoBrokenQuotes.side, "before");
  assert.ok(["quotes", "delimiter"].includes(autoBrokenQuotes.code));

  const raggedCols = compareCsvTexts(
    "sku,price\nA1,10",
    "sku,price\nA1,10,extra",
    { keyColumns: ["sku"] },
  );
  assert.equal(raggedCols.ok, false);
  assert.equal(raggedCols.side, "after");
  assert.equal(raggedCols.code, "columns");
  assert.equal(raggedCols.row, 2);

  const pair = inspectTablePair("sku;price;old\nA1;1;x", "sku,price,new\nA1,2,y");
  assert.equal(pair.ok, true);
  assert.deepEqual(pair.sharedHeaders, ["sku", "price"]);
  assert.deepEqual(pair.beforeOnlyHeaders, ["old"]);
  assert.deepEqual(pair.afterOnlyHeaders, ["new"]);
});

test("exportDiffCsv round-trips with BOM, CRLF, quoted cells, and safe formula handling", () => {
  assert.equal(isFormulaLikeCell("-1.5e-3"), false);
  assert.equal(isFormulaLikeCell("-.5"), false);
  assert.equal(isFormulaLikeCell("-12.50"), false);
  assert.equal(isFormulaLikeCell("=SUM(A1)"), true);
  assert.equal(isFormulaLikeCell("-1+1"), true);

  const before = [
    ["sku", "price", "sci", "lead_dot", "formula_col", "formula_minus", "image"],
    ["SKU-1", "12.50", "1.0", "0.5", "ok", "ok", "https://ex.com/a.jpg"],
    ["SKU-2", "5.00", "2.0", "0.5", "plain", "ok", "https://ex.com/b.jpg"],
  ];
  const after = [
    ["sku", "price", "sci", "lead_dot", "formula_col", "formula_minus", "image"],
    ["SKU-1", "-12.50", "-1.5e-3", "-.5", "=SUM(A1:A2)", "-1+1", ""],
    ["SKU-3", "7.00", "3.0", "0.2", "@CMD", "+1+1", "https://ex.com/c.jpg"],
  ];

  const diff = compareTables(before, after, { keyColumns: ["sku"] });
  assert.equal(diff.ok, true);
  assert.equal(diff.hasFormulaLike, true);

  // 'ask' throws when formula-like cells exist.
  assert.throws(() => exportDiffCsv(diff, { formula: "ask" }), /formula_choice/);

  // 'escape' escapes '=SUM(A1:A2)' and '-1+1' while keeping '-12.50', '-1.5e-3', and '-.5' uncorrupted.
  const escapedCsv = exportDiffCsv(diff, { formula: "escape" });
  assert.equal(escapedCsv.startsWith("\uFEFF"), true);
  assert.equal(escapedCsv.includes("\r\n"), true);
  const parsedEscaped = inspectCsv(escapedCsv, { delimiter: "," });
  assert.equal(parsedEscaped.ok, true);
  assert.deepEqual(parsedEscaped.rows[0], [
    "change_type",
    "key",
    "column",
    "before_value",
    "after_value",
  ]);
  const priceRow = parsedEscaped.rows.find((r) => r[2] === "price");
  assert.equal(priceRow[4], "-12.50");
  const sciRow = parsedEscaped.rows.find((r) => r[2] === "sci");
  assert.equal(sciRow[4], "-1.5e-3");
  const leadDotRow = parsedEscaped.rows.find((r) => r[2] === "lead_dot");
  assert.equal(leadDotRow[4], "-.5");
  const formulaRow = parsedEscaped.rows.find((r) => r[2] === "formula_col");
  assert.equal(formulaRow[4], "'=SUM(A1:A2)");
  const formulaMinusRow = parsedEscaped.rows.find(
    (r) => r[2] === "formula_minus",
  );
  assert.equal(formulaMinusRow[4], "'-1+1");

  // Table with only '-1.5e-3' and '-.5' must NOT trigger formula_choice under 'ask'.
  const negOnlyDiff = compareTables(
    [
      ["sku", "sci", "lead_dot"],
      ["SKU-1", "1.0", "0.5"],
    ],
    [
      ["sku", "sci", "lead_dot"],
      ["SKU-1", "-1.5e-3", "-.5"],
    ],
    { keyColumns: ["sku"] },
  );
  assert.equal(negOnlyDiff.hasFormulaLike, false);
  assert.doesNotThrow(() => exportDiffCsv(negOnlyDiff, { formula: "ask" }));

  // 'preserve' keeps exact value without apostrophe.
  const preservedCsv = exportDiffCsv(diff, { formula: "preserve" });
  const parsedPreserved = inspectCsv(preservedCsv, { delimiter: "," });
  assert.equal(parsedPreserved.ok, true);
  const preservedFormulaRow = parsedPreserved.rows.find(
    (r) => r[2] === "formula_col",
  );
  assert.equal(preservedFormulaRow[4], "=SUM(A1:A2)");
  const preservedMinusRow = parsedPreserved.rows.find(
    (r) => r[2] === "formula_minus",
  );
  assert.equal(preservedMinusRow[4], "-1+1");
});
