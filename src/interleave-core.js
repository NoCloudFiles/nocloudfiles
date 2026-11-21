import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

// Decimal MB limits, matching DESIGN.md (1 MB = 1,000,000 bytes).
export const MAX_FILE_BYTES = 50_000_000;
export const MAX_TOTAL_BYTES = 80_000_000;
export const MAX_COMBINED_PAGES = 500;

export class InterleaveError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "InterleaveError";
    this.code = code;
  }
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input))
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new InterleaveError("not_pdf", "Input must be binary PDF bytes.");
}

/**
 * Verify that bytes start with a %PDF- header (allowing an optional UTF-8 BOM
 * or leading ASCII whitespace before the header within the first 1024 bytes).
 */
export function hasPdfHeader(input) {
  let bytes;
  try {
    bytes = toUint8Array(input);
  } catch {
    return false;
  }
  if (bytes.length < 5) return false;
  let offset = 0;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    offset = 3;
  }
  const limit = Math.min(bytes.length, 1024);
  while (
    offset < limit &&
    (bytes[offset] === 0x20 ||
      bytes[offset] === 0x09 ||
      bytes[offset] === 0x0a ||
      bytes[offset] === 0x0d ||
      bytes[offset] === 0x00)
  ) {
    offset++;
  }
  if (offset + 5 > bytes.length) return false;
  return (
    bytes[offset] === 0x25 && // %
    bytes[offset + 1] === 0x50 && // P
    bytes[offset + 2] === 0x44 && // D
    bytes[offset + 3] === 0x46 && // F
    bytes[offset + 4] === 0x2d // -
  );
}

function isEncryptedError(err) {
  if (!err) return false;
  if (err.name === "EncryptedPDFError") return true;
  if (err.constructor?.name === "EncryptedPDFError") return true;
  return /encrypt/i.test(String(err.message ?? ""));
}

export function validateSinglePdfBytes(input) {
  const bytes = toUint8Array(input);
  if (bytes.length === 0) {
    throw new InterleaveError("empty", "PDF file is empty.");
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new InterleaveError(
      "file_too_large",
      "PDF file exceeds the 50 MB single-file limit.",
    );
  }
  if (!hasPdfHeader(bytes)) {
    throw new InterleaveError("not_pdf", "Missing %PDF- header.");
  }
  return bytes;
}

export async function loadValidatedPdf(input) {
  const bytes = validateSinglePdfBytes(input);
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (isEncryptedError(err)) {
      throw new InterleaveError(
        "encrypted",
        "Encrypted or password-protected PDFs are not supported.",
      );
    }
    throw new InterleaveError("invalid_pdf", "PDF could not be parsed.");
  }
  if (doc.isEncrypted) {
    throw new InterleaveError(
      "encrypted",
      "Encrypted or password-protected PDFs are not supported.",
    );
  }
  const pageCount = doc.getPageCount();
  if (pageCount <= 0) {
    throw new InterleaveError("no_pages", "PDF contains no pages.");
  }
  if (pageCount > MAX_COMBINED_PAGES) {
    throw new InterleaveError(
      "too_many_pages",
      "PDF exceeds the 500-page combined limit.",
    );
  }
  return { doc, bytes, pageCount, byteLength: bytes.length };
}

export async function inspectPdf(input) {
  const { byteLength, pageCount } = await loadValidatedPdf(input);
  return { pageCount, byteLength };
}

/**
 * Pure planning function for front/back page interleaving.
 * Pairs front[0] with backOrder[0], front[1] with backOrder[1], ...,
 * appending any remaining trailing pages from whichever file is longer
 * so no page is ever silently dropped.
 */
export function planInterleave(
  frontCount,
  backCount,
  { reverseBack = true, rotateBack180 = false } = {},
) {
  if (
    !Number.isInteger(frontCount) ||
    frontCount < 0 ||
    !Number.isInteger(backCount) ||
    backCount < 0
  ) {
    throw new InterleaveError(
      "invalid_counts",
      "Page counts must be non-negative integers.",
    );
  }

  const backOrder = [];
  if (reverseBack) {
    for (let p = backCount; p >= 1; p--) backOrder.push(p);
  } else {
    for (let p = 1; p <= backCount; p++) backOrder.push(p);
  }

  const steps = [];
  const maxPairs = Math.max(frontCount, backCount);
  let outputPage = 1;
  for (let i = 0; i < maxPairs; i++) {
    if (i < frontCount) {
      steps.push({
        outputPage: outputPage++,
        source: "front",
        sourcePage: i + 1,
        rotated180: false,
      });
    }
    if (i < backOrder.length) {
      steps.push({
        outputPage: outputPage++,
        source: "back",
        sourcePage: backOrder[i],
        rotated180: Boolean(rotateBack180),
      });
    }
  }

  const difference = frontCount - backCount;
  let status;
  if (difference === 0) {
    status = "matched";
  } else if (difference === 1) {
    status = "odd_last_sheet";
  } else {
    status = "mismatch";
  }

  return {
    steps,
    status,
    difference,
    frontCount,
    backCount,
    totalPages: steps.length,
  };
}

function isLoadedPdf(input) {
  return (
    Boolean(input) &&
    typeof input === "object" &&
    !(input instanceof Uint8Array) &&
    !(input instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(input) &&
    typeof input.doc?.getPageCount === "function"
  );
}

/**
 * Losslessly interleave pages from frontInput and backInput into a fresh PDF.
 * Each input may be raw PDF bytes (Uint8Array / ArrayBuffer) or a pre-loaded
 * handle from loadValidatedPdf() to avoid re-parsing large PDFs twice.
 */
export async function buildInterleavedPdf(
  frontInput,
  backInput,
  options = {},
) {
  const frontLoaded = isLoadedPdf(frontInput);
  const backLoaded = isLoadedPdf(backInput);
  const frontBytes = frontLoaded
    ? validateSinglePdfBytes(frontInput.bytes)
    : validateSinglePdfBytes(frontInput);
  const backBytes = backLoaded
    ? validateSinglePdfBytes(backInput.bytes)
    : validateSinglePdfBytes(backInput);

  if (frontBytes.length + backBytes.length > MAX_TOTAL_BYTES) {
    throw new InterleaveError(
      "total_too_large",
      "Combined PDF size exceeds the 80 MB limit.",
    );
  }

  const [{ doc: frontDoc, pageCount: frontCount }, { doc: backDoc, pageCount: backCount }] =
    await Promise.all([
      frontLoaded
        ? Promise.resolve({
            doc: frontInput.doc,
            pageCount: frontInput.doc.getPageCount(),
          })
        : loadValidatedPdf(frontBytes),
      backLoaded
        ? Promise.resolve({
            doc: backInput.doc,
            pageCount: backInput.doc.getPageCount(),
          })
        : loadValidatedPdf(backBytes),
    ]);

  if (frontCount <= 0 || backCount <= 0) {
    throw new InterleaveError("no_pages", "PDF contains no pages.");
  }
  if (frontCount + backCount > MAX_COMBINED_PAGES) {
    throw new InterleaveError(
      "too_many_pages",
      "Combined page count exceeds the 500-page limit.",
    );
  }

  const plan = planInterleave(frontCount, backCount, options);
  const outDoc = await PDFDocument.create();

  const [frontPages, backPages] = await Promise.all([
    outDoc.copyPages(frontDoc, frontDoc.getPageIndices()),
    outDoc.copyPages(backDoc, backDoc.getPageIndices()),
  ]);

  for (const step of plan.steps) {
    const page =
      step.source === "front"
        ? frontPages[step.sourcePage - 1]
        : backPages[step.sourcePage - 1];
    if (step.rotated180) {
      const existing = page.getRotation().angle;
      const nextAngle = (((existing + 180) % 360) + 360) % 360;
      page.setRotation(degrees(nextAngle));
    }
    outDoc.addPage(page);
  }

  // Neutral metadata — never leak source document titles, authors, or filenames.
  outDoc.setTitle("");
  outDoc.setAuthor("");
  outDoc.setSubject("");
  outDoc.setKeywords([]);
  outDoc.setCreator("NoCloudFiles");
  outDoc.setProducer("NoCloudFiles / pdf-lib");

  const bytes = await outDoc.save();
  return { bytes, plan };
}

/**
 * Generate a realistic 3-sheet sample pair (front pages 1, 3, 5 and
 * reversed back pages 6, 4, 2) using pdf-lib.
 */
export async function createSampleScanPdfs() {
  async function makeDoc(pages) {
    const doc = await PDFDocument.create();
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const regular = await doc.embedFont(StandardFonts.Helvetica);

    for (const info of pages) {
      const page = doc.addPage([595.28, 841.89]); // A4 portrait
      const { width, height } = page.getSize();

      // Subtle paper border
      page.drawRectangle({
        x: 44,
        y: 44,
        width: width - 88,
        height: height - 88,
        borderColor: rgb(0.78, 0.76, 0.72),
        borderWidth: 1,
      });

      page.drawText("SAMPLE SINGLE-SIDED SCAN", {
        x: 72,
        y: height - 108,
        size: 11,
        font: bold,
        color: rgb(0.16, 0.36, 0.27),
      });

      page.drawText(info.heading, {
        x: 72,
        y: height - 152,
        size: 24,
        font: bold,
        color: rgb(0.13, 0.17, 0.15),
      });

      page.drawText(info.subline, {
        x: 72,
        y: height - 190,
        size: 13,
        font: regular,
        color: rgb(0.29, 0.33, 0.31),
      });

      page.drawText(info.detail, {
        x: 72,
        y: height - 230,
        size: 12,
        font: regular,
        color: rgb(0.39, 0.42, 0.39),
      });

      page.drawText(`Expected reading position: Page ${info.logicalPage} of 6`, {
        x: 72,
        y: 78,
        size: 11,
        font: regular,
        color: rgb(0.39, 0.42, 0.39),
      });
    }

    doc.setTitle("");
    doc.setAuthor("");
    doc.setCreator("NoCloudFiles");
    doc.setProducer("NoCloudFiles / pdf-lib");
    return doc.save();
  }

  const [frontBytes, backBytes] = await Promise.all([
    makeDoc([
      {
        logicalPage: 1,
        heading: "Sample Contract - Page 1 (Front)",
        subline: "Sheet 1 · Front side (odd page)",
        detail: "Source file: front-pages.pdf · Page 1 of 3",
      },
      {
        logicalPage: 3,
        heading: "Sample Contract - Page 3 (Front)",
        subline: "Sheet 2 · Front side (odd page)",
        detail: "Source file: front-pages.pdf · Page 2 of 3",
      },
      {
        logicalPage: 5,
        heading: "Sample Contract - Page 5 (Front)",
        subline: "Sheet 3 · Front side (odd page)",
        detail: "Source file: front-pages.pdf · Page 3 of 3",
      },
    ]),
    makeDoc([
      {
        logicalPage: 6,
        heading: "Sample Contract - Page 6 (Back)",
        subline: "Sheet 3 · Back side (even page, scanned first in reverse stack)",
        detail: "Source file: back-pages-reversed.pdf · Page 1 of 3",
      },
      {
        logicalPage: 4,
        heading: "Sample Contract - Page 4 (Back)",
        subline: "Sheet 2 · Back side (even page, scanned second in reverse stack)",
        detail: "Source file: back-pages-reversed.pdf · Page 2 of 3",
      },
      {
        logicalPage: 2,
        heading: "Sample Contract - Page 2 (Back)",
        subline: "Sheet 1 · Back side (even page, scanned last in reverse stack)",
        detail: "Source file: back-pages-reversed.pdf · Page 3 of 3",
      },
    ]),
  ]);

  return {
    frontName: "front-pages.pdf",
    frontBytes,
    backName: "back-pages-reversed.pdf",
    backBytes,
  };
}
