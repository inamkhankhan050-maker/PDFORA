// 2D affine matrices in PDF order [a, b, c, d, e, f]: (x, y) -> (a·x + c·y + e, b·x + d·y + f).
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** Apply `first`, then `second` (PDF row-vector convention: first × second). */
export function multiply(first, second) {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export function invert(matrix) {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function apply(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Corners of the unit square mapped through `matrix`, counter-clockwise from (0,0). */
export function unitQuad(matrix) {
  return [apply(matrix, 0, 0), apply(matrix, 1, 0), apply(matrix, 1, 1), apply(matrix, 0, 1)];
}

export function quadBounds(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function translate(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

/**
 * Placement of an object in page space: centre, size, clockwise rotation (as seen on screen
 * in an unrotated page), and flips. Returns the matrix mapping the unit square onto it.
 */
export function placementMatrix({ cx, cy, width, height, rotation = 0, flipH = false, flipV = false }) {
  const theta = (-rotation * Math.PI) / 180;
  const fx = flipH ? -1 : 1;
  const fy = flipV ? -1 : 1;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const a = width * fx * cos;
  const b = width * fx * sin;
  const c = -height * fy * sin;
  const d = height * fy * cos;
  return [a, b, c, d, cx - (a + c) / 2, cy - (b + d) / 2];
}

/** Best-effort inverse of placementMatrix (skew is dropped). */
export function decomposePlacement(matrix) {
  const [a, b, c, d] = matrix;
  const width = Math.hypot(a, b);
  const theta = Math.atan2(b, a);
  const hfy = d * Math.cos(theta) - c * Math.sin(theta);
  const [cx, cy] = apply(matrix, 0.5, 0.5);
  return {
    cx,
    cy,
    width,
    height: Math.abs(hfy),
    rotation: normaliseDegrees((-theta * 180) / Math.PI),
    flipH: false,
    flipV: hfy < 0,
  };
}

export function normaliseDegrees(value) {
  let degrees = value % 360;
  if (degrees > 180) degrees -= 360;
  if (degrees <= -180) degrees += 360;
  return Math.round(degrees * 1000) / 1000;
}

export function pointInQuad(point, quad) {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const [xi, yi] = quad[i];
    const [xj, yj] = quad[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function fmt(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function matrixOperand(matrix) {
  return matrix.map(fmt).join(" ");
}
