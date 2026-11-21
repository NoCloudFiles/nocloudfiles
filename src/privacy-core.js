// Minimal clean JFIF 1.01 APP0 segment (18 bytes): density 1x1, units 0, no thumbnail.
const CLEAN_JFIF_APP0 = Uint8Array.of(
  255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
);

export const MAX_CANVAS_PIXELS = 16_777_216;

// Proportionally clamp canvas dimensions to fit browser pixel ceilings (e.g. iOS WebKit 16.77 MP).
export function canvasDimensions(width, height, maxPixels = MAX_CANVAS_PIXELS) {
  const origW = Math.max(1, Math.floor(width));
  const origH = Math.max(1, Math.floor(height));
  if (origW * origH <= maxPixels) {
    return { width: origW, height: origH, scaled: false };
  }
  const scale = Math.sqrt(maxPixels / (origW * origH));
  let w = Math.max(1, Math.floor(origW * scale));
  let h = Math.max(1, Math.floor(origH * scale));
  if (w * h > maxPixels) {
    if (w >= h) w = Math.max(1, Math.floor(maxPixels / h));
    else h = Math.max(1, Math.floor(maxPixels / w));
  }
  return { width: w, height: h, scaled: true };
}

// Only a baseline, single-scan JPEG can take the lossless path. Copy codec
// segments and the entropy stream, never source application data or a trailer.
export function baselinePixels(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216) return null;
  const parts = [bytes.subarray(0, 2)];
  let pos = 2,
    baseline = false,
    hasJfif = false;
  while (pos + 1 < bytes.length && bytes[pos] === 255) {
    while (pos + 1 < bytes.length && bytes[pos + 1] === 255) pos++;
    if (pos + 4 > bytes.length) return null;
    const marker = bytes[pos + 1];
    const length = bytes[pos + 2] * 256 + bytes[pos + 3];
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 192) {
      // Require standard 3-component YCbCr (IDs 1, 2, 3) so raw-RGB ('R','G','B')
      // or non-3-component scans fall back to canvas sRGB encoding.
      if (
        length < 17 ||
        bytes[pos + 9] !== 3 ||
        bytes[pos + 10] !== 1 ||
        bytes[pos + 13] !== 2 ||
        bytes[pos + 16] !== 3
      )
        return null;
      baseline = true;
    }
    if (
      marker === 224 &&
      length >= 7 &&
      bytes[pos + 4] === 74 &&
      bytes[pos + 5] === 70 &&
      bytes[pos + 6] === 73 &&
      bytes[pos + 7] === 70 &&
      bytes[pos + 8] === 0
    ) {
      hasJfif = true;
    }
    if ([192, 196, 219, 221, 218].includes(marker))
      parts.push(bytes.subarray(pos, end));
    else if (!((marker >= 224 && marker <= 239) || marker === 254)) return null;
    if (marker === 218) {
      if (!baseline) return null;
      for (let i = end; i + 1 < bytes.length; i++) {
        if (bytes[i] !== 255) continue;
        const next = bytes[i + 1];
        if (next === 255) continue;
        if (!next || (next >= 208 && next <= 215)) {
          i++;
          continue;
        }
        if (next !== 217) return null;
        parts.push(bytes.subarray(end, i + 2));
        if (hasJfif) parts.splice(1, 0, CLEAN_JFIF_APP0);
        return new Blob(parts, { type: "image/jpeg" });
      }
      return null;
    }
    pos = end;
  }
  return null;
}

// Parse XMP GPS coordinates (DMS "37,46,29.64S", DM "37,46.4940000N", or
// signed/suffixed decimal "122.4194W", "-122.4194") to clean decimal degrees.
export function parseXmpCoordinate(raw) {
  const text =
    typeof raw === "number"
      ? String(raw)
      : typeof raw === "string"
        ? raw
        : typeof raw?.value === "string" || typeof raw?.value === "number"
          ? String(raw.value)
          : typeof raw?.description === "string" ||
              typeof raw?.description === "number"
            ? String(raw.description)
            : "";
  const s = text.trim();
  if (!s) return undefined;
  let signStr = "",
    dir = "",
    abs = Number.NaN;
  const dms = s.match(
    /^([+-]?)(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?|\.\d+)\s*([NSEW])?$/i,
  );
  const dm =
    !dms &&
    s.match(
      /^([+-]?)(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?|\.\d+)\s*([NSEW])?$/i,
    );
  const dec =
    !dms &&
    !dm &&
    s.match(/^([+-]?)(\d+(?:\.\d+)?|\.\d+)\s*([NSEW])?$/i);
  if (dms) {
    signStr = dms[1];
    dir = (dms[5] || "").toUpperCase();
    const deg = Number(dms[2]),
      min = Number(dms[3]),
      sec = Number(dms[4]);
    if (min >= 60 || sec >= 60) return undefined;
    abs = deg + min / 60 + sec / 3600;
  } else if (dm) {
    signStr = dm[1];
    dir = (dm[4] || "").toUpperCase();
    const deg = Number(dm[2]),
      min = Number(dm[3]);
    if (min >= 60) return undefined;
    abs = deg + min / 60;
  } else if (dec) {
    signStr = dec[1];
    dir = (dec[3] || "").toUpperCase();
    abs = Number(dec[2]);
  } else {
    return undefined;
  }
  if (signStr && dir) return undefined;
  const limit = dir === "N" || dir === "S" ? 90 : 180;
  if (!Number.isFinite(abs) || abs < 0 || abs > limit) return undefined;
  const sign = dir === "S" || dir === "W" || signStr === "-" ? -1 : 1;
  const rounded = Number((sign * abs).toFixed(7));
  return Object.is(rounded, -0) ? 0 : rounded;
}

const hasLoneSurrogate = (value) =>
  typeof value.isWellFormed === "function"
    ? !value.isWellFormed()
    : /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
        value,
      );

export const properties = {
  author: ["dc:creator", "http://purl.org/dc/elements/1.1/"],
  city: ["photoshop:City", "http://ns.adobe.com/photoshop/1.0/"],
  date: ["xmp:CreateDate", "http://ns.adobe.com/xap/1.0/"],
  description: ["dc:description", "http://purl.org/dc/elements/1.1/"],
  rights: ["dc:rights", "http://purl.org/dc/elements/1.1/"],
  model: ["tiff:Model", "http://ns.adobe.com/tiff/1.0/"],
  latitude: ["exif:GPSLatitude", "http://ns.adobe.com/exif/1.0/"],
  longitude: ["exif:GPSLongitude", "http://ns.adobe.com/exif/1.0/"],
};
const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export function addSelectedFields(jpeg, fields) {
  const hasLat =
    fields.latitude !== undefined &&
    fields.latitude !== null &&
    String(fields.latitude).trim() !== "";
  const hasLon =
    fields.longitude !== undefined &&
    fields.longitude !== null &&
    String(fields.longitude).trim() !== "";
  if (hasLat !== hasLon) throw Error("paired_gps");
  const nodes = [];
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === undefined || raw === null) continue;
    if (!properties[key]) throw Error("value");
    const [tag, ns] = properties[key];
    let value = String(raw).trim();
    if (!value) continue;
    if (
      value.length > 1024 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) ||
      hasLoneSurrogate(value)
    )
      throw Error("value");
    if (key === "latitude" || key === "longitude") {
      const n = Number(value),
        lat = key === "latitude";
      if (!Number.isFinite(n) || Math.abs(n) > (lat ? 90 : 180))
        throw Error("coordinate");
      const abs = Math.abs(n),
        deg = Math.floor(abs);
      value =
        deg +
        "," +
        ((abs - deg) * 60).toFixed(7) +
        (lat ? (n < 0 ? "S" : "N") : n < 0 ? "W" : "E");
    }
    value = escapeXml(value);
    if (key === "author")
      value = "<rdf:Seq><rdf:li>" + value + "</rdf:li></rdf:Seq>";
    if (key === "description" || key === "rights")
      value =
        '<rdf:Alt><rdf:li xml:lang="x-default">' +
        value +
        "</rdf:li></rdf:Alt>";
    nodes.push(
      "<" +
        tag +
        " xmlns:" +
        tag.split(":")[0] +
        '="' +
        ns +
        '">' +
        value +
        "</" +
        tag +
        ">",
    );
  }
  if (!nodes.length) return jpeg;
  const xml =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="">' +
    nodes.join("") +
    "</rdf:Description></rdf:RDF></x:xmpmeta>";
  const packet = new TextEncoder().encode(
    "http://ns.adobe.com/xap/1.0/\0" + xml,
  );
  const size = packet.length + 2;
  if (size > 65535) throw Error("size");
  return new Blob(
    [
      jpeg.slice(0, 2),
      Uint8Array.of(255, 225, size >> 8, size & 255),
      packet,
      jpeg.slice(2),
    ],
    { type: "image/jpeg" },
  );
}

// List opaque JPEG application segments without decoding their payloads.
export function opaqueSegments(bytes) {
  const opaque = [];
  for (let pos = 2; pos + 1 < bytes.length && bytes[pos] === 255; ) {
    while (pos + 1 < bytes.length && bytes[pos + 1] === 255) pos++;
    if (pos + 1 >= bytes.length) break;
    const marker = bytes[pos + 1];
    if (marker === 218 || marker === 217) break;
    if (pos + 4 > bytes.length) break;
    const length = bytes[pos + 2] * 256 + bytes[pos + 3];
    if (length < 2 || pos + 2 + length > bytes.length) break;
    if (marker >= 224 && marker <= 239) {
      const header = new TextDecoder("latin1").decode(
        bytes.subarray(pos + 4, Math.min(pos + 2 + length, pos + 70)),
      );
      if (
        !/^(JFIF|JFXX|Exif|http:\/\/ns\.adobe\.com\/|ICC_PROFILE|MPF|Adobe|Photoshop 3\.0|urn:iso:)/.test(
          header,
        )
      ) {
        opaque.push("APP" + (marker - 224) + " (" + (length - 2) + " B)");
      }
    }
    pos += length + 2;
  }
  return opaque;
}
