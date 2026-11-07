// Reads a page's font resources so new text can be written with the very font the PDF already
// uses: Unicode -> character code (via ToUnicode / Encoding), glyph widths and vertical metrics.
import { bytesToBinaryString } from "./content-stream.js";

const WIN_ANSI_EXTRA = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

const GLYPH_NAMES = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'",
  quoteright: "’", quoteleft: "‘", parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-",
  minus: "−", period: ".", slash: "/", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?",
  at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_", grave: "`",
  braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", bullet: "•", endash: "–", emdash: "—", quotedblleft: "“",
  quotedblright: "”", ellipsis: "…", rupee: "₹", Euro: "€", copyright: "©", registered: "®", degree: "°", nbspace: " ",
  fi: "ﬁ", fl: "ﬂ",
};

function glyphNameToUnicode(name) {
  if (/^[A-Za-z]$/.test(name)) return name;
  if (GLYPH_NAMES[name]) return GLYPH_NAMES[name];
  const uni = /^uni([0-9A-Fa-f]{4,})$/.exec(name);
  if (uni) return String.fromCodePoint(Number.parseInt(uni[1].slice(0, 4), 16));
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (u) return String.fromCodePoint(Number.parseInt(u[1], 16));
  return null;
}

function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, "");
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const bytes = [];
  for (let index = 0; index < padded.length; index += 2) bytes.push(Number.parseInt(padded.slice(index, index + 2), 16));
  return bytes;
}

function utf16beHexToString(hex) {
  const bytes = hexToBytes(hex);
  const units = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) units.push((bytes[index] << 8) | bytes[index + 1]);
  if (bytes.length % 2) units.push(bytes[bytes.length - 1]);
  return String.fromCharCode(...units);
}

function bytesToNumber(bytes) {
  return bytes.reduce((value, byte) => value * 256 + byte, 0);
}

/** Parse a ToUnicode CMap. Returns { codeToUnicode: Map<number,string>, codeBytes }. */
export function parseToUnicode(text) {
  const codeToUnicode = new Map();
  let codeBytes = 1;
  const rangeRe = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  for (const match of text.matchAll(rangeRe)) {
    const first = /<([0-9A-Fa-f]+)>/.exec(match[1]);
    if (first) codeBytes = Math.max(1, Math.round(first[1].length / 2));
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      const src = hexToBytes(entry[1]);
      codeBytes = Math.max(codeBytes, src.length);
      codeToUnicode.set(bytesToNumber(src), utf16beHexToString(entry[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1];
    const entryRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g;
    for (const entry of body.matchAll(entryRe)) {
      const lowBytes = hexToBytes(entry[1]);
      codeBytes = Math.max(codeBytes, lowBytes.length);
      const low = bytesToNumber(lowBytes);
      const high = bytesToNumber(hexToBytes(entry[2]));
      if (high - low > 65535) continue;
      if (entry[3].startsWith("[")) {
        const targets = [...entry[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((target) => utf16beHexToString(target[1]));
        targets.forEach((target, offset) => codeToUnicode.set(low + offset, target));
      } else {
        const base = hexToBytes(entry[3].slice(1, -1));
        for (let code = low; code <= high; code += 1) {
          const bytes = base.slice();
          let carry = code - low;
          for (let position = bytes.length - 1; position >= 0 && carry > 0; position -= 1) {
            const sum = bytes[position] + carry;
            bytes[position] = sum & 0xff;
            carry = sum >> 8;
          }
          const units = [];
          for (let index = 0; index + 1 < bytes.length; index += 2) units.push((bytes[index] << 8) | bytes[index + 1]);
          codeToUnicode.set(code, String.fromCharCode(...units));
        }
      }
    }
  }
  return { codeToUnicode, codeBytes };
}

export function cleanFontName(baseFont) {
  return String(baseFont || "").replace(/^\/?[A-Z]{6}\+/, "").replace(/^\//, "");
}

export function normaliseFontKey(name) {
  return cleanFontName(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function describeFontStyle(name) {
  const lower = cleanFontName(name).toLowerCase();
  const bold = /bold|black|heavy|semibold|demi|,bd|-bd/.test(lower);
  const italic = /italic|oblique|,it|-it\b/.test(lower);
  let family = "sans";
  if (/times|serif|roman|georgia|garamond|cambria|book|minion|palatino|baskerville|caslon|tinos|liberationserif|nimbusrom/.test(lower) && !/sans/.test(lower)) family = "serif";
  if (/courier|mono|consol|menlo|code|typewriter/.test(lower)) family = "mono";
  return { family, bold, italic };
}

const STANDARD_ALIASES = [
  [/^(helvetica|arial|arialmt|liberationsans|nimbussans)/, "Helvetica"],
  [/^(times|timesnewroman|liberationserif|nimbusroman)/, "Times-Roman"],
  [/^(courier|couriernew|liberationmono|nimbusmono)/, "Courier"],
];

export function standardFontFor(name) {
  const lower = name.toLowerCase().replace(/[^a-z,-]/g, "");
  const compact = lower.replace(/[-,]/g, "");
  if (/^symbol/.test(compact)) return "Symbol";
  if (/^zapfdingbats/.test(compact)) return "ZapfDingbats";
  const family = STANDARD_ALIASES.find(([pattern]) => pattern.test(compact))?.[1];
  if (!family) return null;
  const bold = /bold|black|heavy/.test(compact);
  const italic = /italic|oblique/.test(compact);
  if (family === "Times-Roman") return bold && italic ? "Times-BoldItalic" : bold ? "Times-Bold" : italic ? "Times-Italic" : "Times-Roman";
  const suffix = bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : "";
  return `${family}${suffix}`;
}

/** Build a font profile from a pdf-lib font dictionary. */
export function readFontProfile(PDFLib, context, fontDict, resourceName, fontRef) {
  const { PDFName, PDFArray, PDFNumber, PDFDict, PDFRawStream, decodePDFRawStream } = PDFLib;
  const lookup = (dict, key) => (dict ? dict.lookup(PDFName.of(key)) : undefined);
  const numberOf = (object) => (object instanceof PDFNumber ? object.asNumber() : undefined);
  const nameOf = (object) => (object instanceof PDFName ? object.decodeText?.() ?? object.asString().slice(1) : undefined);

  const subtype = nameOf(lookup(fontDict, "Subtype")) || "Unknown";
  const baseFont = nameOf(lookup(fontDict, "BaseFont")) || resourceName;
  const isType0 = subtype === "Type0";
  const profile = {
    resourceName,
    ref: fontRef,
    baseFont,
    displayName: cleanFontName(baseFont),
    key: normaliseFontKey(baseFont),
    subtype,
    codeBytes: isType0 ? 2 : 1,
    unicodeToCode: new Map(),
    widths: new Map(),
    defaultWidth: isType0 ? 1000 : 0,
    ascent: 0.9,
    descent: -0.22,
    embedded: false,
    usable: subtype !== "Type3",
    style: describeFontStyle(baseFont),
  };

  let descriptorFont = fontDict;
  if (isType0) {
    const descendants = lookup(fontDict, "DescendantFonts");
    const descendant = descendants instanceof PDFArray ? descendants.lookup(0) : undefined;
    if (descendant instanceof PDFDict) {
      descriptorFont = descendant;
      const dw = numberOf(lookup(descendant, "DW"));
      if (dw !== undefined) profile.defaultWidth = dw;
      const w = lookup(descendant, "W");
      if (w instanceof PDFArray) {
        const items = w.asArray().map((item) => context.lookup(item));
        for (let index = 0; index < items.length;) {
          const first = numberOf(items[index]);
          const next = items[index + 1];
          if (next instanceof PDFArray) {
            next.asArray().forEach((width, offset) => profile.widths.set(first + offset, numberOf(context.lookup(width)) ?? profile.defaultWidth));
            index += 2;
          } else {
            const last = numberOf(next);
            const width = numberOf(items[index + 2]);
            if (first === undefined || last === undefined || width === undefined) break;
            for (let cid = first; cid <= last && cid - first < 65536; cid += 1) profile.widths.set(cid, width);
            index += 3;
          }
        }
      }
      const encoding = nameOf(lookup(fontDict, "Encoding"));
      if (encoding && !/Identity/.test(encoding)) profile.usable = false; // predefined CJK CMaps: not mapped here
    } else {
      profile.usable = false;
    }
  } else {
    const firstChar = numberOf(lookup(fontDict, "FirstChar")) ?? 0;
    const widths = lookup(fontDict, "Widths");
    if (widths instanceof PDFArray) {
      widths.asArray().forEach((width, offset) => profile.widths.set(firstChar + offset, numberOf(context.lookup(width)) ?? 0));
    }
  }

  const descriptor = lookup(descriptorFont, "FontDescriptor");
  if (descriptor instanceof PDFDict) {
    const ascent = numberOf(lookup(descriptor, "Ascent"));
    const descent = numberOf(lookup(descriptor, "Descent"));
    if (ascent) profile.ascent = Math.min(1.2, Math.max(0.5, ascent / 1000));
    if (descent) profile.descent = Math.max(-0.6, Math.min(-0.05, descent / 1000));
    const missing = numberOf(lookup(descriptor, "MissingWidth"));
    if (missing !== undefined && !isType0) profile.defaultWidth = missing;
    profile.embedded = ["FontFile", "FontFile2", "FontFile3"].some((key) => lookup(descriptor, key));
    const flags = numberOf(lookup(descriptor, "Flags")) ?? 0;
    if (flags & (1 << 6)) profile.style.italic = true;
    if (flags & (1 << 18)) profile.style.bold = true;
    if (flags & (1 << 1)) profile.style.family = profile.style.family === "mono" ? "mono" : "serif";
    if (flags & 1) profile.style.family = "mono";
  }

  // Unicode -> code: ToUnicode first, then simple-font encodings.
  const toUnicode = lookup(fontDict, "ToUnicode");
  if (toUnicode instanceof PDFRawStream) {
    try {
      const text = bytesToBinaryString(decodePDFRawStream(toUnicode).decode());
      const parsed = parseToUnicode(text);
      if (!isType0) profile.codeBytes = 1;
      for (const [code, unicode] of parsed.codeToUnicode) {
        if (!unicode) continue;
        if (!isType0 && profile.widths.size && !(profile.widths.get(code) > 0) && profile.embedded) continue;
        if (!profile.unicodeToCode.has(unicode)) profile.unicodeToCode.set(unicode, code);
      }
    } catch {
      // A broken ToUnicode stream falls through to encoding-based mapping.
    }
  }
  if (!isType0) {
    const encoding = lookup(fontDict, "Encoding");
    const codeToUnicode = new Map();
    const baseName = encoding instanceof PDFName ? nameOf(encoding) : encoding instanceof PDFDict ? nameOf(lookup(encoding, "BaseEncoding")) : undefined;
    const symbolic = /Symbol|Dingbats/i.test(baseFont);
    if (!symbolic) {
      for (let code = 32; code < 127; code += 1) codeToUnicode.set(code, String.fromCharCode(code));
      if (baseName !== "MacRomanEncoding") {
        for (let code = 0xa0; code <= 0xff; code += 1) codeToUnicode.set(code, String.fromCharCode(code));
        for (const [code, unicode] of Object.entries(WIN_ANSI_EXTRA)) codeToUnicode.set(Number(code), unicode);
      }
      if (baseName === "StandardEncoding") { codeToUnicode.set(0x27, "’"); codeToUnicode.set(0x60, "‘"); }
    }
    if (encoding instanceof PDFDict) {
      const differences = lookup(encoding, "Differences");
      if (differences instanceof PDFArray) {
        let code = 0;
        for (const item of differences.asArray()) {
          const value = context.lookup(item);
          if (value instanceof PDFNumber) { code = value.asNumber(); continue; }
          if (value instanceof PDFName) {
            const unicode = glyphNameToUnicode(nameOf(value));
            if (unicode) codeToUnicode.set(code, unicode); else codeToUnicode.delete(code);
            code += 1;
          }
        }
      }
    }
    const hasWidths = profile.widths.size > 0;
    for (const [code, unicode] of codeToUnicode) {
      if (profile.unicodeToCode.has(unicode)) continue;
      // In an embedded subset, a zero/missing width means the glyph was not included.
      if (hasWidths && profile.embedded && !(profile.widths.get(code) > 0)) continue;
      profile.unicodeToCode.set(unicode, code);
    }
  }
  if (!profile.embedded && !isType0) {
    const standardName = standardFontFor(cleanFontName(baseFont));
    if (standardName && PDFLib.StandardFontEmbedder) {
      try {
        const embedder = PDFLib.StandardFontEmbedder.for(standardName);
        for (const [unicode, code] of profile.unicodeToCode) {
          if (profile.widths.get(code) > 0) continue;
          try { profile.widths.set(code, embedder.widthOfTextAtSize(unicode, 1000)); } catch { /* not in WinAnsi */ }
        }
        profile.standardName = standardName;
      } catch {
        // Unknown standard font metrics; widths stay approximate.
      }
    }
  }
  profile.maxKeyLength = Math.max(1, ...[...profile.unicodeToCode.keys()].map((key) => key.length));
  if (!profile.unicodeToCode.size) profile.usable = false;
  return profile;
}

export function widthOfCode(profile, code) {
  const width = profile.widths.get(code);
  return width === undefined || (!width && !profile.embedded) ? profile.defaultWidth || 500 : width;
}

/**
 * Encode `text` with a font profile. Returns { segments: [{hex, width}|{gap}], width, missing }
 * where widths are in text-space units for a 1pt font. Missing spaces become TJ gaps.
 */
export function visualDevanagari(text) {
  // Fonts that were already shaped store the short-i matra (ि) before its consonant cluster.
  return text.replace(/((?:[\u0915-\u0939\u0958-\u095F]\u093C?\u094D)*[\u0915-\u0939\u0958-\u095F]\u093C?)\u093F/g, "\u093F$1");
}

export function encodeWithProfile(profile, input) {
  const text = /[\u0900-\u097F]/.test(input) ? visualDevanagari(input) : input;
  const segments = [];
  const missing = [];
  let width = 0;
  let hex = "";
  let segmentWidth = 0;
  const flush = () => { if (hex) segments.push({ hex, width: segmentWidth }); hex = ""; segmentWidth = 0; };
  const characters = [...text];
  for (let index = 0; index < characters.length;) {
    let matched = false;
    for (let span = Math.min(profile.maxKeyLength, characters.length - index); span >= 1; span -= 1) {
      const piece = characters.slice(index, index + span).join("");
      if (!profile.unicodeToCode.has(piece)) continue;
      const code = profile.unicodeToCode.get(piece);
      hex += code.toString(16).padStart(profile.codeBytes * 2, "0");
      const glyphWidth = widthOfCode(profile, code) / 1000;
      segmentWidth += glyphWidth;
      width += glyphWidth;
      index += span;
      matched = true;
      break;
    }
    if (matched) continue;
    const character = characters[index];
    if (/\s/.test(character)) {
      flush();
      const gap = 0.25;
      segments.push({ gap });
      width += gap;
    } else {
      missing.push(character);
    }
    index += 1;
  }
  flush();
  return { segments, width, missing };
}

/** Width of an original string in a profile (for locating a word inside a text run). */
export function measureWithProfile(profile, text) {
  return encodeWithProfile(profile, text).width;
}
