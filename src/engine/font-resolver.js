// Chooses the font used to write text: the PDF's own font when it holds every glyph, otherwise
// the closest standard font, otherwise an embedded Unicode font (Latin or Devanagari).
import { encodeWithProfile } from "./font-map.js";

const STANDARD = {
  sans: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"],
  serif: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"],
  mono: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"],
};

export const STANDARD_LABELS = { sans: "Helvetica", serif: "Times", mono: "Courier" };

export function standardFontName(family = "sans", bold = false, italic = false) {
  const list = STANDARD[family] || STANDARD.sans;
  return list[(bold ? 1 : 0) + (italic ? 2 : 0)];
}

export function detectScript(text) {
  return /[\u0900-\u097F\uA8E0-\uA8FF]/.test(text) ? "devanagari" : "latin";
}

export class FontResolver {
  constructor(PDFLib, fontkit, pdfDoc, loadFontBytes, createShaper) {
    this.createShaper = createShaper;
    this.PDFLib = PDFLib;
    this.pdfDoc = pdfDoc;
    this.loadFontBytes = loadFontBytes;
    this.fontkit = fontkit;
    this.cache = new Map();
    if (fontkit) pdfDoc.registerFontkit(fontkit);
  }

  async standard(name) {
    if (!this.cache.has(name)) this.cache.set(name, this.pdfDoc.embedFont(this.PDFLib.StandardFonts[name]));
    return this.cache.get(name);
  }

  async unicode(script) {
    const key = `unicode-${script}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, (async () => {
        if (!this.fontkit || !this.loadFontBytes) throw new Error("Unicode fonts are unavailable.");
        const bytes = await this.loadFontBytes(script);
        const font = await this.pdfDoc.embedFont(bytes, { subset: false });
        if (this.createShaper) {
          try { font.pdforaShaper = await this.createShaper(bytes); } catch { font.pdforaShaper = null; }
        }
        return font;
      })());
    }
    return this.cache.get(key);
  }

  static canEncode(font, text) {
    const missing = [];
    for (const character of new Set([...text])) {
      if (/\s/.test(character)) continue;
      try { font.encodeText(character); } catch { missing.push(character); }
    }
    if (!missing.length) {
      try { font.encodeText(text); } catch { missing.push(text); }
    }
    return missing;
  }

  /**
   * spec: { mode: "original", resourceKey } | { mode: "standard", family, bold, italic } | { mode: "unicode" }
   * Returns { kind: "profile"|"font", profile?, font?, label, fallback: string|null }.
   */
  async resolve(spec, text, profiles = []) {
    const script = detectScript(text);
    let fallback = null;
    let style = { family: spec.family || "sans", bold: !!spec.bold, italic: !!spec.italic };
    if (spec.mode === "original") {
      const profile = profiles.find((item) => item.uid === spec.resourceKey);
      if (profile) {
        style = { ...profile.style };
        if (profile.usable) {
          const { missing } = encodeWithProfile(profile, text);
          if (!missing.length) return { kind: "profile", profile, label: profile.displayName, fallback: null };
          fallback = `“${profile.displayName}” in this PDF only contains the letters it already uses; ${[...new Set(missing)].slice(0, 6).join(" ")} not available.`;
        } else {
          fallback = `“${profile.displayName}” can't be reused for new letters in this PDF.`;
        }
      } else {
        fallback = "The original font couldn't be identified.";
      }
    }
    if (spec.mode !== "unicode" && script === "latin") {
      const name = standardFontName(style.family, style.bold, style.italic);
      const font = await this.standard(name);
      const missing = FontResolver.canEncode(font, text.replace(/\n/g, ""));
      if (!missing.length) return { kind: "font", font, label: name.replace(/([a-z])([A-Z])/g, "$1 $2"), fallback };
      fallback = fallback || `${name} has no glyphs for ${missing.slice(0, 6).join(" ")}.`;
    }
    const font = await this.unicode(script);
    return { kind: "font", font, label: script === "devanagari" ? "Noto Sans Devanagari" : "Noto Sans", fallback };
  }

  static encode(resolved, text) {
    if (resolved.kind === "profile") return encodeWithProfile(resolved.profile, text);
    if (!text) return { segments: [], width: 0, missing: [] };
    const shaper = resolved.font.pdforaShaper;
    if (shaper) {
      // Complex scripts: glyphs and positions come from HarfBuzz; pdf-lib still records the
      // text for the font's ToUnicode map so the result stays searchable where possible.
      try { resolved.font.encodeText(text); } catch { /* ToUnicode is best effort */ }
      const { glyphs, upem } = shaper.shape(text);
      let x = 0;
      const positioned = glyphs.map((glyph) => {
        const item = { hex: glyph.g.toString(16).padStart(4, "0"), x: (x + glyph.dx) / upem, y: glyph.dy / upem };
        x += glyph.ax;
        return item;
      });
      return { segments: [{ positioned }], width: x / upem, missing: [] };
    }
    const hex = resolved.font.encodeText(text).toString().replace(/^<|>$/g, "");
    const width = resolved.font.widthOfTextAtSize(text, 1);
    return { segments: [{ hex, width }], width, missing: [] };
  }
}
