import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  baselinePixels,
  opaqueSegments,
  addSelectedFields,
} from "../src/privacy-core.js";
import ExifReader from "exifreader";

test("baseline JPEG retains the original scan, strips opaque APP data and trailer", async () => {
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
  const scan = jpeg.subarray(jpeg.indexOf(Buffer.from([255, 218])));
  assert.deepEqual(cleaned.subarray(-scan.length), scan);
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
  assert.throws(() => addSelectedFields(jpeg, { latitude: "91" }));
});
