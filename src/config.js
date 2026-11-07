export const PRODUCT = Object.freeze({
  name: "PDFora",
  tagline: "Edit Anything. Perfect Every Page.",
  maxFileBytes: 50 * 1024 * 1024,
  maxPages: 10,
  minPages: 1,
  maxImageBytes: 25 * 1024 * 1024,
  exportScales: Object.freeze({ standard: 2, high: 4 }),
});

export const PDFJS_VERSION = "4.10.38";

export const LIBRARY_URLS = Object.freeze({
  pdfjs: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`,
  pdfjsWorker: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`,
  pdfLib: "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm",
  fontkit: "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm",
  regenerator: "https://cdn.jsdelivr.net/npm/regenerator-runtime@0.14.1/runtime.js",
  harfbuzz: "https://cdn.jsdelivr.net/npm/harfbuzzjs@0.4.7/hb.js",
  harfbuzzApi: "https://cdn.jsdelivr.net/npm/harfbuzzjs@0.4.7/hbjs.js",
  harfbuzzWasm: "https://cdn.jsdelivr.net/npm/harfbuzzjs@0.4.7/hb.wasm",
  notoSans: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
  notoDevanagari: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf",
  jszip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm",
});
