import "./site.js";
import { setupDropzone } from "./dropzone.js";
import { track } from "./analytics-ui.js";
import { tr } from "./i18n.js";
export { tr };
export const get = (id) => document.getElementById(id);
// Shared file entry: drag-and-drop onto #file-drop plus a visible file-name status line.
export const fileDrop = () =>
  setupDropzone({ zone: get("file-drop"), input: get("file"), status: get("file-status") });
export function element(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text ?? "";
  return e;
}
export function report(name, source, code) {
  track(name, { input_source: source, ...(code ? { error_code: code } : {}) });
}
export function downloads(container) {
  let urls = [];
  function clear() {
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    container.replaceChildren();
  }
  function add(text, content, name, type, source) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    urls.push(url);
    const a = element("a", text);
    a.href = url;
    a.download = name;
    // The first export is the primary action; further formats are secondary buttons.
    a.className = container.children.length ? "button" : "button download";
    a.addEventListener("click", () => report("download_click", source), {
      once: true,
    });
    container.append(a);
  }
  return { clear, add };
}
