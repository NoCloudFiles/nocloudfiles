import test from "node:test";
import assert from "node:assert/strict";
import { inspectCsv, exportCsv, decodeCsv } from "../src/csv-core.js";
test("normalization preserves identifiers, decimals, whitespace and quoted multiline cells", () => {
  const r = inspectCsv(
    'sku;amount;note\r\n00123;1.2300;"a\nb"\r\n00004;2;" x "\r\n',
  );
  assert.equal(r.delimiter, ";");
  assert.equal(r.ok, true);
  assert.deepEqual(inspectCsv(exportCsv(r)).rows, r.rows);
  assert.equal(r.rows[1][0], "00123");
});
test("malformed quotes and ragged rows block export instead of silently dropping data", () => {
  for (const s of ['a,b\n"broken,x', "a,b\n1,2,3"]) {
    const r = inspectCsv(s);
    assert.equal(r.ok, false);
    assert.throws(() => exportCsv(r));
  }
});
test("duplicate and empty headers are visible warnings, no automatic column renaming", () => {
  const r = inspectCsv("a,a,\n1,2,3");
  assert.ok(r.issues.some((x) => x.code === "headers"));
  assert.deepEqual(r.rows[0], ["a", "a", ""]);
});
test("formula-like cells require explicit export choice, preserving or escaping values", () => {
  const r = inspectCsv("id,value\n001,=1+1");
  assert.ok(r.issues.some((x) => x.code === "formula"));
  assert.throws(() => exportCsv(r));
  assert.match(exportCsv(r, { formula: "escape" }), /'=1\+1/);
  assert.equal(
    inspectCsv(exportCsv(r, { formula: "preserve" })).rows[1][1],
    "=1+1",
  );
});
test("ambiguous dates and scientific notation are flagged, never guessed", () => {
  const r = inspectCsv("date,id\n03/04/2026,1.23E+11");
  assert.ok(r.issues.some((x) => x.code === "date"));
  assert.ok(r.issues.some((x) => x.code === "scientific"));
  assert.equal(r.rows[1][1], "1.23E+11");
});
test("strict decoding rejects invalid UTF8 and supports an explicit legacy selection", () => {
  assert.throws(() => decodeCsv(new Uint8Array([0xff])));
  assert.equal(decodeCsv(new Uint8Array([0xe9]), "windows-1252"), "é");
  assert.equal(decodeCsv(new Uint8Array([0xff, 0xfe, 97, 0])), "a");
});
test("limits and blank input do not produce partial success", () => {
  assert.equal(inspectCsv("").ok, false);
  assert.equal(inspectCsv("a\n1\n2", { maxRows: 2 }).ok, false);
  assert.equal(inspectCsv("abcdef", { maxChars: 5 }).ok, false);
});
test("empty rows and empty cells are retained and output handles quotes correctly", () => {
  const r = inspectCsv('a,b\n,\n"a""b",c');
  assert.deepEqual(inspectCsv(exportCsv(r)).rows, r.rows);
  assert.equal(r.rows.length, 3);
});

test("auto detection ignores terminal blank record and never silently falls back", () => {
  for (const separator of [";", "\t", "|", ","]) {
    const r = inspectCsv(`sku${separator}amount\n00123${separator}1.23\n`);
    assert.equal(r.ok, true);
    assert.equal(r.delimiter, separator);
    assert.deepEqual(r.rows, [
      ["sku", "amount"],
      ["00123", "1.23"],
    ]);
  }
  assert.equal(inspectCsv("single\nvalue").ok, false);
  assert.equal(inspectCsv("single\nvalue", { delimiter: "," }).ok, true);
});
