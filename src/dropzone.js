import { tr } from "./i18n.js";
import { formatBytes } from "./core.js";

// Describe the current selection. Exported for unit tests; the name stays in the page only.
export function describeSelection(files) {
  const list = [...(files ?? [])];
  if (!list.length) return tr("未选择文件", "No file selected");
  if (list.length === 1)
    return `${list[0].name} · ${formatBytes(list[0].size)}`;
  const total = list.reduce((sum, f) => sum + (f.size || 0), 0);
  return tr(
    `已选择 ${list.length} 个文件 · ${formatBytes(total)}`,
    `${list.length} files · ${formatBytes(total)}`,
  );
}

export const carriesFiles = (e) =>
  [...(e.dataTransfer?.types ?? [])].includes("Files");

/**
 * Turn a container into a drop target for a visually hidden native file input.
 * Dropped files are handed to the input and a normal `change` event is dispatched,
 * so tools keep exactly one code path (and one analytics path) for new files.
 */
export function setupDropzone({ zone, input, status }) {
  const refresh = () => {
    if (status) status.textContent = describeSelection(input.files);
  };
  let depth = 0;
  zone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    if (!input.disabled) zone.classList.add("dragover");
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = input.disabled ? "none" : "copy";
  });
  zone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove("dragover");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove("dragover");
    if (input.disabled) return;
    const dropped = [...(e.dataTransfer?.files ?? [])];
    if (!dropped.length) return;
    try {
      const transfer = new DataTransfer();
      for (const file of input.multiple ? dropped : dropped.slice(0, 1))
        transfer.items.add(file);
      input.files = transfer.files;
    } catch {
      if (status)
        status.textContent = tr(
          "此浏览器不支持拖入文件，请点击按钮选择。",
          "Dropping files is not supported in this browser. Use the button instead.",
        );
      return;
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  input.addEventListener("change", refresh);
  // A file dropped beside the target would otherwise navigate away and discard unsaved work.
  // Only file drags are blocked: dragging selected text into a text box must keep working.
  for (const type of ["dragover", "drop"])
    window.addEventListener(type, (e) => {
      if (!zone.contains(e.target) && carriesFiles(e)) e.preventDefault();
    });
  refresh();
  return { refresh };
}
