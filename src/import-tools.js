import "./site.js";
import "./import-tools.css";
import { track } from "./analytics-ui.js";
import { tr } from "./i18n.js";
export { tr };
export const get = (id) => document.getElementById(id);
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
    a.addEventListener("click", () => report("download_click", source), {
      once: true,
    });
    container.append(a);
  }
  return { clear, add };
}
