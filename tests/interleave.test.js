import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  degrees,
} from "pdf-lib";
import {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_COMBINED_PAGES,
  InterleaveError,
  hasPdfHeader,
  loadValidatedPdf,
  inspectPdf,
  planInterleave,
  buildInterleavedPdf,
  createSampleScanPdfs,
} from "../src/interleave-core.js";

/**
 * Helper: build a PDF where each page has a distinct width (e.g. 400 + id)
 * and optional rotation & metadata so we can verify exact page order and rotation.
 */
async function makeTestPdf(specs, meta = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of specs) {
    const page = doc.addPage([spec.width ?? 500, spec.height ?? 700]);
    if (spec.rotation) page.setRotation(degrees(spec.rotation));
    if (spec.label) {
      page.drawText(spec.label, { x: 40, y: 600, size: 18, font });
    }
  }
  if (meta.title) doc.setTitle(meta.title);
  if (meta.author) doc.setAuthor(meta.author);
  if (meta.subject) doc.setSubject(meta.subject);
  if (meta.creator) doc.setCreator(meta.creator);
  return doc.save();
}

/**
 * Helper: extract decoded text from a pdf-lib page's content stream(s),
 * handling both FlateDecode streams, PDFArray of streams, and hex Tj strings.
 */
function extractPageContent(doc, pageIndex) {
  const page = doc.getPage(pageIndex);
  const contents = page.node.get(PDFName.of("Contents"));
  const resolved = doc.context.lookup(contents);
  const refs = resolved instanceof PDFArray ? resolved.asArray() : [contents];
  const chunks = [];
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const filter = stream.dict.get(PDFName.of("Filter"));
    const buf =
      filter && filter.toString() === "/FlateDecode"
        ? inflateSync(stream.contents)
        : Buffer.from(stream.contents);
    const raw = buf.toString("latin1");
    for (const m of raw.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) {
      chunks.push(Buffer.from(m[1], "hex").toString("latin1"));
    }
    chunks.push(raw);
  }
  return chunks.join("\n");
}

/**
 * Minimal syntactically valid PDF with an /Encrypt dictionary in its trailer
 * so pdf-lib's encryption detection rejects it cleanly.
 */
function makeEncryptedPdfBytes() {
  const raw = [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    "endobj",
    "4 0 obj",
    "<< /Filter /Standard /V 1 /R 2 /O (01234567890123456789012345678901) /U (01234567890123456789012345678901) /P -44 >>",
    "endobj",
    "xref",
    "0 5",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000058 00000 n ",
    "0000000115 00000 n ",
    "0000000181 00000 n ",
    "trailer",
    "<< /Size 5 /Root 1 0 R /Encrypt 4 0 R >>",
    "startxref",
    "315",
    "%%EOF",
  ].join("\n");
  return new TextEncoder().encode(raw);
}

test("planInterleave handles reversed back order (default)", () => {
  const plan = planInterleave(3, 3);
  assert.equal(plan.status, "matched");
  assert.equal(plan.difference, 0);
  assert.deepEqual(plan.steps, [
    { outputPage: 1, source: "front", sourcePage: 1, rotated180: false },
    { outputPage: 2, source: "back", sourcePage: 3, rotated180: false },
    { outputPage: 3, source: "front", sourcePage: 2, rotated180: false },
    { outputPage: 4, source: "back", sourcePage: 2, rotated180: false },
    { outputPage: 5, source: "front", sourcePage: 3, rotated180: false },
    { outputPage: 6, source: "back", sourcePage: 1, rotated180: false },
  ]);
});

test("planInterleave handles normal (forward) back order", () => {
  const plan = planInterleave(3, 3, { reverseBack: false });
  assert.equal(plan.status, "matched");
  assert.equal(plan.difference, 0);
  assert.deepEqual(plan.steps, [
    { outputPage: 1, source: "front", sourcePage: 1, rotated180: false },
    { outputPage: 2, source: "back", sourcePage: 1, rotated180: false },
    { outputPage: 3, source: "front", sourcePage: 2, rotated180: false },
    { outputPage: 4, source: "back", sourcePage: 2, rotated180: false },
    { outputPage: 5, source: "front", sourcePage: 3, rotated180: false },
    { outputPage: 6, source: "back", sourcePage: 3, rotated180: false },
  ]);
});

test("planInterleave flags odd_last_sheet (3 fronts + 2 backs = 5 pages, none dropped)", () => {
  const plan = planInterleave(3, 2, { reverseBack: true });
  assert.equal(plan.status, "odd_last_sheet");
  assert.equal(plan.difference, 1);
  assert.equal(plan.steps.length, 5);
  assert.deepEqual(
    plan.steps.map((s) => `${s.source[0]}${s.sourcePage}`),
    ["f1", "b2", "f2", "b1", "f3"],
  );
});

test("planInterleave flags mismatch when front has extra pages (4 fronts + 2 backs = 6 pages, none dropped)", () => {
  const plan = planInterleave(4, 2, { reverseBack: true });
  assert.equal(plan.status, "mismatch");
  assert.equal(plan.difference, 2);
  assert.equal(plan.steps.length, 6);
  assert.deepEqual(
    plan.steps.map((s) => `${s.source[0]}${s.sourcePage}`),
    ["f1", "b2", "f2", "b1", "f3", "f4"],
  );
});

test("planInterleave flags mismatch when back has more pages (2 fronts + 4 backs = 6 pages, none dropped)", () => {
  const plan = planInterleave(2, 4, { reverseBack: true });
  assert.equal(plan.status, "mismatch");
  assert.equal(plan.difference, -2);
  assert.equal(plan.steps.length, 6);
  assert.deepEqual(
    plan.steps.map((s) => `${s.source[0]}${s.sourcePage}`),
    ["f1", "b4", "f2", "b3", "b2", "b1"],
  );
});

test("buildInterleavedPdf interleaves reversed and normal back stacks accurately", async () => {
  const frontBytes = await makeTestPdf([
    { width: 401 },
    { width: 403 },
    { width: 405 },
  ]);
  const backReversedBytes = await makeTestPdf([
    { width: 406 },
    { width: 404 },
    { width: 402 },
  ]);

  const rev = await buildInterleavedPdf(frontBytes, backReversedBytes, {
    reverseBack: true,
  });
  const revDoc = await PDFDocument.load(rev.bytes);
  assert.equal(revDoc.getPageCount(), 6);
  assert.deepEqual(
    revDoc.getPages().map((p) => p.getWidth()),
    [401, 402, 403, 404, 405, 406],
  );

  const backNormalBytes = await makeTestPdf([
    { width: 402 },
    { width: 404 },
    { width: 406 },
  ]);
  const norm = await buildInterleavedPdf(frontBytes, backNormalBytes, {
    reverseBack: false,
  });
  const normDoc = await PDFDocument.load(norm.bytes);
  assert.deepEqual(
    normDoc.getPages().map((p) => p.getWidth()),
    [401, 402, 403, 404, 405, 406],
  );
});

test("buildInterleavedPdf rotates back pages 180° while preserving existing 90° page rotation (90 + 180 = 270)", async () => {
  const frontBytes = await makeTestPdf([
    { width: 500, rotation: 90 },
    { width: 500, rotation: 0 },
  ]);
  const backBytes = await makeTestPdf([
    { width: 500, rotation: 270 }, // will become output page 4 -> (270+180)%360 = 90
    { width: 500, rotation: 90 }, // will become output page 2 -> (90+180)%360 = 270
  ]);

  const { bytes, plan } = await buildInterleavedPdf(frontBytes, backBytes, {
    reverseBack: true,
    rotateBack180: true,
  });
  assert.deepEqual(
    plan.steps.map((s) => s.rotated180),
    [false, true, false, true],
  );

  const outDoc = await PDFDocument.load(bytes);
  assert.deepEqual(
    outDoc.getPages().map((p) => p.getRotation().angle),
    [90, 270, 0, 90],
  );
});

test("buildInterleavedPdf preserves all pages for odd_last_sheet and mismatch cases", async () => {
  const front3 = await makeTestPdf([{ width: 301 }, { width: 303 }, { width: 305 }]);
  const back2 = await makeTestPdf([{ width: 304 }, { width: 302 }]);
  const odd = await buildInterleavedPdf(front3, back2, { reverseBack: true });
  assert.equal(odd.plan.status, "odd_last_sheet");
  const oddDoc = await PDFDocument.load(odd.bytes);
  assert.deepEqual(
    oddDoc.getPages().map((p) => p.getWidth()),
    [301, 302, 303, 304, 305],
  );

  const front4 = await makeTestPdf([
    { width: 301 },
    { width: 303 },
    { width: 305 },
    { width: 307 },
  ]);
  const mismatchFront = await buildInterleavedPdf(front4, back2, { reverseBack: true });
  assert.equal(mismatchFront.plan.status, "mismatch");
  const mfDoc = await PDFDocument.load(mismatchFront.bytes);
  assert.deepEqual(
    mfDoc.getPages().map((p) => p.getWidth()),
    [301, 302, 303, 304, 305, 307],
  );

  const front2 = await makeTestPdf([{ width: 301 }, { width: 303 }]);
  const back4 = await makeTestPdf([
    { width: 308 },
    { width: 306 },
    { width: 304 },
    { width: 302 },
  ]);
  const mismatchBack = await buildInterleavedPdf(front2, back4, { reverseBack: true });
  assert.equal(mismatchBack.plan.status, "mismatch");
  const mbDoc = await PDFDocument.load(mismatchBack.bytes);
  assert.deepEqual(
    mbDoc.getPages().map((p) => p.getWidth()),
    [301, 302, 303, 304, 306, 308],
  );
});

test("buildInterleavedPdf sanitizes metadata (neutral creator/producer, clears title/author)", async () => {
  const frontBytes = await makeTestPdf([{ width: 500 }], {
    title: "Confidential Tax Return 2026",
    author: "Jane Secret",
    subject: "Private",
    creator: "ScannerCorp Pro",
  });
  const backBytes = await makeTestPdf([{ width: 500 }], {
    title: "Back Stack Secret",
    author: "John Secret",
  });

  const { bytes } = await buildInterleavedPdf(frontBytes, backBytes);
  const outDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(outDoc.getTitle(), "");
  assert.equal(outDoc.getAuthor(), "");
  assert.equal(outDoc.getSubject(), "");
  assert.equal(outDoc.getCreator(), "NoCloudFiles");
  assert.equal(outDoc.getProducer(), "NoCloudFiles / pdf-lib");
});

test("validation rejects empty, non-PDF, oversized (>50 MB), combined >80 MB, and >500-page inputs", async () => {
  const validPdf = await makeTestPdf([{ width: 500 }]);

  // Empty
  assert.equal(hasPdfHeader(new Uint8Array(0)), false);
  await assert.rejects(
    () => inspectPdf(new Uint8Array(0)),
    (err) => err instanceof InterleaveError && err.code === "empty",
  );

  // Non-PDF
  const notPdf = new TextEncoder().encode("<html>not a pdf</html>");
  assert.equal(hasPdfHeader(notPdf), false);
  await assert.rejects(
    () => buildInterleavedPdf(notPdf, validPdf),
    (err) => err instanceof InterleaveError && err.code === "not_pdf",
  );

  // Oversized single file (> 50 MB)
  const huge = new Uint8Array(MAX_FILE_BYTES + 1);
  huge.set(new TextEncoder().encode("%PDF-1.7\n"), 0);
  await assert.rejects(
    () => inspectPdf(huge),
    (err) => err instanceof InterleaveError && err.code === "file_too_large",
  );

  // Combined > 80 MB (two 45 MB buffers)
  const bigA = new Uint8Array(45_000_000);
  bigA.set(new TextEncoder().encode("%PDF-1.7\n"), 0);
  const bigB = new Uint8Array(45_000_000);
  bigB.set(new TextEncoder().encode("%PDF-1.7\n"), 0);
  assert.ok(bigA.length <= MAX_FILE_BYTES && bigA.length + bigB.length > MAX_TOTAL_BYTES);
  await assert.rejects(
    () => buildInterleavedPdf(bigA, bigB),
    (err) => err instanceof InterleaveError && err.code === "total_too_large",
  );

  // Combined > 500 pages (260 + 250 = 510 pages)
  const makeBlankPages = async (count) => {
    const d = await PDFDocument.create();
    for (let i = 0; i < count; i++) d.addPage([100, 100]);
    return d.save();
  };
  const [p260, p250] = await Promise.all([makeBlankPages(260), makeBlankPages(250)]);
  assert.ok(260 + 250 > MAX_COMBINED_PAGES);
  await assert.rejects(
    () => buildInterleavedPdf(p260, p250),
    (err) => err instanceof InterleaveError && err.code === "too_many_pages",
  );
});

test("encrypted PDFs are cleanly rejected with structured error code 'encrypted'", async () => {
  const encryptedBytes = makeEncryptedPdfBytes();
  const validPdf = await makeTestPdf([{ width: 500 }]);

  await assert.rejects(
    () => inspectPdf(encryptedBytes),
    (err) => err instanceof InterleaveError && err.code === "encrypted",
  );

  await assert.rejects(
    () => buildInterleavedPdf(validPdf, encryptedBytes),
    (err) => err instanceof InterleaveError && err.code === "encrypted",
  );
});

test("createSampleScanPdfs round-trips into reading order 1..6", async () => {
  const sample = await createSampleScanPdfs();
  assert.equal(sample.frontName, "front-pages.pdf");
  assert.equal(sample.backName, "back-pages-reversed.pdf");

  const frontInfo = await inspectPdf(sample.frontBytes);
  const backInfo = await inspectPdf(sample.backBytes);
  assert.equal(frontInfo.pageCount, 3);
  assert.equal(backInfo.pageCount, 3);

  const { bytes, plan } = await buildInterleavedPdf(
    sample.frontBytes,
    sample.backBytes,
    { reverseBack: true, rotateBack180: false },
  );
  assert.equal(plan.status, "matched");
  assert.equal(plan.totalPages, 6);

  const outDoc = await PDFDocument.load(bytes);
  assert.equal(outDoc.getPageCount(), 6);
  const expectedLabels = [
    "Page 1 (Front)",
    "Page 2 (Back)",
    "Page 3 (Front)",
    "Page 4 (Back)",
    "Page 5 (Front)",
    "Page 6 (Back)",
  ];
  for (let i = 0; i < expectedLabels.length; i++) {
    const content = extractPageContent(outDoc, i);
    assert.ok(
      content.includes(expectedLabels[i]),
      `Output page ${i + 1} expected "${expectedLabels[i]}", got: ${content.slice(0, 200)}`,
    );
  }
});

test("interleave HTML pages satisfy NoCloudFiles DESIGN.md structural contracts", () => {
  for (const [path, zh] of [
    ["interleave-pdf/index.html", false],
    ["zh/interleave-pdf/index.html", true],
  ]) {
    const s = readFileSync(path, "utf8");
    assert.match(s, new RegExp(`<html lang="${zh ? "zh-CN" : "en"}" data-tool="interleave_pdf">`), path);
    assert.doesNotMatch(s, /\sstyle=/i, `${path} has inline style`);
    assert.doesNotMatch(s, /<style[\s>]/i, `${path} has <style> block`);
    assert.doesNotMatch(s, /fonts\.(googleapis|gstatic)/i, path);
    const head = s.slice(0, s.indexOf("</head>"));
    assert.match(head, /<link rel="stylesheet" href="\/src\/style\.css" \/>/, path);
    assert.match(head, /<link rel="icon" href="\/favicon\.svg" \/>/, path);
    assert.match(
      s,
      /<section class="intro">\s*<p class="eyebrow">[^<]+<\/p>\s*<h1>[\s\S]+?<\/h1>\s*<p class="lead">/,
      path,
    );
    assert.equal((s.match(/<h1>/g) || []).length, 1, path);
    const brief = s.match(/<dl class="brief">([\s\S]*?)<\/dl>/);
    assert.ok(brief, `${path} lacks .brief`);
    assert.equal((brief[1].match(/<dt>[^<]+<\/dt><dd>[\s\S]+?<\/dd>/g) || []).length, 3, path);
    assert.ok(s.indexOf('class="brief"') < s.indexOf('class="step"'), path);
    for (const side of ["scope-does", "scope-not"]) {
      const block = s.match(new RegExp(`class="${side}">([\\s\\S]*?)</ul>`));
      assert.ok(block && /<li>/.test(block[1]), `${path} .${side} empty`);
    }
    for (const m of s.matchAll(/<input\b[^>]*type="file"[^>]*>/g)) {
      assert.match(m[0], /class="[^"]*visually-hidden/, `${path}: ${m[0]}`);
      const id = m[0].match(/id="([^"]+)"/)?.[1];
      assert.ok(new RegExp(`<label[^>]+for="${id}"`).test(s), `${path}: missing label for ${id}`);
    }
    const steps = [...s.matchAll(/<span class="step">(\d+)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(steps, ["1", "2", "3", "4"], `${path} steps must be continuous 1..4`);
  }
  const uiJs = readFileSync("src/interleave-ui.js", "utf8");
  assert.doesNotMatch(uiJs, /import\s+["'][^"']+\.css["']/);
});

test("reusing pre-loaded PDF handles across repeated builds never mutates source rotations", async () => {
  const frontBytes = await makeTestPdf([{ width: 500, rotation: 0 }]);
  const backBytes = await makeTestPdf([{ width: 500, rotation: 90 }]);
  const [frontLoaded, backLoaded] = await Promise.all([
    loadValidatedPdf(frontBytes),
    loadValidatedPdf(backBytes),
  ]);

  const first = await buildInterleavedPdf(frontLoaded, backLoaded, {
    reverseBack: true,
    rotateBack180: true,
  });
  const second = await buildInterleavedPdf(frontLoaded, backLoaded, {
    reverseBack: true,
    rotateBack180: false,
  });

  const firstDoc = await PDFDocument.load(first.bytes, { updateMetadata: false });
  const secondDoc = await PDFDocument.load(second.bytes, { updateMetadata: false });
  assert.deepEqual(
    firstDoc.getPages().map((p) => p.getRotation().angle),
    [0, 270],
  );
  assert.deepEqual(
    secondDoc.getPages().map((p) => p.getRotation().angle),
    [0, 90],
  );
  // Source handle itself remains untouched at 90°
  assert.equal(backLoaded.doc.getPage(0).getRotation().angle, 90);
});
