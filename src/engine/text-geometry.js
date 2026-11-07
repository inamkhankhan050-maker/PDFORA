// Character-level geometry of a PDF.js text run, measured with the run's own font widths.
import { measureWithProfile } from "./font-map.js";
import { apply, multiply, translate } from "./matrix.js";

function approximateWidth(character) {
  if (/\s/.test(character)) return 0.28;
  if (/[il.,:;'!|ìíïj`]/.test(character)) return 0.27;
  if (/[mwMW@]/.test(character)) return 0.85;
  if (/[A-Z]/.test(character)) return 0.66;
  if (/[0-9]/.test(character)) return 0.55;
  if (/[\u0900-\u097F]/.test(character)) return /[\u093E-\u094D\u0900-\u0903]/.test(character) ? 0.12 : 0.62;
  return 0.5;
}

function approximateMeasure(text) {
  return [...text].reduce((sum, character) => sum + approximateWidth(character), 0);
}

export class TextRun {
  /** item: PDF.js text item; profile: matching font profile or null; metrics: {ascent, descent} */
  constructor(item, profile, metrics = {}) {
    this.item = item;
    this.str = item.str;
    this.matrix = item.transform;
    this.scale = Math.hypot(item.transform[0], item.transform[1]) || 1;
    this.profile = profile && profile.usable && !measureMissing(profile, item.str) ? profile : null;
    this.totalUnits = item.width / this.scale;
    const measured = this.measureRaw(item.str);
    this.ratio = measured > 0 && this.totalUnits > 0 ? this.totalUnits / measured : 1;
    if (!(this.totalUnits > 0)) this.totalUnits = measured;
    this.ascent = profile?.ascent || metrics.ascent || 0.9;
    this.descent = profile?.descent || metrics.descent || -0.22;
    if (this.ascent > 1.15 || this.ascent < 0.5) this.ascent = 0.9;
    if (this.descent < -0.6 || this.descent > -0.05) this.descent = -0.22;
  }

  measureRaw(text) {
    return this.profile ? measureWithProfile(this.profile, text) : approximateMeasure(text);
  }

  /** Offset in text-space units (1pt font) of character index `index` (UTF-16 index). */
  offset(index) {
    return this.measureRaw(this.str.slice(0, index)) * this.ratio;
  }

  /** Page-space quad covering text-space x range [x0, x1]. */
  quad(x0, x1, pad = 0.03) {
    const y0 = this.descent - pad;
    const y1 = this.ascent + pad * 0.5;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => apply(this.matrix, x, y));
  }

  /** Character index nearest to text-space x. */
  indexAt(units) {
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index <= this.str.length; index += 1) {
      const distance = Math.abs(this.offset(index) - units);
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    }
    return best;
  }

  /** Word range [start, end) around character index. */
  wordAt(index) {
    const words = [...this.str.matchAll(/\S+/g)];
    const word = words.find((match) => index >= match.index && index <= match.index + match[0].length) || words.find((match) => match.index >= index) || words[words.length - 1];
    return word ? { start: word.index, end: word.index + word[0].length } : { start: 0, end: this.str.length };
  }

  /** Text matrix for redrawn text starting at character `keep`, optionally re-sized. */
  originFrom(keep, sizeRatio = 1) {
    return multiply([sizeRatio, 0, 0, sizeRatio, 0, 0], multiply(translate(this.offset(keep) / sizeRatio, 0), this.matrix));
  }
}

function measureMissing(profile, text) {
  try {
    const characters = [...text].filter((character) => !/\s/.test(character));
    return characters.some((character) => ![...profile.unicodeToCode.keys()].some((key) => key.includes(character)));
  } catch {
    return true;
  }
}

/**
 * Build an engine text edit that rewrites a run from character `keep` onwards with `text`.
 * Everything before `keep` stays untouched in the original content stream.
 */
export function buildRunEdit({ id, page, run, keep, text, style }) {
  const sizeRatio = style.size && style.originalSize ? style.size / style.originalSize : 1;
  const startUnits = run.offset(keep);
  const mask = run.quad(Math.max(0, startUnits - 0.015), run.totalUnits + 0.04);
  return {
    id,
    type: "text",
    page,
    mask,
    bg: style.bg,
    origin: run.originFrom(keep, sizeRatio),
    text,
    font: style.font,
    color: style.color,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    opacity: style.opacity,
  };
}
