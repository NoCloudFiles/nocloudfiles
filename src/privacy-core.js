// Only a baseline, single-scan JPEG can take the lossless path. Copy codec
// segments and the entropy stream, never source application data or a trailer.
export function baselinePixels(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216) return null;
  const parts = [bytes.subarray(0, 2)];
  let pos = 2,
    baseline = false;
  while (pos + 4 <= bytes.length && bytes[pos] === 255) {
    const marker = bytes[pos + 1];
    const length = bytes[pos + 2] * 256 + bytes[pos + 3];
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 192) baseline = true;
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
        return new Blob(parts, { type: "image/jpeg" });
      }
      return null;
    }
    pos = end;
  }
  return null;
}

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
  const nodes = [];
  for (const [key, raw] of Object.entries(fields)) {
    const [tag, ns] = properties[key];
    let value = String(raw).trim();
    if (!value) continue;
    if (
      value.length > 1024 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
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
  for (let pos = 2; pos + 4 <= bytes.length && bytes[pos] === 255; ) {
    const marker = bytes[pos + 1];
    if (marker === 218 || marker === 217) break;
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
