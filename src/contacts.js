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
const SAFE_TYPES = new Set([
  "CELL",
  "WORK",
  "HOME",
  "FAX",
  "MAIN",
  "VOICE",
  "PAGER",
  "IPHONE",
  "OTHER",
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
function decodeBase64(value, charset) {
  const clean = value.replace(/\s+/g, "");
  if (
    clean.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      clean,
    )
  )
    throw Error("encoding");
  let bin;
  try {
    bin = atob(clean);
  } catch {
    throw Error("encoding");
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    return new TextDecoder(charset || "utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Error("encoding");
  }
}
function extractTypes(header) {
  const params = [];
  let part = "",
    inQuotes = false;
  for (const ch of header) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      part += ch;
    } else if (ch === ";" && !inQuotes) {
      params.push(part);
      part = "";
    } else part += ch;
  }
  params.push(part);
  const found = [];
  for (const seg of params.slice(1)) {
    const eq = seg.indexOf("=");
    let tokens;
    if (eq >= 0) {
      if (seg.slice(0, eq).trim().toUpperCase() !== "TYPE") continue;
      tokens = seg
        .slice(eq + 1)
        .replace(/^"|"$/g, "")
        .split(",");
    } else {
      tokens = [seg.replace(/^"|"$/g, "")];
    }
    for (const raw of tokens) {
      const token = raw.trim().toUpperCase();
      if (SAFE_TYPES.has(token) && !found.includes(token)) found.push(token);
    }
  }
  return found;
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
    const { key, charset, qp, base64, types, values, splitOctets } = current;
    current = null;
    if (!readable.has(key)) return;
    let raw;
    if (base64) {
      raw = decodeBase64(values.join(""), charset);
    } else {
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
    }
    if (key === "N") {
      const nParts = parts(raw);
      if (!nParts.some((p) => p.trim())) return;
      card.nameParts = Array.from({ length: 5 }, (_, i) => nParts[i] ?? "");
      card.fallback = nParts.filter(Boolean).join(" ").trim();
      return;
    }
    const value =
      key === "ADR" || key === "ORG"
        ? parts(raw).filter(Boolean).join(" ")
        : unescape(raw);
    if (!value.trim()) return;
    if (key === "FN") card.name = value.trim();
    else
      card.fields.push({
        key,
        ...(types.length ? { types } : {}),
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
        current?.binary &&
        !current.base64 &&
        (data[0] === 32 || data[0] === 9 || !data.subarray(0, 256).includes(58))
      )
        continue;
      const prefix = String.fromCharCode(...data.subarray(0, 256));
      if (card && /^(?:[\w-]+\.)?(PHOTO|LOGO|SOUND|KEY)[;:]/i.test(prefix)) {
        flush();
        current = { key: "PHOTO", binary: true, base64: false };
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
    if (!line) {
      if (current?.base64) flush();
      continue;
    }
    if (current?.binary && !line.includes(":")) {
      if (current.base64) append(line);
      continue;
    }
    flush();
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (card) throw Error("invalid");
      card = { fields: [], name: "", fallback: "", nameParts: null, version: "" };
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
      card.version = value.trim();
      continue;
    }
    const qp = /(?:^|;)ENCODING="?QUOTED-PRINTABLE"?(?:;|$)/i.test(header[1]);
    const base64 = /;(?:ENCODING=)?"?(?:BASE64|B)"?(?:;|$)/i.test(header[1]);
    if (qp && base64 && readable.has(key)) throw Error("encoding");
    const binary = base64 || key === "PHOTO";
    const types =
      key === "TEL" || key === "EMAIL" ? extractTypes(header[1]) : [];
    current = {
      key,
      qp: qp && readable.has(key),
      base64: base64 && readable.has(key),
      binary,
      types,
      charset: /;CHARSET="?([^";]+)/i.exec(header[1])?.[1],
      length: 0,
      values: [],
      splitOctets: [],
    };
    append(value);
  }
  if (card || !cards.length) throw Error("invalid");
  return cards;
}
export function writeCards(selection) {
  const lines = [];
  for (const { name, nameParts, fields } of selection) {
    const n = escapeText(name);
    const structuredN =
      Array.isArray(nameParts) &&
      nameParts.some((p) => String(p ?? "").trim())
        ? Array.from({ length: 5 }, (_, i) =>
            escapeText(String(nameParts[i] ?? "")),
          ).join(";")
        : n + ";;;;";
    lines.push("BEGIN:VCARD", "VERSION:3.0", "FN:" + n, "N:" + structuredN);
    for (const { key, value, components, types } of fields) {
      if (!optional.has(key)) throw Error("field");
      const safeTypes =
        (key === "TEL" || key === "EMAIL") && Array.isArray(types)
          ? [
              ...new Set(
                types
                  .map((t) => String(t).toUpperCase())
                  .filter((t) => SAFE_TYPES.has(t)),
              ),
            ]
          : [];
      const prop = safeTypes.length
        ? key + ";TYPE=" + safeTypes.join(",")
        : key;
      lines.push(
        prop +
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
