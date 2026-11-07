import { PRODUCT } from "../config.js";
import { getPDFJS } from "./libs.js";

export function validatePDFFile(file) {
  if (!file) return { ok: false, message: "Choose a PDF file to get started." };
  if (file.size === 0) return { ok: false, message: "This file is empty." };
  if (file.size > PRODUCT.maxFileBytes) {
    return { ok: false, message: `This file is larger than ${PRODUCT.maxFileBytes / 1024 / 1024} MB.` };
  }
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "PDFora supports PDF files only." };
  }
  return { ok: true };
}

export function hasPDFSignature(bytes) {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return header.includes("%PDF-");
}

export class PasswordRequiredError extends Error {
  constructor(incorrect) {
    super(incorrect ? "That password didn't open this PDF. Try again." : "This PDF is password-protected. Enter its password to open it.");
    this.name = "PasswordRequiredError";
    this.incorrect = incorrect;
  }
}

/** Open PDF bytes with PDF.js. The bytes are copied, so the caller's buffer stays intact. */
export async function openPDFBytes(bytes, { password, checkLimits = true } = {}) {
  if (!hasPDFSignature(bytes)) throw new Error("This file does not contain a valid PDF signature.");
  const pdfjs = await getPDFJS();
  let document;
  try {
    document = await pdfjs.getDocument({
      data: bytes.slice(),
      password,
      fontExtraProperties: true,
      isEvalSupported: false,
      enableXfa: false,
    }).promise;
  } catch (error) {
    if (error?.name === "PasswordException") throw new PasswordRequiredError(error.code === 2);
    throw new Error("PDFora couldn't read this PDF. It may be damaged or use an unsupported feature.");
  }
  if (checkLimits && (document.numPages < PRODUCT.minPages || document.numPages > PRODUCT.maxPages)) {
    const pages = document.numPages;
    await document.destroy();
    throw new Error(`This document has ${pages} pages. PDFora currently supports ${PRODUCT.minPages}–${PRODUCT.maxPages} pages.`);
  }
  return document;
}

/** Render a page into a visible canvas (CSS size = viewport size). */
export async function renderPage(pdfDocument, pageNumber, scale, canvas) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser couldn't create a PDF canvas.");
  const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const maxPixels = 24_000_000;
  const ratio = Math.min(pixelRatio, Math.sqrt(maxPixels / (viewport.width * viewport.height)));
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  if (canvas.pdforaTask) canvas.pdforaTask.cancel();
  const task = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0], annotationMode: 1 });
  canvas.pdforaTask = task;
  try {
    await task.promise;
  } finally {
    if (canvas.pdforaTask === task) canvas.pdforaTask = null;
  }
  return { width: viewport.width, height: viewport.height, transform: viewport.transform, rotation: page.rotate, scale };
}

/** Render a page into an offscreen canvas at a given scale. */
export async function renderPageCanvas(pdfDocument, pageNumber, scale, { background = "#ffffff" } = {}) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: !background, willReadFrequently: true });
  if (!context) throw new Error("This browser couldn't create an image canvas.");
  if (background) { context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height); }
  await page.render({ canvasContext: context, viewport, background: background || "rgba(0,0,0,0)", annotationMode: 1 }).promise;
  return { canvas, viewport };
}

export function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
