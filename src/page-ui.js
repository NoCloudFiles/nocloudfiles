// Page-level behaviour shared by every page: tool-choice measurement and in-page help links.
import { track } from "./analytics-ui.js";

export function setupPageUi(doc = document) {
  doc.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    // Which task row was chosen; the bounded tool id is the only value sent.
    const row = target.closest("a.task-row[data-tool]");
    if (row) track("tool_select", { target_tool: row.dataset.tool });
    // A link to collapsed help (e.g. "how to export") should show it, not just scroll to it.
    const link = target.closest('a[href^="#"]');
    if (link) {
      const help = doc.getElementById(link.getAttribute("href").slice(1));
      if (help instanceof HTMLDetailsElement) help.open = true;
    }
  });
}
setupPageUi();
