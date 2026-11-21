import Papa from "papaparse";
export const formulaPattern =
  /^(?:[\s]*[=+@]|[\s]*-(?!(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$)|[\t\r])/i;
function hasUnquotedDelimiter(text, maxLines = 20) {
  let inQuotes = false,
    lines = 0,
    hasContent = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      hasContent = true;
    } else if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (hasContent && ++lines >= maxLines) return false;
      hasContent = false;
    } else if (
      !inQuotes &&
      (ch === "," || ch === ";" || ch === "\t" || ch === "|")
    ) {
      return true;
    } else if (ch !== " " && ch !== "\t") {
      hasContent = true;
    }
  }
  return false;
}
export function decodeCsv(bytes, encoding = "auto") {
  if (encoding === "auto")
    encoding =
      bytes[0] === 255 && bytes[1] === 254
        ? "utf-16le"
        : bytes[0] === 254 && bytes[1] === 255
          ? "utf-16be"
          : "utf-8";
  if (
    ![
      "utf-8",
      "utf-16le",
      "utf-16be",
      "windows-1252",
      "gb18030",
      "big5",
    ].includes(encoding)
  )
    throw Error("encoding");
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}
export function inspectCsv(
  text,
  { delimiter = "", maxRows = 20000, maxChars = 2000000 } = {},
) {
  const issues = [];
  const fail = (code) => ({
    ok: false,
    rows: [],
    issues: [{ code, severity: "error" }],
    delimiter,
  });
  if (!text.trim()) return fail("empty");
  if (text.length > maxChars) return fail("limit");
  if (text.includes("\0")) return fail("binary");
  if (!["", ",", ";", "\t", "|"].includes(delimiter)) return fail("delimiter");
  const clean = text.replace(/^\uFEFF/, "");
  if (!delimiter) {
    const guessed = Papa.parse(clean, {
      delimitersToGuess: [",", ";", "\t", "|"],
      skipEmptyLines: true,
      preview: 20,
    });
    if (guessed.errors.some((e) => e.code === "UndetectableDelimiter")) {
      if (hasUnquotedDelimiter(clean)) return fail("delimiter");
      delimiter = ",";
    } else {
      delimiter = guessed.meta.delimiter;
    }
  }
  const parsed = Papa.parse(clean, {
    delimiter,
    delimitersToGuess: [",", ";", "\t", "|"],
    dynamicTyping: false,
    skipEmptyLines: false,
    preview: maxRows + 1,
  });
  const rows = parsed.data;
  // A terminal line ending is not a new record. Interior empty rows are preserved.
  if (
    /[\r\n]$/.test(text) &&
    rows.at(-1)?.length === 1 &&
    rows.at(-1)[0] === ""
  )
    rows.pop();
  if (
    parsed.meta.truncated ||
    rows.length > maxRows ||
    rows.some((r) => r.length > 200)
  )
    return fail("limit");
  for (const e of parsed.errors)
    if (e.code !== "UndetectableDelimiter")
      issues.push({ code: "quotes", severity: "error", row: (e.row ?? 0) + 1 });
  if (parsed.errors.some((e) => e.code === "UndetectableDelimiter"))
    issues.push({ code: "delimiter", severity: "warning" });
  const width = rows[0]?.length || 0;
  for (let i = 1; i < rows.length; i++)
    if (rows[i].length !== width)
      issues.push({ code: "columns", severity: "error", row: i + 1 });
  if (rows[0]?.some((c) => !c.trim()) || new Set(rows[0]).size !== width)
    issues.push({ code: "headers", severity: "warning" });
  const found = new Set();
  for (const row of rows)
    for (const cell of row) {
      if (formulaPattern.test(cell)) found.add("formula");
      if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(cell.trim()))
        found.add("date");
      if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(cell.trim()))
        found.add("scientific");
    }
  for (const code of found) issues.push({ code, severity: "warning" });
  return {
    ok: !issues.some((i) => i.severity === "error"),
    rows,
    issues,
    delimiter: parsed.meta.delimiter,
  };
}
export function exportCsv(result, { formula = "ask", bom = true } = {}) {
  if (!result.ok || !result.rows.length) throw Error("invalid");
  if (
    result.issues.some((i) => i.code === "formula") &&
    !["escape", "preserve"].includes(formula)
  )
    throw Error("formula_choice");
  return (
    (bom ? "\uFEFF" : "") +
    Papa.unparse(result.rows, {
      delimiter: ",",
      newline: "\r\n",
      quotes: true,
      escapeFormulae: formula === "escape" ? formulaPattern : false,
    })
  );
}
