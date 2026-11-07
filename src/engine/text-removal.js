// Real text removal: walks the page content stream with full text state and rewrites every
// text-showing operator so glyphs whose centre falls inside a removal quad are dropped from the
// file (not just painted over). Removed glyphs become TJ kerning so the remaining glyphs keep
// their exact positions.
import { IDENTITY, multiply, apply, pointInQuad } from "./matrix.js";

function decodeLiteral(raw) {
  const body = raw.slice(1, -1);
  const out = [];
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== "\\") { out.push(body.charCodeAt(i) & 0xff); continue; }
    i += 1;
    const n = body[i];
    if (n === undefined) break;
    const map = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (n in map) { out.push(map[n]); continue; }
    if (n === "\r") { if (body[i + 1] === "\n") i += 1; continue; }
    if (n === "\n") continue;
    if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] || "")) { i += 1; oct += body[i]; }
      out.push(parseInt(oct, 8) & 0xff);
      continue;
    }
    out.push(n.charCodeAt(0) & 0xff);
  }
  return out;
}

function decodeHex(raw) {
  let hex = raw.slice(1, -1).replace(/[^0-9a-fA-F]/g, "");
  if (hex.length % 2) hex += "0";
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

const toHex = (bytes) => `<${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}>`;
const num = (value) => (Math.abs(value) < 1e-6 ? "0" : String(Math.round(value * 1000) / 1000));

/**
 * @param {Array} ops tokenized operations of the page content
 * @param {Array} profiles font profiles from analyzePage (resourceName, codeBytes, widths)
 * @param {Array<Array<[number,number]>>} quads removal quads in page user space
 * @returns {{splices: Array<{start:number,end:number,text:string}>, removed:number}}
 */
export function planTextRemoval(ops, profiles, quads, widthOfCode) {
  if (!quads.length) return { splices: [], removed: 0 };
  const byName = new Map(profiles.filter((p) => p.resourceName).map((p) => [p.resourceName, p]));
  const splices = [];
  let removed = 0;
  const stack = [];
  let ctm = IDENTITY;
  let ts = { font: null, size: 0, Tc: 0, Tw: 0, Tz: 1, TL: 0, Ts: 0 };
  let tm = IDENTITY;
  let tlm = IDENTITY;
  const values = (op) => op.operands.map((o) => o.value);
  const nextLine = (tx, ty) => { tlm = multiply([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };

  const showItems = (items, op, prefixText = "") => {
    const profile = byName.get(ts.font);
    if (!profile || !ts.size) return;
    const bytesPerCode = profile.codeBytes || 1;
    const hScale = ts.Tz;
    const out = [];
    let changed = false;
    let pendingGap = 0; // in thousandths of text space (TJ units, positive = move left)
    let run = [];
    const flushRun = () => { if (run.length) { out.push(toHex(run)); run = []; } };
    for (const item of items) {
      if (item.type === "number") {
        const adj = item.value;
        tm = multiply([1, 0, 0, 1, (-adj / 1000) * ts.size * hScale, 0], tm);
        pendingGap += adj;
        continue;
      }
      if (item.type !== "string" && item.type !== "hex") continue;
      const bytes = item.type === "hex" ? decodeHex(item.raw) : decodeLiteral(item.raw);
      for (let i = 0; i + bytesPerCode <= bytes.length; i += bytesPerCode) {
        const codeBytes = bytes.slice(i, i + bytesPerCode);
        const code = codeBytes.reduce((acc, b) => acc * 256 + b, 0);
        const w0 = widthOfCode(profile, code) / 1000;
        const isSpace = bytesPerCode === 1 && code === 32;
        const advance = (w0 * ts.size + ts.Tc + (isSpace ? ts.Tw : 0)) * hScale;
        const trm = multiply(multiply([ts.size * hScale, 0, 0, ts.size, 0, ts.Ts], tm), ctm);
        const centre = apply(trm, Math.max(w0, 0.2) / 2, 0.3);
        const hit = quads.some((quad) => pointInQuad(centre, quad));
        if (hit) {
          changed = true;
          removed += 1;
          flushRun();
          pendingGap -= (advance / hScale / ts.size) * 1000;
        } else {
          if (pendingGap) { flushRun(); out.push(num(pendingGap)); pendingGap = 0; }
          run.push(...codeBytes);
        }
        tm = multiply([1, 0, 0, 1, advance, 0], tm);
      }
    }
    flushRun();
    if (pendingGap) out.push(num(pendingGap));
    if (!changed) return;
    splices.push({ start: op.start, end: op.end, text: `${prefixText}[${out.join(" ")}] TJ` });
  };

  for (const op of ops) {
    switch (op.op) {
      case "q": stack.push({ ctm, ts: { ...ts } }); break;
      case "Q": { const s = stack.pop(); if (s) { ctm = s.ctm; ts = s.ts; } break; }
      case "cm": { const v = values(op); if (v.length === 6 && v.every(Number.isFinite)) ctm = multiply(v, ctm); break; }
      case "BT": tm = IDENTITY; tlm = IDENTITY; break;
      case "Tf": { const [name, size] = op.operands; ts.font = name?.value ?? null; ts.size = size?.value || 0; break; }
      case "Tc": ts.Tc = values(op)[0] || 0; break;
      case "Tw": ts.Tw = values(op)[0] || 0; break;
      case "Tz": ts.Tz = (values(op)[0] ?? 100) / 100; break;
      case "TL": ts.TL = values(op)[0] || 0; break;
      case "Ts": ts.Ts = values(op)[0] || 0; break;
      case "Td": { const [x, y] = values(op); nextLine(x || 0, y || 0); break; }
      case "TD": { const [x, y] = values(op); ts.TL = -(y || 0); nextLine(x || 0, y || 0); break; }
      case "Tm": { const v = values(op); if (v.length === 6) { tlm = v; tm = v; } break; }
      case "T*": nextLine(0, -ts.TL); break;
      case "Tj": showItems([op.operands[0]].filter(Boolean), op); break;
      case "TJ": showItems(op.operands[0]?.items || [], op); break;
      case "'": nextLine(0, -ts.TL); showItems([op.operands[0]].filter(Boolean), op, "T* "); break;
      case '"': {
        const [aw, ac, str] = op.operands;
        ts.Tw = aw?.value || 0; ts.Tc = ac?.value || 0; nextLine(0, -ts.TL);
        showItems([str].filter(Boolean), op, `${num(ts.Tw)} Tw ${num(ts.Tc)} Tc T* `);
        break;
      }
      default: break;
    }
  }
  return { splices, removed };
}
