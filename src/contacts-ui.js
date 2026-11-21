import { get, element, tr, downloads, report, fileDrop } from "./import-tools.js";
const drop = fileDrop();
import { writeCards } from "./contacts.js";
const names = {
  TEL: tr("电话", "Phone"),
  EMAIL: tr("邮箱", "Email"),
  ORG: tr("机构", "Organization"),
  TITLE: tr("职务", "Job title"),
  NOTE: tr("备注", "Note"),
  ADR: tr("地址", "Address"),
  BDAY: tr("生日", "Birthday"),
};
const links = downloads(get("links")),
  chosen = new Map();
let cards = [],
  renderLimit = 100,
  worker,
  revision = 0,
  source = "file";
function clearOutput() {
  links.clear();
  get("raw").textContent = "";
  const note = get("empty-fields-note");
  note.textContent = "";
  note.hidden = true;
  get("result").hidden = true;
}
function updateFieldActions() {
  const hasSelection = chosen.size > 0;
  get("field-actions").hidden = !hasSelection;
  let hasPhone = false,
    hasChecked = false;
  for (const [index, set] of chosen) {
    if (set.size > 0) hasChecked = true;
    if (cards[index].fields.some((f) => f.key === "TEL")) hasPhone = true;
  }
  get("select-phones").disabled = !hasPhone;
  get("clear-fields").disabled = !hasChecked;
}
function tick(text, checked, change) {
  const label = element("label"),
    box = element("input");
  box.type = "checkbox";
  box.checked = checked;
  box.onchange = () => change(box.checked);
  label.append(box, document.createTextNode(text));
  return label;
}
function selected() {
  clearOutput();
  const target = get("fields");
  target.replaceChildren();
  get("build").disabled = !chosen.size;
  updateFieldActions();
  for (const [index, set] of chosen) {
    const card = cards[index],
      group = element("fieldset");
    group.append(element("legend", card.name));
    for (const [i, f] of card.fields.entries()) {
      const label =
        (names[f.key] || f.key) +
        (f.types?.length ? " (" + f.types.join(", ") + ")" : "") +
        " · " +
        f.value;
      group.append(
        tick(label, set.has(i), (on) => {
          on ? set.add(i) : set.delete(i);
          clearOutput();
          updateFieldActions();
        }),
      );
    }
    target.append(group);
  }
}
function people() {
  const term = get("search").value.trim().toLowerCase(),
    target = get("people");
  target.replaceChildren();
  let count = 0;
  cards.forEach((c, i) => {
    if (
      term &&
      !c.name.toLowerCase().includes(term) &&
      !c.fields.some(
        (f) =>
          (f.key === "TEL" || f.key === "EMAIL") &&
          f.value.toLowerCase().includes(term),
      )
    )
      return;
    if (++count > renderLimit) return;
    target.append(
      tick(c.name, chosen.has(i), (on) => {
        on ? chosen.set(i, new Set()) : chosen.delete(i);
        selected();
      }),
    );
  });
  get("more").hidden = count <= renderLimit;
  get("count").textContent = tr("匹配联系人：", "Matching contacts: ") + count;
}
get("more").onclick = () => {
  renderLimit += 100;
  people();
};
get("search").oninput = () => {
  renderLimit = 100;
  people();
};
get("select-phones").onclick = () => {
  for (const [index, set] of chosen)
    cards[index].fields.forEach((f, i) => {
      if (f.key === "TEL") set.add(i);
    });
  selected();
};
get("clear-fields").onclick = () => {
  for (const set of chosen.values()) set.clear();
  selected();
};
async function open(file, kind) {
  const id = ++revision;
  worker?.terminate();
  worker = null;
  cards = [];
  chosen.clear();
  get("search").value = "";
  get("choose").hidden = true;
  get("field-actions").hidden = true;
  get("fields").replaceChildren();
  get("people").replaceChildren();
  delete get("status").dataset.state;
  clearOutput();
  source = kind;
  if (!file) {
    get("status").textContent = "";
    return;
  }
  function fail() {
    if (id !== revision) return;
    worker?.terminate();
    worker = null;
    get("file").value = "";
    drop.refresh();
    get("status").textContent = tr(
      "无法完整读取。请使用 30 MiB 以内的 vCard 2.1、3.0 或 4.0 文件，检查编码和卡片边界。",
      "Could not read the complete backup. Check its encoding and card boundaries; use vCard 2.1, 3.0 or 4.0 up to 30 MiB.",
    );
    get("status").dataset.state = "error";
    report("generate_error", source, "input_rejected");
  }
  if (!file.size || file.size > 30 * 1024 * 1024) {
    fail();
    return;
  }
  report("tool_start", source);
  get("status").textContent = tr("正在本地读取…", "Reading locally…");
  try {
    const bytes = await file.arrayBuffer();
    if (id !== revision) return;
    worker = new Worker(new URL("./contacts-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onerror = fail;
    worker.onmessage = ({ data }) => {
      if (id !== revision) return;
      if (data.error) {
        fail();
        return;
      }
      worker.terminate();
      worker = null;
      cards = data.cards;
      renderLimit = 100;
      get("choose").hidden = false;
      delete get("status").dataset.state;
      get("status").textContent =
        tr("已读取联系人：", "Contacts read: ") + cards.length;
      people();
      selected();
    };
    worker.postMessage(bytes, [bytes]);
  } catch {
    fail();
  }
}
get("file").onchange = (e) => open(e.target.files[0], "file");
get("sample").onclick = () => {
  get("file").value = "";
  drop.refresh();
  open(
    new Blob([
      "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alex Lin\r\nTEL:+1-202-555-0100\r\nNOTE:Personal note\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nFN:林小明\r\nEMAIL:example@example.org\r\nEND:VCARD\r\n",
    ]),
    "sample",
  );
};
get("build").onclick = () => {
  clearOutput();
  try {
    const selection = Array.from(chosen, ([index, fields]) => ({
      name: cards[index].name,
      nameParts: cards[index].nameParts,
      fields: cards[index].fields.filter((_, i) => fields.has(i)),
    }));
    const vcf = writeCards(selection);
    if (selection.some((c) => c.fields.length === 0)) {
      const note = get("empty-fields-note");
      note.textContent = tr(
        "注意：部分已选联系人未勾选任何附加字段，导出文件中仅包含其姓名。",
        "Note: Some selected contacts have no details ticked — only their names were included.",
      );
      note.hidden = false;
    }
    get("raw").textContent = vcf;
    get("result").hidden = false;
    links.add(
      tr("下载所选联系人", "Download selected contacts"),
      vcf,
      "selected-contacts.vcf",
      "text/vcard;charset=utf-8",
      source,
    );
    report("contacts_ready", source);
  } catch {
    get("status").textContent = tr(
      "所选字段无法写入，请检查选择。",
      "Could not export the selected fields.",
    );
    get("status").dataset.state = "error";
    report("generate_error", source, "generation_failed");
  }
};
window.addEventListener("beforeunload", (e) => {
  if (cards.length > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
});
