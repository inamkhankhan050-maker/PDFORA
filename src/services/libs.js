// Loads third-party engines from pinned CDN versions, once each.
import { LIBRARY_URLS, PDFJS_VERSION } from "../config.js";

const cache = new Map();

function once(key, factory) {
  if (!cache.has(key)) {
    cache.set(key, factory().catch((error) => { cache.delete(key); throw error; }));
  }
  return cache.get(key);
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${url}"]`);
    if (existing?.dataset.loaded) return resolve();
    const script = existing || document.createElement("script");
    script.src = url;
    script.async = true;
    script.dataset.src = url;
    script.addEventListener("load", () => { script.dataset.loaded = "1"; resolve(); }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Couldn't load ${new URL(url).hostname}. Check your internet connection.`)), { once: true });
    if (!existing) document.head.append(script);
  });
}

export function getPDFJS() {
  return once("pdfjs", async () => {
    const pdfjs = await import(LIBRARY_URLS.pdfjs).catch(() => { throw new Error("The PDF viewer couldn't load. Check your internet connection and try again."); });
    pdfjs.GlobalWorkerOptions.workerSrc = LIBRARY_URLS.pdfjsWorker;
    if (pdfjs.version && pdfjs.version !== PDFJS_VERSION) console.warn(`PDF.js ${pdfjs.version} loaded, expected ${PDFJS_VERSION}.`);
    return pdfjs;
  });
}

export function getPDFLib() {
  return once("pdf-lib", () => import(LIBRARY_URLS.pdfLib).catch(() => { throw new Error("The PDF editing engine couldn't load. Check your internet connection and try again."); }));
}

export function getFontkit() {
  return once("fontkit", async () => {
    // fontkit's Indic shaper expects a global regenerator runtime.
    if (!globalThis.regeneratorRuntime) await loadScript(LIBRARY_URLS.regenerator);
    const module = await import(LIBRARY_URLS.fontkit);
    return module.default || module;
  });
}

export function getEngineLibs() {
  return once("engine", async () => {
    const [PDFLib, fontkit] = await Promise.all([getPDFLib(), getFontkit()]);
    return { PDFLib, fontkit };
  });
}

export function getShaperFactory() {
  return once("harfbuzz", async () => {
    await loadScript(LIBRARY_URLS.harfbuzz);
    await loadScript(LIBRARY_URLS.harfbuzzApi);
    const instance = await globalThis.createHarfBuzz({ locateFile: () => LIBRARY_URLS.harfbuzzWasm });
    const hb = globalThis.hbjs(instance);
    return async (fontBytes) => {
      const blob = hb.createBlob(fontBytes);
      const face = hb.createFace(blob, 0);
      const font = hb.createFont(face);
      return {
        shape(text) {
          const buffer = hb.createBuffer();
          try {
            buffer.addText(text);
            buffer.guessSegmentProperties();
            hb.shape(font, buffer);
            return { glyphs: buffer.json(), upem: face.upem };
          } finally {
            buffer.destroy();
          }
        },
      };
    };
  });
}

export function loadFontBytes(script) {
  const url = script === "devanagari" ? LIBRARY_URLS.notoDevanagari : LIBRARY_URLS.notoSans;
  return once(`font-${script}`, async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("A Unicode font couldn't be downloaded. Check your internet connection.");
    return new Uint8Array(await response.arrayBuffer());
  });
}

export function getJSZip() {
  return once("jszip", async () => {
    const module = await import(LIBRARY_URLS.jszip);
    return module.default || module;
  });
}
