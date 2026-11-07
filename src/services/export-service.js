import { PRODUCT } from "../config.js";
import { getJSZip } from "./libs.js";
import { renderPageCanvas } from "./pdf-service.js";

export function baseName(fileName) {
  return (fileName || "document.pdf").replace(/\.pdf$/i, "") || "document";
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadPDFBytes(bytes, fileName) {
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), fileName);
}

function canvasToBlob(canvas, format, quality = 0.95) {
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser couldn't encode this page as an image."))), mime, quality));
}

export async function renderPageImage(pdfDocument, pageNumber, format, scale = PRODUCT.exportScales.standard) {
  const page = await pdfDocument.getPage(pageNumber);
  const base = page.getViewport({ scale: 1, rotation: page.rotate });
  const safeScale = Math.min(scale, Math.sqrt(40_000_000 / (base.width * base.height)));
  const { canvas } = await renderPageCanvas(pdfDocument, pageNumber, safeScale, { background: format === "jpg" ? "#ffffff" : null });
  try {
    return await canvasToBlob(canvas, format);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** One page downloads as an image; several pages download as a ZIP of images. */
export async function exportPages(pdfDocument, pages, format, { scale, fileName, onProgress = () => {} } = {}) {
  const name = baseName(fileName);
  if (pages.length === 1) {
    onProgress(0, 1);
    const blob = await renderPageImage(pdfDocument, pages[0], format, scale);
    onProgress(1, 1);
    downloadBlob(blob, `${name}-page-${pages[0]}.${format}`);
    return;
  }
  const JSZip = await getJSZip();
  const zip = new JSZip();
  for (const [index, pageNumber] of pages.entries()) {
    onProgress(index, pages.length);
    zip.file(`${name}-page-${String(pageNumber).padStart(2, "0")}.${format}`, await renderPageImage(pdfDocument, pageNumber, format, scale));
  }
  onProgress(pages.length, pages.length);
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${name}-${format}-pages.zip`);
}

export function printPDF(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.src = url;
  frame.addEventListener("load", () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, "_blank"); }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000);
  }, { once: true });
  document.body.append(frame);
}
