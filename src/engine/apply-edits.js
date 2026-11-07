// The editing engine: applies an edit list to a fresh copy of the original PDF bytes.
// The original bytes are never modified. Untouched content-stream bytes are kept verbatim.
import { analyzePage } from "./analyze.js";
import { binaryStringToBytes } from "./content-stream.js";
import { FontResolver } from "./font-resolver.js";
import { apply, decomposePlacement, fmt, invert, matrixOperand, multiply, placementMatrix, translate } from "./matrix.js";

export function hexToRgb(hex = "#000000") {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] || "000000";
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function rgbOperands(hex) {
  return hexToRgb(hex).map(fmt).join(" ");
}

function quadPath(quad) {
  return `${quad.map(([x, y], index) => `${fmt(x)} ${fmt(y)} ${index ? "l" : "m"}`).join(" ")} h`;
}

function cropQuad(placement, crop) {
  const base = placementMatrix({ ...placement, flipH: false, flipV: false });
  const left = crop?.left || 0;
  const right = crop?.right || 0;
  const top = crop?.top || 0;
  const bottom = crop?.bottom || 0;
  return [[left, bottom], [1 - right, bottom], [1 - right, 1 - top], [left, 1 - top]].map(([u, v]) => apply(base, u, v));
}

function hasCrop(crop) {
  return !!crop && ["left", "right", "top", "bottom"].some((side) => (crop[side] || 0) > 0.0001);
}

class PageWriter {
  constructor(PDFLib, pdfDoc, page) {
    this.PDFLib = PDFLib;
    this.pdfDoc = pdfDoc;
    this.page = page;
    this.fontNames = new Map();
    this.gsNames = new Map();
  }

  fontName(ref, existingName) {
    if (existingName) return existingName;
    const key = ref.toString();
    if (!this.fontNames.has(key)) this.fontNames.set(key, this.page.node.newFontDictionary("PFo", ref).asString().slice(1));
    return this.fontNames.get(key);
  }

  opacityName(opacity) {
    const key = fmt(opacity);
    if (!this.gsNames.has(key)) {
      const dict = this.pdfDoc.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity });
      const ref = this.pdfDoc.context.register(dict);
      this.gsNames.set(key, this.page.node.newExtGState("PGs", ref).asString().slice(1));
    }
    return this.gsNames.get(key);
  }

  xobjectName(ref) {
    return this.page.node.newXObject("PIm", ref).asString().slice(1);
  }

  replaceContent(text) {
    const { PDFName } = this.PDFLib;
    const stream = this.pdfDoc.context.flateStream(binaryStringToBytes(text));
    const ref = this.pdfDoc.context.register(stream);
    this.page.node.set(PDFName.of("Contents"), ref);
  }
}

async function textOperations({ edit, writer, resolver, profiles, report }) {
  const lines = String(edit.text ?? "").split("\n");
  const pieces = [];
  if (edit.mask?.length === 4 && edit.bg !== "transparent") pieces.push(`q ${rgbOperands(edit.bg || "#ffffff")} rg ${quadPath(edit.mask)} f Q`);
  const content = lines.join("");
  if (!content.trim()) { report.push({ id: edit.id, font: null, fallback: null }); return pieces.join("\n"); }
  const resolved = await resolver.resolve(edit.font || { mode: "standard" }, content, profiles);
  const widths = lines.map((line) => (line ? FontResolver.encode(resolved, line).width : 0));
  report.push({ id: edit.id, font: resolved.label, fallback: resolved.fallback, sameFont: resolved.kind === "profile", width: Math.max(0, ...widths), lines: lines.length });
  const fontName = resolved.kind === "profile"
    ? writer.fontName(resolved.profile.ref, resolved.profile.fromPage ? resolved.profile.resourceName : null)
    : writer.fontName(resolved.font.ref, null);
  let origin = edit.origin;
  if (edit.italic) origin = multiply([1, 0, 0.21, 1, 0, 0], origin);
  const scale = Math.hypot(origin[0], origin[1]) || 1;
  const parts = ["q"];
  if (edit.opacity !== undefined && edit.opacity < 1) parts.push(`/${writer.opacityName(Math.max(0, edit.opacity))} gs`);
  parts.push(`${rgbOperands(edit.color)} rg ${rgbOperands(edit.color)} RG`);
  if (edit.bold) parts.push(`${fmt(scale * 0.035)} w`);
  const lineHeight = edit.lineHeight || 1.2;
  lines.forEach((line, index) => {
    if (!line) return;
    const lineMatrix = multiply(translate(alignOffset(edit, resolved, line), -index * lineHeight), origin);
    const encoded = FontResolver.encode(resolved, line);
    const textState = `BT /${fontName} 1 Tf 0 Tc 0 Tw 100 Tz 0 Ts ${edit.bold ? 2 : 0} Tr`;
    const positioned = encoded.segments.find((segment) => segment.positioned)?.positioned;
    if (positioned) {
      const glyphs = positioned.map((glyph) => `${matrixOperand(multiply(translate(glyph.x, glyph.y), lineMatrix))} Tm <${glyph.hex}> Tj`).join("\n");
      parts.push(`${textState}\n${glyphs}\nET`);
    } else {
      const array = encoded.segments.map((segment) => (segment.gap ? fmt(-segment.gap * 1000) : `<${segment.hex}>`)).join(" ");
      parts.push(`${textState} ${matrixOperand(lineMatrix)} Tm [${array}] TJ ET`);
    }
    if (edit.underline) {
      const underline = [[0, -0.12], [encoded.width, -0.12], [encoded.width, -0.07], [0, -0.07]].map(([x, y]) => apply(lineMatrix, x, y));
      parts.push(`${quadPath(underline)} f`);
    }
  });
  parts.push("Q");
  pieces.push(parts.join("\n"));
  return pieces.join("\n");
}

function alignOffset(edit, resolved, line) {
  if (!edit.align || edit.align === "left" || !edit.boxWidth) return 0;
  const width = FontResolver.encode(resolved, line).width;
  return edit.align === "center" ? (edit.boxWidth - width) / 2 : edit.boxWidth - width;
}

function drawBlock({ inner, placement, crop, opacity, border, writer, restore }) {
  const parts = ["q"];
  if (restore) parts.push(`${matrixOperand(restore)} cm`);
  const decomposed = placement;
  if (opacity !== undefined && opacity < 1) parts.push(`/${writer.opacityName(Math.max(0, opacity))} gs`);
  const clip = hasCrop(crop) ? cropQuad(decomposed, crop) : null;
  parts.push("q");
  if (clip) parts.push(`${quadPath(clip)} W n`);
  parts.push(inner);
  parts.push("Q");
  if (border?.width > 0) {
    const outline = clip || cropQuad(decomposed, null);
    parts.push(`${rgbOperands(border.color || "#000000")} RG ${fmt(border.width)} w ${quadPath(outline)} S`);
  }
  parts.push("Q");
  return parts.join("\n");
}

async function embedAsset(pdfDoc, asset, cache) {
  if (!cache.has(asset.id)) cache.set(asset.id, asset.format === "jpg" ? pdfDoc.embedJpg(asset.bytes) : pdfDoc.embedPng(asset.bytes));
  return cache.get(asset.id);
}

/**
 * edits: see docs in ARCHITECTURE.md. Returns { bytes, report }.
 * options: { assets: Map<id, {id, bytes, format}>, loadFontBytes(script) }
 */
export async function applyEdits(libs, originalBytes, edits, options = {}) {
  const { PDFLib, fontkit } = libs;
  const pdfDoc = await PDFLib.PDFDocument.load(originalBytes, { updateMetadata: false });
  const resolver = new FontResolver(PDFLib, fontkit, pdfDoc, options.loadFontBytes, options.createShaper);
  const assets = options.assets || new Map();
  const imageCache = new Map();
  const report = [];
  const pages = [...new Set(edits.map((edit) => edit.page))].sort((a, b) => a - b);

  for (const pageNumber of pages) {
    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) throw new Error(`Page ${pageNumber} doesn't exist in this PDF.`);
    const page = pdfDoc.getPage(pageIndex);
    const analysis = analyzePage(PDFLib, pdfDoc, pageIndex);
    const writer = new PageWriter(PDFLib, pdfDoc, page);
    const objectsById = new Map(analysis.objects.map((object) => [object.id, object]));
    const splices = [];
    const back = [];
    const front = [];

    for (const edit of edits.filter((item) => item.page === pageNumber)) {
      if (edit.type === "text") {
        front.push(await textOperations({ edit, writer, resolver, profiles: analysis.fonts, report }));
      } else if (edit.type === "erase") {
        front.push(`q ${rgbOperands(edit.color || "#ffffff")} rg ${quadPath(edit.quad)} f Q`);
      } else if (edit.type === "object") {
        const object = objectsById.get(edit.objectId);
        if (!object) { report.push({ id: edit.id, error: "The object could not be found in the page." }); continue; }
        if (edit.deleted) { splices.push({ start: object.start, end: object.end, text: "" }); continue; }
        const placementMatrixValue = edit.placement ? placementMatrix(edit.placement) : object.unit;
        const placement = edit.placement || decomposePlacement(object.unit);
        let inner;
        if (edit.replaceAsset && assets.get(edit.replaceAsset)) {
          const image = await embedAsset(pdfDoc, assets.get(edit.replaceAsset), imageCache);
          inner = `${matrixOperand(placementMatrixValue)} cm /${writer.xobjectName(image.ref)} Do`;
        } else {
          const baseInverse = invert(object.base) || [1, 0, 0, 1, 0, 0];
          const drawMatrix = multiply(baseInverse, placementMatrixValue);
          const originalOp = analysis.contentText.slice(object.start, object.end);
          inner = `${matrixOperand(drawMatrix)} cm ${originalOp}`;
        }
        const z = edit.z || "same";
        if (z === "same") {
          const restore = invert(object.ctm);
          if (!restore) { report.push({ id: edit.id, error: "This object uses a degenerate transform and can't be moved." }); continue; }
          splices.push({ start: object.start, end: object.end, text: `\n${drawBlock({ inner, placement, crop: edit.crop, opacity: edit.opacity, border: edit.border, writer, restore })}\n` });
        } else {
          splices.push({ start: object.start, end: object.end, text: "" });
          (z === "back" ? back : front).push(drawBlock({ inner, placement, crop: edit.crop, opacity: edit.opacity, border: edit.border, writer }));
        }
      } else if (edit.type === "image") {
        const asset = assets.get(edit.asset);
        if (!asset) { report.push({ id: edit.id, error: "The inserted image data is missing." }); continue; }
        const image = await embedAsset(pdfDoc, asset, imageCache);
        const inner = `${matrixOperand(placementMatrix(edit.placement))} cm /${writer.xobjectName(image.ref)} Do`;
        (edit.z === "back" ? back : front).push(drawBlock({ inner, placement: edit.placement, crop: edit.crop, opacity: edit.opacity, border: edit.border, writer }));
      }
    }

    let content = analysis.contentText;
    for (const splice of splices.sort((a, b) => b.start - a.start)) content = content.slice(0, splice.start) + splice.text + content.slice(splice.end);
    writer.replaceContent(`${back.join("\n")}\nq\n${content}\nQ\n${front.join("\n")}\n`);
  }

  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  return { bytes, report };
}
