import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  baselinePixels,
  opaqueSegments,
  addSelectedFields,
  parseXmpCoordinate,
  canvasDimensions,
  MAX_CANVAS_PIXELS,
} from "../src/privacy-core.js";
import ExifReader from "exifreader";

test("baseline JPEG retains the original scan, strips opaque APP data and trailer, and emits clean JFIF", async () => {
  const jpeg = await readFile("tests/fixtures/synthetic.jpg");
  const payload = Buffer.from("Private information");
  const injected = Buffer.concat([
    jpeg.subarray(0, 2),
    Buffer.from([255, 235, 0, payload.length + 2]),
    payload,
    jpeg.subarray(2),
    payload,
  ]);
  assert.match(opaqueSegments(injected)[0], /APP11/);
  const cleaned = Buffer.from(await baselinePixels(injected).arrayBuffer());
  assert.equal(cleaned.includes(payload), false);
  // Original synthetic.jpg had JFIF APP0 with 72x72 density; clean copy gets minimal 18-byte JFIF 1.01 (1x1, units 0, no thumbnail).
  assert.deepEqual(
    [...cleaned.subarray(0, 20)],
    [255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
  );
  const scan = jpeg.subarray(jpeg.indexOf(Buffer.from([255, 218])));
  assert.deepEqual(cleaned.subarray(-scan.length), scan);
});

test("baselinePixels and opaqueSegments skip legal 0xFF fill bytes before markers", async () => {
  const jpeg = await readFile("tests/fixtures/synthetic.jpg");
  const payload = Buffer.from("VendorBlock");
  const padded = Buffer.concat([
    jpeg.subarray(0, 2),
    // Extra 0xFF fill bytes before APP11 and before rest of JPEG
    Buffer.from([255, 255, 255, 235, 0, payload.length + 2]),
    payload,
    Buffer.from([255, 255]),
    jpeg.subarray(2),
  ]);
  assert.deepEqual(opaqueSegments(padded), [`APP11 (${payload.length} B)`]);
  const blob = baselinePixels(padded);
  assert.ok(blob, "baselinePixels should succeed with 0xFF fill bytes");
  const cleaned = Buffer.from(await blob.arrayBuffer());
  assert.equal(cleaned.includes(payload), false);
  const scan = jpeg.subarray(jpeg.indexOf(Buffer.from([255, 218])));
  assert.deepEqual(cleaned.subarray(-scan.length), scan);
});

test("baselinePixels does not emit JFIF APP0 when source JPEG had none", async () => {
  const jpeg = await readFile("tests/fixtures/synthetic.jpg");
  // Strip original APP0 (bytes 2..20) from synthetic.jpg
  assert.equal(jpeg[2], 255);
  assert.equal(jpeg[3], 224);
  const app0Len = jpeg[4] * 256 + jpeg[5];
  const noJfif = Buffer.concat([jpeg.subarray(0, 2), jpeg.subarray(4 + app0Len)]);
  const cleaned = Buffer.from(await baselinePixels(noJfif).arrayBuffer());
  assert.notEqual(cleaned[3], 224);
  assert.equal(cleaned.includes(Buffer.from("JFIF")), false);
});

test("writes only explicitly selected values and escapes personal text", async () => {
  const jpeg = new Blob([await readFile("tests/fixtures/synthetic.jpg")]);
  const fields = {
    author: "<薇 & Co>",
    city: "台北",
    latitude: "-12.25",
    longitude: "101.5",
  };
  const output = await addSelectedFields(jpeg, fields).arrayBuffer();
  const { xmp } = ExifReader.load(output, { expanded: true });
  assert.equal(xmp.creator.description, fields.author);
  assert.equal(xmp.City.description, fields.city);
  assert.equal(xmp.GPSLatitude.description, "12.25S");
  assert.equal(xmp.GPSLongitude.description, "101.5E");
  assert.throws(
    () => addSelectedFields(jpeg, { latitude: "91", longitude: "0" }),
    { message: "coordinate" },
  );
  assert.throws(
    () => addSelectedFields(jpeg, { latitude: "0", longitude: "-181" }),
    { message: "coordinate" },
  );
});

test("parseXmpCoordinate parses DMS, DM, signed and suffixed decimal in all 4 hemispheres without float garbage", async () => {
  assert.equal(parseXmpCoordinate("37,46.4940000N"), 37.7749);
  assert.equal(parseXmpCoordinate("122,25.1640000W"), -122.4194);
  assert.equal(parseXmpCoordinate("37,46,29.64S"), -37.7749);
  assert.equal(parseXmpCoordinate("151,12,33.48E"), 151.2093);
  assert.equal(parseXmpCoordinate("122.4194W"), -122.4194);
  assert.equal(parseXmpCoordinate("-122.4194"), -122.4194);
  assert.equal(parseXmpCoordinate("+37.7749"), 37.7749);
  assert.equal(parseXmpCoordinate("0,0.0000000S"), 0);
  assert.equal(Object.is(parseXmpCoordinate("0,0.0000000S"), -0), false);
  assert.equal(parseXmpCoordinate({ value: "37,46.4940000N" }), 37.7749);
  assert.equal(parseXmpCoordinate({ description: "122.4194W" }), -122.4194);
  assert.equal(parseXmpCoordinate("91,0N"), undefined);
  assert.equal(parseXmpCoordinate("37,60N"), undefined);
  assert.equal(parseXmpCoordinate("-37,46.494N"), undefined);
  assert.equal(parseXmpCoordinate("not-a-coord"), undefined);
  assert.equal(parseXmpCoordinate(undefined), undefined);

  // Full round-trip through addSelectedFields + ExifReader in all 4 hemispheres
  const jpeg = new Blob([await readFile("tests/fixtures/synthetic.jpg")]);
  for (const [lat, lon] of [
    [37.7749, 139.6917],   // N, E
    [37.7749, -122.4194],  // N, W
    [-33.8688, 151.2093],  // S, E
    [-23.5505, -46.6333],  // S, W
  ]) {
    const out = await addSelectedFields(jpeg, {
      latitude: String(lat),
      longitude: String(lon),
    }).arrayBuffer();
    const tags = ExifReader.load(out, { expanded: true });
    assert.equal(tags.gps, undefined);
    assert.equal(parseXmpCoordinate(tags.xmp.GPSLatitude), lat);
    assert.equal(parseXmpCoordinate(tags.xmp.GPSLongitude), lon);
  }
});

test("addSelectedFields requires paired latitude and longitude", async () => {
  const jpeg = new Blob([await readFile("tests/fixtures/synthetic.jpg")]);
  assert.throws(
    () => addSelectedFields(jpeg, { latitude: "37.7749" }),
    { message: "paired_gps" },
  );
  assert.throws(
    () => addSelectedFields(jpeg, { longitude: "-122.4194" }),
    { message: "paired_gps" },
  );
  assert.throws(
    () => addSelectedFields(jpeg, { latitude: "37.7749", longitude: "   " }),
    { message: "paired_gps" },
  );
});

test("addSelectedFields rejects lone UTF-16 surrogates while preserving valid astral emoji", async () => {
  const jpeg = new Blob([await readFile("tests/fixtures/synthetic.jpg")]);
  // Lone high surrogate (e.g. sliced emoji at maxLength=1024)
  const sliced = ("a".repeat(1023) + "😀").slice(0, 1024);
  assert.throws(() => addSelectedFields(jpeg, { author: sliced }), {
    message: "value",
  });
  // Lone low surrogate
  assert.throws(() => addSelectedFields(jpeg, { description: "bad\uDE00" }), {
    message: "value",
  });
  // Valid astral surrogate pair succeeds and round-trips intact
  const ok = await addSelectedFields(jpeg, { author: "Traveler 📷" }).arrayBuffer();
  const { xmp } = ExifReader.load(ok, { expanded: true });
  assert.equal(xmp.creator.description, "Traveler 📷");
});

test("baselinePixels rejects non-YCbCr SOF0 component IDs (e.g. raw RGB 'R','G','B')", async () => {
  const jpeg = Buffer.from(await readFile("tests/fixtures/synthetic.jpg"));
  const sof0 = jpeg.indexOf(Buffer.from([255, 192]));
  assert.ok(sof0 > 0);
  // Sanity-check synthetic.jpg uses standard YCbCr IDs 1, 2, 3
  assert.equal(jpeg[sof0 + 9], 3);
  assert.deepEqual([jpeg[sof0 + 10], jpeg[sof0 + 13], jpeg[sof0 + 16]], [1, 2, 3]);
  // Mutate component IDs to ASCII 'R', 'G', 'B' (82, 71, 66)
  const rgbJpeg = Buffer.from(jpeg);
  rgbJpeg[sof0 + 10] = 82;
  rgbJpeg[sof0 + 13] = 71;
  rgbJpeg[sof0 + 16] = 66;
  assert.equal(baselinePixels(rgbJpeg), null);
});

test("canvasDimensions clamps 24MP and 48MP photos to the 16.77MP canvas ceiling", () => {
  const small = canvasDimensions(240, 180);
  assert.deepEqual(small, { width: 240, height: 180, scaled: false });

  const exact = canvasDimensions(4096, 4096);
  assert.deepEqual(exact, { width: 4096, height: 4096, scaled: false });

  const mp24 = canvasDimensions(5712, 4284);
  assert.equal(mp24.scaled, true);
  assert.ok(mp24.width * mp24.height <= MAX_CANVAS_PIXELS);
  assert.ok(mp24.width > 4700 && mp24.height > 3500);
  assert.ok(Math.abs(mp24.width / mp24.height - 5712 / 4284) < 0.002);

  const mp48 = canvasDimensions(8064, 6048);
  assert.equal(mp48.scaled, true);
  assert.ok(mp48.width * mp48.height <= MAX_CANVAS_PIXELS);
  assert.ok(Math.abs(mp48.width / mp48.height - 8064 / 6048) < 0.002);

  const extreme = canvasDimensions(50_000_000, 1);
  assert.equal(extreme.scaled, true);
  assert.ok(extreme.width * extreme.height <= MAX_CANVAS_PIXELS);
});
