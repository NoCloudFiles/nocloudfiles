import { inspectCsv, exportCsv } from "./csv-core.js";
self.onmessage = ({ data }) => {
  try {
    const result = inspectCsv(data.text, { delimiter: data.delimiter });
    let output = null;
    if (result.ok) {
      try {
        output = exportCsv(result, { formula: data.formula });
      } catch {
        /* An explicit formula decision is still needed. */
      }
    }
    self.postMessage({
      ok: result.ok,
      issues: result.issues,
      delimiter: result.delimiter,
      records: result.rows.length,
      columns: result.rows[0]?.length || 0,
      preview: result.rows
        .slice(0, 20)
        .map((r) => r.slice(0, 10).map((c) => c.slice(0, 1000))),
      output,
    });
  } catch {
    self.postMessage({ failed: true });
  }
};
