// Page analysis on the pdf-lib side: font profiles, paintable objects (images / form XObjects /
// inline images) with their page-space geometry, and the decoded content stream.
import { bytesToBinaryString, findPaintOperations, tokenize } from "./content-stream.js";
import { readFontProfile } from "./font-map.js";
import { multiply, unitQuad } from "./matrix.js";

export function readPageContent(PDFLib, page) {
  const { PDFArray, PDFRawStream, PDFName, decodePDFRawStream } = PDFLib;
  const contents = page.node.lookup(PDFName.of("Contents"));
  const streams = contents instanceof PDFArray ? contents.asArray().map((item) => page.doc.context.lookup(item)) : contents ? [contents] : [];
  const parts = [];
  for (const stream of streams) {
    if (stream instanceof PDFRawStream) parts.push(bytesToBinaryString(decodePDFRawStream(stream).decode()));
    else if (stream?.getContentsString) parts.push(stream.getContentsString());
  }
  return parts.join("\n");
}

function numberArray(PDFLib, context, object) {
  const { PDFArray, PDFNumber } = PDFLib;
  if (!(object instanceof PDFArray)) return null;
  const values = object.asArray().map((item) => context.lookup(item)).map((item) => (item instanceof PDFNumber ? item.asNumber() : Number.NaN));
  return values.every(Number.isFinite) ? values : null;
}

/** Collect font profiles from the page resources and (one level of) nested form XObjects. */
export function collectFonts(PDFLib, pdfDoc, page) {
  const { PDFName, PDFDict, PDFRef, PDFRawStream } = PDFLib;
  const context = pdfDoc.context;
  const { Font, XObject } = page.node.normalizedEntries();
  const profiles = [];
  const seenRefs = new Set();
  const addFromDict = (fontDict, fromPage) => {
    if (!(fontDict instanceof PDFDict)) return;
    for (const [name, value] of fontDict.entries()) {
      const ref = value instanceof PDFRef ? value : null;
      const key = ref ? ref.toString() : `${name.asString()}-${profiles.length}`;
      if (seenRefs.has(key)) continue;
      seenRefs.add(key);
      const dict = context.lookup(value);
      if (!(dict instanceof PDFDict)) continue;
      try {
        const profile = readFontProfile(PDFLib, context, dict, fromPage ? name.asString().slice(1) : null, ref);
        profile.fromPage = fromPage;
        profile.uid = ref ? `ref-${ref.objectNumber}-${ref.generationNumber}` : `res-${name.asString().slice(1)}`;
        profiles.push(profile);
      } catch {
        // An unreadable font dictionary is skipped; text in it falls back to substitute fonts.
      }
    }
  };
  addFromDict(Font, true);
  const visitForms = (xobjects, depth) => {
    if (!(xobjects instanceof PDFDict) || depth > 2) return;
    for (const [, value] of xobjects.entries()) {
      const stream = context.lookup(value);
      if (!(stream instanceof PDFRawStream)) continue;
      if (stream.dict.lookup(PDFName.of("Subtype"))?.asString?.() !== "/Form") continue;
      const resources = stream.dict.lookup(PDFName.of("Resources"));
      if (!(resources instanceof PDFDict)) continue;
      addFromDict(resources.lookup(PDFName.of("Font")), false);
      visitForms(resources.lookup(PDFName.of("XObject")), depth + 1);
    }
  };
  visitForms(XObject, 0);
  return profiles;
}

/** Objects painted directly by the page content stream. */
export function collectObjects(PDFLib, pdfDoc, page, contentText) {
  const { PDFName, PDFDict, PDFRawStream, PDFNumber } = PDFLib;
  const context = pdfDoc.context;
  const ops = tokenize(contentText);
  const paints = findPaintOperations(ops);
  const { XObject } = page.node.normalizedEntries();
  const objects = [];
  for (const paint of paints) {
    let subtype = "Inline";
    let base = [1, 0, 0, 1, 0, 0];
    let pixelWidth = 0;
    let pixelHeight = 0;
    if (paint.kind === "xobject") {
      const stream = XObject instanceof PDFDict ? context.lookup(XObject.get(PDFName.of(paint.name))) : null;
      if (!(stream instanceof PDFRawStream)) continue;
      const type = stream.dict.lookup(PDFName.of("Subtype"))?.asString?.();
      if (type === "/Image") {
        subtype = "Image";
        const width = stream.dict.lookup(PDFName.of("Width"));
        const height = stream.dict.lookup(PDFName.of("Height"));
        pixelWidth = width instanceof PDFNumber ? width.asNumber() : 0;
        pixelHeight = height instanceof PDFNumber ? height.asNumber() : 0;
      } else if (type === "/Form") {
        subtype = "Form";
        const bbox = numberArray(PDFLib, context, stream.dict.lookup(PDFName.of("BBox"))) || [0, 0, 1, 1];
        const matrix = numberArray(PDFLib, context, stream.dict.lookup(PDFName.of("Matrix"))) || [1, 0, 0, 1, 0, 0];
        const [x0, y0, x1, y1] = bbox;
        base = multiply([x1 - x0, 0, 0, y1 - y0, Math.min(x0, x1), Math.min(y0, y1)], matrix);
      } else {
        continue;
      }
    }
    const unit = multiply(base, paint.ctm);
    objects.push({ id: paint.id, name: paint.name, subtype, base, ctm: paint.ctm, unit, quad: unitQuad(unit), pixelWidth, pixelHeight, start: paint.start, end: paint.end });
  }
  return { objects, ops };
}

export function pageBox(page) {
  const { x, y, width, height } = page.getMediaBox();
  return { x, y, width, height, rotation: page.getRotation().angle };
}

export function analyzePage(PDFLib, pdfDoc, pageIndex) {
  const page = pdfDoc.getPage(pageIndex);
  const contentText = readPageContent(PDFLib, page);
  const fonts = collectFonts(PDFLib, pdfDoc, page);
  const { objects, ops } = collectObjects(PDFLib, pdfDoc, page, contentText);
  return { pageIndex, box: pageBox(page), fonts, objects, contentText, ops };
}
