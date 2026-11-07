const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let tesseractPromise;

async function getTesseract() {
  if (globalThis.Tesseract?.createWorker) return globalThis.Tesseract;
  tesseractPromise ??= new Promise((resolve, reject) => {
    const script = globalThis.document.createElement("script");
    script.src = TESSERACT_URL;
    script.async = true;
    script.onload = () => globalThis.Tesseract?.createWorker
      ? resolve(globalThis.Tesseract)
      : reject(new Error("OCR loaded without its worker function. Reload the page and try again."));
    script.onerror = () => reject(new Error("OCR couldn't load. Check your internet connection and try again."));
    globalThis.document.head.append(script);
  }).catch((error) => {
    tesseractPromise = undefined;
    throw error;
  });
  return tesseractPromise;
}

function inverseTransformPoint(x, y, transform) {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  return [(d * (x - e) - c * (y - f)) / determinant, (-b * (x - e) + a * (y - f)) / determinant];
}

export async function recognizePDFPage(pdfDocument, pageNumber, languages, onProgress = () => {}) {
  const page = await pdfDocument.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const scale = Math.min(2.5, Math.sqrt(12_000_000 / (baseViewport.width * baseViewport.height)));
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser couldn't prepare the page for OCR.");

  let worker;
  try {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const { createWorker } = await getTesseract();
    const languageList = languages.split("+");
    worker = await createWorker(languageList, 1, { logger: onProgress });
    const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
    const words = result.data.words || [];
    const outputScaleX = viewport.width / canvas.width;
    const outputScaleY = viewport.height / canvas.height;

    return words
      .filter((word) => word.text?.trim() && word.bbox)
      .map((word) => {
        const { x0, y0, x1, y1 } = word.bbox;
        const points = [
          [x0 * outputScaleX, y0 * outputScaleY],
          [x1 * outputScaleX, y0 * outputScaleY],
          [x0 * outputScaleX, y1 * outputScaleY],
          [x1 * outputScaleX, y1 * outputScaleY],
        ].map(([x, y]) => inverseTransformPoint(x, y, viewport.transform));
        const xs = points.map(([x]) => x);
        const ys = points.map(([, y]) => y);
        const box = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
        return {
          text: word.text.trim(),
          confidence: Math.round(word.confidence || 0),
          box,
          size: Math.max(6, box.height),
        };
      });
  } finally {
    if (worker) await worker.terminate();
    canvas.width = 0;
    canvas.height = 0;
  }
}
