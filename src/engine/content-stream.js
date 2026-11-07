// Minimal, byte-faithful PDF content-stream tokenizer. It records every operator with the byte
// range it occupies so edits can splice the original stream without re-serialising untouched
// content.
import { IDENTITY, multiply } from "./matrix.js";

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function bytesToBinaryString(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    result += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
  }
  return result;
}

export function binaryStringToBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

function isRegular(code) {
  return !WHITESPACE.has(code) && !DELIMITERS.has(code);
}

/**
 * Tokenize a content stream (binary string). Returns operators:
 * { op, operands: [{ type, value, raw }], start, end } where start is the first operand byte.
 */
export function tokenize(text) {
  const ops = [];
  let operands = [];
  let operandStart = -1;
  let index = 0;
  const length = text.length;
  const code = (position) => text.charCodeAt(position);

  const pushOperand = (operand, start) => {
    if (operandStart < 0) operandStart = start;
    operands.push(operand);
  };

  const readString = (start) => {
    let depth = 0;
    let position = start;
    while (position < length) {
      const character = code(position);
      if (character === 0x5c) { position += 2; continue; }
      if (character === 0x28) depth += 1;
      if (character === 0x29) { depth -= 1; if (depth === 0) return position + 1; }
      position += 1;
    }
    return length;
  };

  const readValue = (start) => {
    const character = code(start);
    if (character === 0x28) {
      const end = readString(start);
      return { type: "string", raw: text.slice(start, end), end };
    }
    if (character === 0x3c && code(start + 1) === 0x3c) {
      let depth = 0;
      let position = start;
      while (position < length) {
        if (code(position) === 0x28) { position = readString(position); continue; }
        if (code(position) === 0x3c && code(position + 1) === 0x3c) { depth += 1; position += 2; continue; }
        if (code(position) === 0x3e && code(position + 1) === 0x3e) { depth -= 1; position += 2; if (depth === 0) break; continue; }
        position += 1;
      }
      return { type: "dict", raw: text.slice(start, position), end: position };
    }
    if (character === 0x3c) {
      const end = text.indexOf(">", start);
      const stop = end < 0 ? length : end + 1;
      return { type: "hex", raw: text.slice(start, stop), end: stop };
    }
    if (character === 0x5b) {
      const items = [];
      let position = start + 1;
      while (position < length) {
        const current = code(position);
        if (WHITESPACE.has(current)) { position += 1; continue; }
        if (current === 0x25) { while (position < length && code(position) !== 0x0a && code(position) !== 0x0d) position += 1; continue; }
        if (current === 0x5d) { position += 1; break; }
        const item = readValue(position);
        items.push(item);
        position = Math.max(item.end, position + 1);
      }
      return { type: "array", raw: text.slice(start, position), items, end: position };
    }
    if (character === 0x2f) {
      let position = start + 1;
      while (position < length && isRegular(code(position))) position += 1;
      return { type: "name", raw: text.slice(start, position), value: text.slice(start + 1, position), end: position };
    }
    let position = start;
    while (position < length && isRegular(code(position))) position += 1;
    if (position === start) position += 1; // stray delimiter such as ')' or '>'
    const raw = text.slice(start, position);
    const number = Number(raw);
    if (raw !== "" && Number.isFinite(number) && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw)) return { type: "number", raw, value: number, end: position };
    if (raw === "true" || raw === "false") return { type: "bool", raw, value: raw === "true", end: position };
    if (raw === "null") return { type: "null", raw, value: null, end: position };
    return { type: "operator", raw, end: position };
  };

  while (index < length) {
    const character = code(index);
    if (WHITESPACE.has(character)) { index += 1; continue; }
    if (character === 0x25) { while (index < length && code(index) !== 0x0a && code(index) !== 0x0d) index += 1; continue; }
    const start = index;
    const token = readValue(index);
    index = Math.max(token.end, index + 1);
    if (token.type !== "operator") { pushOperand(token, start); continue; }
    const opStart = operandStart < 0 ? start : operandStart;
    if (token.raw === "BI") {
      // Inline image: skip the binary payload up to a whitespace-delimited EI.
      const idMatch = /\sID[\s]/g;
      idMatch.lastIndex = index;
      const idResult = idMatch.exec(text);
      let end = length;
      if (idResult) {
        let search = idResult.index + idResult[0].length;
        while (search < length) {
          const found = text.indexOf("EI", search);
          if (found < 0) break;
          const before = code(found - 1);
          const after = found + 2 >= length ? 0x20 : code(found + 2);
          if (WHITESPACE.has(before) && (WHITESPACE.has(after) || DELIMITERS.has(after))) { end = found + 2; break; }
          search = found + 2;
        }
      }
      ops.push({ op: "BI", operands: [], start: opStart, end });
      index = end;
    } else {
      ops.push({ op: token.raw, operands, start: opStart, end: token.end });
    }
    operands = [];
    operandStart = -1;
  }
  return ops;
}

/** Walk ops tracking the CTM; report each XObject paint (Do) and inline image with its CTM. */
export function findPaintOperations(ops) {
  const stack = [];
  let ctm = IDENTITY;
  const paints = [];
  let doIndex = 0;
  let inlineIndex = 0;
  for (const operation of ops) {
    switch (operation.op) {
      case "q": stack.push(ctm); break;
      case "Q": ctm = stack.pop() || IDENTITY; break;
      case "cm": {
        const values = operation.operands.map((operand) => operand.value);
        if (values.length === 6 && values.every(Number.isFinite)) ctm = multiply(values, ctm);
        break;
      }
      case "Do": {
        const name = operation.operands[0];
        if (name?.type === "name") paints.push({ kind: "xobject", id: `x${doIndex}`, name: name.value, ctm, start: operation.start, end: operation.end });
        doIndex += 1;
        break;
      }
      case "BI": paints.push({ kind: "inline", id: `i${inlineIndex}`, name: null, ctm, start: operation.start, end: operation.end }); inlineIndex += 1; break;
      default: break;
    }
  }
  return paints;
}
