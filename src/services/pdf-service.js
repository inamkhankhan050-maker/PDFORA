import { PDFJS_VERSION, PRODUCT } from "../config.js";

const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

let pdfjsPromise;

async function getPDFJS() {
  pdfjsPromise ??= import(PDFJS_URL)
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    })
    .catch(() => {
      pdfjsPromise = undefined;
      throw new Error("The PDF viewer couldn't load. Check your internet connection and try again.");
    });
  return pdfjsPromise;
}

export function validatePDFFile(file) {
  if (!file) return { ok: false, message: "Choose a PDF file to get started." };
  if (file.size === 0) return { ok: false, message: "This file is empty." };
  if (file.size > PRODUCT.maxFileBytes) {
    return { ok: false, message: `This file is larger than ${PRODUCT.maxFileBytes / 1024 / 1024} MB.` };
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "PDFora supports PDF files only." };
  }
  return { ok: true };
}

export async function openPDF(file) {
  const validation = validatePDFFile(file);
  if (!validation.ok) throw new Error(validation.message);

  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const signature = new TextDecoder("latin1").decode(header);
  if (!signature.includes("%PDF-")) throw new Error("This file does not contain a valid PDF signature.");

  const pdfjs = await getPDFJS();
  const data = new Uint8Array(await file.arrayBuffer());
  let document;
  try {
    document = await pdfjs.getDocument({ data }).promise;
  } catch (error) {
    if (error?.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Password-based opening will be added in a later phase.");
    }
    throw new Error("PDFora couldn't read this PDF. It may be damaged or use an unsupported feature.");
  }

  if (document.numPages < PRODUCT.minPages || document.numPages > PRODUCT.maxPages) {
    await document.destroy();
    throw new Error(`This document has ${document.numPages} pages. PDFora currently supports ${PRODUCT.minPages}–${PRODUCT.maxPages} pages.`);
  }

  return document;
}

export async function renderPage(document, pageNumber, scale, canvas) {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser couldn't create a PDF canvas.");

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  await page.render({
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  }).promise;
  return { width: viewport.width, height: viewport.height, transform: viewport.transform };
}

function multiplyTransforms(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

export async function renderSelectableText(pdfDocument, pageNumber, scale, layer) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const content = await page.getTextContent();
  layer.replaceChildren();
  layer.style.width = `${Math.floor(viewport.width)}px`;
  layer.style.height = `${Math.floor(viewport.height)}px`;
  layer.dataset.viewportWidth = String(viewport.width);
  layer.dataset.viewportHeight = String(viewport.height);

  const measurementCanvas = globalThis.document.createElement("canvas");
  const context = measurementCanvas.getContext("2d");
  let wordCount = 0;
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const style = content.styles[item.fontName] || {};
    const transform = multiplyTransforms(viewport.transform, item.transform);
    const angle = Math.atan2(transform[1], transform[0]);
    const fontSize = Math.hypot(transform[2], transform[3]);
    const ascent = style.ascent ?? (style.descent ? 1 + style.descent : 0.8);
    const family = style.fontFamily || "sans-serif";
    const desiredWidth = Math.max(0, item.width * scale);
    if (context) {
      context.font = `${fontSize}px ${family}`;
    }
    const measuredWidth = context?.measureText(item.str).width || desiredWidth || 1;
    const scaleX = desiredWidth > 0 ? desiredWidth / measuredWidth : 1;
    const span = globalThis.document.createElement("span");
    span.className = "selectable-text-item";
    span.textContent = item.str;
    span.dataset.fontSize = String(fontSize / scale);
    span.style.left = `${transform[4]}px`;
    span.style.top = `${transform[5] - ascent * fontSize}px`;
    span.style.height = `${fontSize}px`;
    span.style.fontSize = `${fontSize}px`;
    span.style.fontFamily = family;
    span.style.transform = `rotate(${angle}rad) scaleX(${scaleX})`;
    layer.append(span);
    wordCount += (item.str.match(/\S+/g) || []).length;
  }
  return { wordCount, transform: viewport.transform, width: viewport.width, height: viewport.height };
}

let pdfLibPromise;

async function getPDFLib() {
  pdfLibPromise ??= import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm").catch(() => {
    pdfLibPromise = undefined;
    throw new Error("The PDF export library couldn't load. Check your internet connection and try again.");
  });
  return pdfLibPromise;
}

export async function exportPDFWithText(file, edits) {
  if (!edits.length) throw new Error("Add text to the document before exporting.");
  const { PDFDocument, StandardFonts, rgb } = await getPDFLib();
  let pdf;
  try {
    pdf = await PDFDocument.load(await file.arrayBuffer());
  } catch {
    throw new Error("This PDF couldn't be prepared for export. Password-protected or damaged files may not be supported.");
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const edit of edits) {
    const page = pdf.getPage(edit.page - 1);
    if (!page) throw new Error(`Page ${edit.page} is no longer available.`);
    if (edit.type === "replaceWord") {
      page.drawRectangle({
        x: edit.x,
        y: edit.maskY ?? edit.y,
        width: edit.width,
        height: edit.height,
        color: rgb(1, 1, 1),
      });
      if (edit.replacement) {
        let replacementColor;
        try {
          font.encodeText(edit.replacement);
          replacementColor = rgb(Number.parseInt(edit.color.slice(1, 3), 16) / 255, Number.parseInt(edit.color.slice(3, 5), 16) / 255, Number.parseInt(edit.color.slice(5, 7), 16) / 255);
        } catch {
          throw new Error("This font supports basic Latin characters only. Hindi and other Unicode text need an embedded font, planned for a later phase.");
        }
        page.drawText(edit.replacement, { x: edit.x, y: edit.y, size: edit.size, font, color: replacementColor });
      }
      continue;
    }
    let color;
    try {
      color = rgb(Number.parseInt(edit.color.slice(1, 3), 16) / 255, Number.parseInt(edit.color.slice(3, 5), 16) / 255, Number.parseInt(edit.color.slice(5, 7), 16) / 255);
      font.encodeText(edit.text);
    } catch {
      throw new Error("This font supports basic Latin characters only. Hindi and other Unicode text need an embedded font, planned for a later phase.");
    }
    page.drawText(edit.text, { x: edit.x, y: edit.y, size: edit.size, font, color });
  }
  return pdf.save();
}

export function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
