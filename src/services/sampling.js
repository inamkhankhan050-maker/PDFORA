// Colour sampling from a rendering of the ORIGINAL page, used to match text colour and the
// background behind text that is being replaced.
import { apply } from "../engine/matrix.js";
import { renderPageCanvas } from "./pdf-service.js";

const SAMPLE_SCALE = 2;
const cache = new WeakMap();

export async function getSampler(pdfDocument, pageNumber) {
  let pages = cache.get(pdfDocument);
  if (!pages) { pages = new Map(); cache.set(pdfDocument, pages); }
  if (!pages.has(pageNumber)) {
    pages.set(pageNumber, renderPageCanvas(pdfDocument, pageNumber, SAMPLE_SCALE).then(({ canvas, viewport }) => ({
      canvas,
      context: canvas.getContext("2d", { willReadFrequently: true }),
      transform: viewport.transform,
    })));
  }
  return pages.get(pageNumber);
}

function toHex([r, g, b]) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Returns { bg, fg } hex colours for a user-space quad. */
export function sampleQuad(sampler, quad, { ring = 4 } = {}) {
  const points = quad.map(([x, y]) => apply(sampler.transform, x, y));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const width = sampler.canvas.width;
  const height = sampler.canvas.height;
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - ring);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - ring);
  const x1 = Math.min(width, Math.ceil(Math.max(...xs)) + ring);
  const y1 = Math.min(height, Math.ceil(Math.max(...ys)) + ring);
  if (x1 <= x0 || y1 <= y0) return { bg: "#ffffff", fg: "#000000" };
  const data = sampler.context.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const w = x1 - x0;
  const buckets = new Map();
  const inner = [];
  for (let y = 0; y < y1 - y0; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const offset = (y * w + x) * 4;
      const pixel = [data[offset], data[offset + 1], data[offset + 2]];
      const onRing = x < ring || y < ring || x >= w - ring || y >= y1 - y0 - ring;
      if (onRing) {
        const key = pixel.map((value) => value >> 3).join(",");
        const bucket = buckets.get(key) || { count: 0, sum: [0, 0, 0] };
        bucket.count += 1;
        bucket.sum = bucket.sum.map((value, index) => value + pixel[index]);
        buckets.set(key, bucket);
      } else {
        inner.push(pixel);
      }
    }
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.count > best.count) best = bucket;
  const bg = best ? best.sum.map((value) => value / best.count) : [255, 255, 255];
  const scored = inner.map((pixel) => ({ pixel, score: distance(pixel, bg) })).filter((item) => item.score > 40).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, Math.ceil(scored.length * 0.3)));
  const fg = top.length && scored.length ? top.reduce((sum, item) => sum.map((value, index) => value + item.pixel[index]), [0, 0, 0]).map((value) => value / top.length) : [0, 0, 0];
  return { bg: toHex(bg), fg: toHex(fg) };
}

/** Snapshot of a screen-space rectangle of a canvas as a data URL (for drag previews). */
export function snapshot(canvas, rect, cssWidth) {
  const ratio = canvas.width / cssWidth;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.width * ratio));
  out.height = Math.max(1, Math.round(rect.height * ratio));
  out.getContext("2d").drawImage(canvas, rect.x * ratio, rect.y * ratio, rect.width * ratio, rect.height * ratio, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
