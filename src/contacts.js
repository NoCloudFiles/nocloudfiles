import { escapeText, foldLine } from "./local-formats.js";

const MAX_FILE = 30 * 1024 * 1024,
  MAX_FIELD = 65536;
const readable = new Set([
  "FN",
  "N",
  "TEL",
  "EMAIL",
  "ORG",
  "TITLE",
  "NOTE",
  "ADR",
  "BDAY",
]);
const optional = new Set([
  "TEL",
  "EMAIL",
  "ORG",
  "TITLE",
  "NOTE",
  "ADR",
  "BDAY",
]);
function decode(value, charset, qp) {
  const bytes = [];
  for (let i = 0; i < value.length; i++) {
    if (qp && value[i] === "=") {
      const pair = value.slice(i + 1, i + 3);
      if (!/^[a-f0-9]{2}$/i.test(pair)) throw Error("encoding");
      bytes.push(parseInt(pair, 16));
      i += 2;
    } else bytes.push(value.charCodeAt(i));
  }
  try {
    return new TextDecoder(charset || "utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    throw Error("encoding");
  }
}
function parts(value) {
  const components = [""];
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      components[components.length - 1] += ch.toLowerCase() === "n" ? "\n" : ch;
      escaped = false;
    } else if (ch === "\\") escaped = true;
    else if (ch === ";") components.push("");
    else components[components.length - 1] += ch;
  }
  return components;
}
function unescape(value) {
  return value.replace(/\\([nN,;\\])/g, (_, c) =>
    c.toLowerCase() === "n" ? "\n" : c,
  );
}
export function parseCards(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length || bytes.length > MAX_FILE) throw Error("size");
  const cards = [];
  let card = null,
    current = null;
  function flush() {
    if (!current) return;
    const { key, charset, qp, values, splitOctets } = current;
    current = null;
    if (!readable.has(key)) return;
    let raw;
    try {
      raw = decode(values.join(""), charset, qp);
    } catch (error) {
      if (!splitOctets.length) throw error;
      // Some legacy exporters split after the equals introducing an octet.
      // Recover this variant only when canonical strict decoding failed.
      const repaired = values.slice();
      for (const i of splitOctets) repaired[i] = "=" + repaired[i];
      raw = decode(repaired.join(""), charset, qp);
    }
    const value =
      key === "N" || key === "ADR" || key === "ORG"
        ? parts(raw).filter(Boolean).join(" ")
        : unescape(raw);
    if (!value.trim()) return;
    if (key === "FN") card.name = value.trim();
    else if (key === "N") card.fallback = value.trim();
    else
      card.fields.push({
        key,
        ...(["ADR", "ORG"].includes(key) ? { components: parts(raw) } : {}),
        value: key === "TEL" ? value.replace(/^tel:/i, "") : value,
      });
  }
  function append(line) {
    if (!current || !readable.has(current.key)) return;
    current.length += line.length;
    if (current.length > MAX_FIELD) throw Error("largeField");
    current.values.push(line);
  }
  let start = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0;
  while (start < bytes.length) {
    let end = start;
    while (end < bytes.length && bytes[end] !== 13 && bytes[end] !== 10) end++;
    const data = bytes.subarray(start, end);
    start = end + 1 + (bytes[end] === 13 && bytes[end + 1] === 10 ? 1 : 0);
    if (data.length > MAX_FIELD) {
      if (
        current?.key === "PHOTO" &&
        (data[0] === 32 || data[0] === 9 || !data.subarray(0, 256).includes(58))
      )
        continue;
      const prefix = String.fromCharCode(...data.subarray(0, 256));
      if (card && /^(?:[\w-]+\.)?(PHOTO|LOGO|SOUND|KEY)[;:]/i.test(prefix)) {
        flush();
        current = { key: "PHOTO", binary: true };
        continue;
      }
      throw Error("largeField");
    }
    let line = "";
    for (let i = 0; i < data.length; i += 8192)
      line += String.fromCharCode(...data.subarray(i, i + 8192));
    if (current?.qp && current.values.at(-1)?.endsWith("=")) {
      current.values[current.values.length - 1] = current.values
        .at(-1)
        .slice(0, -1);
      const tail = line.replace(/^[ \t]/, "");
      if (/^[a-f0-9]{2}/i.test(tail))
        current.splitOctets.push(current.values.length);
      append(tail);
      continue;
    }
    if (/^[ \t]/.test(line)) {
      if (!current) throw Error("invalid");
      append(line.slice(1));
      continue;
    }
    if (!line) continue;
    if (current?.binary && !line.includes(":")) continue;
    flush();
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (card) throw Error("invalid");
      card = { fields: [], name: "", fallback: "", version: "" };
      continue;
    }
    if (!card) throw Error("invalid");
    if (/^END:VCARD$/i.test(line)) {
      if (!["2.1", "3.0", "4.0"].includes(card.version)) throw Error("version");
      card.name ||= card.fallback || "Unnamed";
      if (!card.name) throw Error("name");
      cards.push(card);
      if (cards.length > 50000) throw Error("size");
      card = null;
      continue;
    }
    const header = /^((?:[^":]|"[^"]*")*):/.exec(line);
    if (!header) throw Error("invalid");
    const key = header[1].split(";")[0].split(".").at(-1).toUpperCase(),
      value = line.slice(header[0].length);
    if (key === "VERSION") {
      card.version = value;
      continue;
    }
    const qp = /(?:^|;)ENCODING="?QUOTED-PRINTABLE"?(?:;|$)/i.test(header[1]);
    const binary =
      /;(?:ENCODING=)?"?(?:BASE64|B)"?(?:;|$)/i.test(header[1]) ||
      key === "PHOTO";
    current = {
      key,
      qp: qp && readable.has(key),
      binary,
      charset: /;CHARSET="?([^";]+)/i.exec(header[1])?.[1],
      length: 0,
      values: [],
      splitOctets: [],
    };
    if (binary && readable.has(key)) throw Error("encoding");
    append(value);
  }
  if (card || !cards.length) throw Error("invalid");
  return cards;
}
export function writeCards(selection) {
  const lines = [];
  for (const { name, fields } of selection) {
    const n = escapeText(name);
    lines.push("BEGIN:VCARD", "VERSION:3.0", "FN:" + n, "N:" + n + ";;;;");
    for (const { key, value, components } of fields) {
      if (!optional.has(key)) throw Error("field");
      lines.push(
        key +
          ":" +
          (components && ["ORG", "ADR"].includes(key)
            ? components.map(escapeText).join(";")
            : escapeText(value)),
      );
    }
    lines.push("END:VCARD");
  }
  if (!lines.length) throw Error("selection");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
