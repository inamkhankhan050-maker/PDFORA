import { PRODUCT } from "./config.js";
import { renderLanding, renderPasswordPrompt, renderRestoreCard } from "./components/landing.js";
import { renderEditorShell, renderPageThumbnails } from "./components/editor.js";
import { fontSpecToValue, renderAddedText, renderErase, renderObject, renderOverview, renderTextSelection, renderToolHint, valueToFontSpec } from "./components/properties.js";
import { getEngineLibs, getShaperFactory, loadFontBytes } from "./services/libs.js";
import { PasswordRequiredError, openPDFBytes, renderPage, renderPageCanvas, validatePDFFile } from "./services/pdf-service.js";
import { recognizePDFPage } from "./services/ocr-service.js";
import { getSampler, sampleQuad, snapshot } from "./services/sampling.js";
import { assetFromBytes, readImageFile } from "./services/image-service.js";
import { baseName, downloadPDFBytes, exportPages, printPDF } from "./services/export-service.js";
import { clearSession, loadSession, saveSession } from "./services/storage-service.js";
import { analyzePage } from "./engine/analyze.js";
import { applyEdits } from "./engine/apply-edits.js";
import { describeFontStyle, encodeWithProfile, normaliseFontKey } from "./engine/font-map.js";
import { apply, decomposePlacement, invert, normaliseDegrees, placementMatrix, pointInQuad, quadBounds, unitQuad } from "./engine/matrix.js";
import { TextRun, buildRunEdit } from "./engine/text-geometry.js";

const app = document.querySelector("#app");
const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  fileName: "",
  fileSize: 0,
  originalBytes: null,
  originalDoc: null,
  workingDoc: null,
  workingBytes: null,
  libs: null,
  editable: true,
  analysis: [],
  pageCache: new Map(),
  pageResolved: new Map(),
  capability: null,
  page: 1,
  scale: 1,
  view: null,
  tool: "select",
  edits: [],
  history: [[]],
  historyIndex: 0,
  lastCommit: null,
  assets: new Map(),
  selection: null,
  hover: null,
  drag: null,
  report: new Map(),
  ocrByPage: new Map(),
  ocrState: new Map(),
  build: { running: false, dirty: false, error: null },
  lockAspect: true,
  pendingFile: null,
  dragDepth: 0,
};

let idCounter = 0;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(idCounter += 1)}`;
const $ = (selector) => document.querySelector(selector);
const debounceTimers = new Map();
function debounce(key, fn, delay) {
  clearTimeout(debounceTimers.get(key));
  debounceTimers.set(key, setTimeout(fn, delay));
}

/* ------------------------------------------------------------------ landing */

async function showLanding(message = "") {
  if (state.originalDoc) state.originalDoc.destroy().catch(() => {});
  if (state.workingDoc && state.workingDoc !== state.originalDoc) state.workingDoc.destroy().catch(() => {});
  for (const asset of state.assets.values()) if (asset.url) URL.revokeObjectURL(asset.url);
  Object.assign(state, {
    originalDoc: null, workingDoc: null, workingBytes: null, originalBytes: null, analysis: [], pageCache: new Map(), pageResolved: new Map(), capability: null,
    edits: [], history: [[]], historyIndex: 0, assets: new Map(), selection: null, hover: null, drag: null, report: new Map(),
    ocrByPage: new Map(), ocrState: new Map(), page: 1, scale: 1, tool: "select", editable: true, pendingFile: null,
  });
  app.innerHTML = renderLanding();
  bindLanding();
  if (message) setUploadMessage(message, true);
  const session = await loadSession();
  if (session?.originalBytes && session.fileName) {
    const slot = $("#restore-slot");
    if (slot) {
      slot.innerHTML = renderRestoreCard(session);
      slot.querySelector('[data-action="restore-session"]').addEventListener("click", () => restoreSession(session));
      slot.querySelector('[data-action="discard-session"]').addEventListener("click", async () => { await clearSession(); slot.innerHTML = ""; });
    }
  }
}

function setUploadMessage(message, error = false) {
  const status = $("#upload-message");
  if (status) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }
}

function bindLanding() {
  const input = $("#pdf-file");
  document.querySelectorAll('[data-action="choose-file"]').forEach((button) => button.addEventListener("click", () => input.click()));
  input.addEventListener("change", (event) => {
    const [file] = event.currentTarget.files;
    if (file) loadFile(file);
    event.currentTarget.value = "";
  });
  const card = $(".upload-card");
  card.addEventListener("dragenter", (event) => { event.preventDefault(); state.dragDepth += 1; card.classList.add("dragging"); });
  card.addEventListener("dragover", (event) => event.preventDefault());
  card.addEventListener("dragleave", (event) => {
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) card.classList.remove("dragging");
  });
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    state.dragDepth = 0;
    card.classList.remove("dragging");
    const [file] = event.dataTransfer.files;
    if (file) loadFile(file);
  });
  document.querySelectorAll("[data-feature]").forEach((button) => button.addEventListener("click", () => input.click()));
}

async function loadFile(file, password) {
  const validation = validatePDFFile(file);
  if (!validation.ok) return setUploadMessage(validation.message, true);
  setUploadMessage(`Checking ${file.name}…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openDocument({ fileName: file.name, fileSize: file.size, bytes, password });
  } catch (error) {
    if (error instanceof PasswordRequiredError) {
      state.pendingFile = file;
      showPasswordPrompt(error.message);
      return;
    }
    setUploadMessage(error instanceof Error ? error.message : "PDFora couldn't open this file.", true);
  }
}

function showPasswordPrompt(message) {
  const slot = $("#password-slot");
  if (!slot) return;
  slot.innerHTML = renderPasswordPrompt(message);
  const form = slot.querySelector("form");
  form.querySelector("input").focus();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = form.querySelector("input").value;
    if (state.pendingFile) loadFile(state.pendingFile, password);
  });
}

async function restoreSession(session) {
  setUploadMessage(`Restoring ${session.fileName}…`);
  try {
    const assets = new Map((session.assets || []).map((asset) => [asset.id, assetFromBytes(asset)]));
    await openDocument({ fileName: session.fileName, fileSize: session.originalBytes.length, bytes: session.originalBytes, edits: session.edits || [], assets });
  } catch (error) {
    setUploadMessage(error instanceof Error ? error.message : "The saved session couldn't be restored.", true);
  }
}

/* ---------------------------------------------------------------- document */

async function openDocument({ fileName, fileSize, bytes, password, edits = [], assets = new Map() }) {
  const [originalDoc, libs] = await Promise.all([openPDFBytes(bytes, { password }), getEngineLibs()]);
  let analysis = [];
  let editable = true;
  try {
    const pdfDoc = await libs.PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    analysis = pdfDoc.getPages().map((_, index) => {
      const result = analyzePage(libs.PDFLib, pdfDoc, index);
      delete result.contentText;
      return result;
    });
  } catch {
    editable = false;
  }
  Object.assign(state, {
    fileName, fileSize, originalBytes: bytes, originalDoc, workingDoc: originalDoc, workingBytes: bytes, libs, analysis, editable,
    pageCache: new Map(), pageResolved: new Map(), edits: [], history: [[]], historyIndex: 0, assets, selection: null, report: new Map(), page: 1, scale: 1,
    ocrByPage: new Map(), ocrState: new Map(), tool: "select", capability: { pages: [] },
  });
  app.innerHTML = renderEditorShell({ name: fileName, size: fileSize }, originalDoc.numPages);
  bindEditor();
  await fitPage(false);
  computeCapability();
  if (edits.length) {
    state.edits = edits;
    state.history = [[], edits];
    state.historyIndex = 1;
    scheduleBuild(0);
  }
  if (!editable) setDocStatus("This PDF is encrypted, so its text and objects can't be rewritten. You can view, OCR and download it, or make an editable image copy.", true, true);
}

async function computeCapability() {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= state.originalDoc.numPages; pageNumber += 1) {
    const data = await pageData(pageNumber);
    const info = state.analysis[pageNumber - 1];
    const images = info?.objects.filter((object) => object.subtype !== "Form").length || 0;
    const forms = info?.objects.filter((object) => object.subtype === "Form").length || 0;
    const pageArea = data.width * data.height;
    const bigImage = info?.objects.some((object) => object.subtype !== "Form" && quadArea(object.quad) > pageArea * 0.6);
    pages.push({
      runs: data.runs.length,
      fonts: (info?.fonts || []).map((font) => ({ name: font.displayName, reusable: font.usable })),
      images,
      forms,
      width: data.width,
      height: data.height,
      rotation: data.rotation,
      scanned: data.runs.length === 0 && (bigImage || images > 0),
    });
  }
  state.capability = { pages };
  if (!state.selection) renderPanel();
}

function quadArea(quad) {
  let area = 0;
  for (let index = 0; index < quad.length; index += 1) {
    const [x1, y1] = quad[index];
    const [x2, y2] = quad[(index + 1) % quad.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

/** Text runs (from the original document) and page geometry, cached per page. */
function pageData(pageNumber) {
  if (state.pageCache.has(pageNumber)) return state.pageCache.get(pageNumber);
  const promise = (async () => {
    const page = await state.originalDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const content = await page.getTextContent({ disableNormalization: true });
    try { await page.getOperatorList(); } catch { /* fonts unavailable: runs use approximations */ }
    const profiles = state.analysis[pageNumber - 1]?.fonts || [];
    const runs = [];
    content.items.forEach((item, index) => {
      if (!("str" in item) || !item.str.trim() || !item.transform) return;
      const profile = matchProfile(page, item, profiles);
      const run = new TextRun(item, profile, content.styles[item.fontName]);
      if (!(run.totalUnits > 0)) return;
      const fontObject = safeFont(page, item.fontName);
      runs.push({ index, item, run, profile: run.profile, fontName: fontObject?.name || content.styles[item.fontName]?.fontFamily || "", quad: run.quad(0, run.totalUnits) });
    });
    const data = { runs, profiles, transform1: viewport.transform, width: viewport.width, height: viewport.height, rotation: page.rotate, userBox: page.view };
    state.pageResolved.set(pageNumber, data);
    return data;
  })();
  state.pageCache.set(pageNumber, promise);
  return promise;
}

function safeFont(page, name) {
  try { return page.commonObjs.has(name) ? page.commonObjs.get(name) : null; } catch { return null; }
}

function matchProfile(page, item, profiles) {
  const font = safeFont(page, item.fontName);
  const key = normaliseFontKey(font?.name || "");
  const encodes = (profile) => profile.usable && !encodeWithProfile(profile, item.str).missing.length;
  const byName = profiles.filter((profile) => key && profile.key === key);
  return byName.find(encodes) || (byName.length ? null : profiles.find((profile) => encodes(profile) && key && (profile.key.includes(key) || key.includes(profile.key)))) || null;
}

/* ------------------------------------------------------------------ editor */

function bindEditor() {
  document.querySelectorAll('[data-action="close-document"]').forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    if (state.edits.length && !confirm("Close this document? Your edits stay saved in this browser so you can restore them from the home page.")) return;
    showLanding();
  }));
  $('[data-action="prev-page"]').addEventListener("click", () => goToPage(state.page - 1));
  $('[data-action="next-page"]').addEventListener("click", () => goToPage(state.page + 1));
  $('[data-action="zoom-in"]').addEventListener("click", () => setZoom(state.scale * 1.15));
  $('[data-action="zoom-out"]').addEventListener("click", () => setZoom(state.scale / 1.15));
  $('[data-action="fit-page"]').addEventListener("click", () => fitPage());
  $('[data-action="undo"]').addEventListener("click", undo);
  $('[data-action="redo"]').addEventListener("click", redo);
  $('[data-action="print"]').addEventListener("click", () => printPDF(state.workingBytes));
  $('[data-action="toggle-downloads"]').addEventListener("click", toggleDownloads);
  document.querySelectorAll("[data-download]").forEach((button) => button.addEventListener("click", () => handleDownload(button.dataset.download)));
  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  $("#image-file").addEventListener("change", (event) => { const [file] = event.currentTarget.files; event.currentTarget.value = ""; if (file) insertImage(file); });
  $("#replace-file").addEventListener("change", (event) => { const [file] = event.currentTarget.files; event.currentTarget.value = ""; if (file) replaceSelectedImage(file); });
  const frame = $("#page-frame");
  frame.addEventListener("pointerdown", onPointerDown);
  frame.addEventListener("pointermove", onPointerMove);
  frame.addEventListener("pointerup", onPointerUp);
  frame.addEventListener("pointercancel", () => { state.drag = null; drawOverlay(); });
  frame.addEventListener("pointerleave", () => { if (!state.drag) { state.hover = null; drawOverlay(); } });
  frame.addEventListener("dblclick", onDoubleClick);
  frame.addEventListener("dragover", (event) => event.preventDefault());
  frame.addEventListener("drop", (event) => {
    event.preventDefault();
    const [file] = event.dataTransfer.files;
    if (file?.type.startsWith("image/")) insertImage(file, userPointFromEvent(event));
  });
  $("#page-stage").addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom(state.scale * (event.deltaY < 0 ? 1.06 : 1 / 1.06)); }
  }, { passive: false });
  const panel = $("#properties");
  panel.addEventListener("input", onPanelInput);
  panel.addEventListener("change", onPanelChange);
  panel.addEventListener("click", onPanelClick);
  panel.addEventListener("keydown", (event) => {
    if (event.target.dataset.field === "selectionText" && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); applySelectionText(); }
  });
  document.addEventListener("click", (event) => {
    const popover = $("#download-popover");
    if (popover && !popover.hidden && !event.target.closest(".download-menu")) closeDownloads();
  });
  updateHistoryButtons();
}

function setTool(tool) {
  if (!state.editable && tool !== "select") return setDocStatus("Editing tools need an unencrypted PDF.", true);
  state.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
    button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
  });
  $("#page-frame").dataset.tool = tool;
  if (tool === "image") $("#image-file").click();
  if (tool !== "select") state.selection = null;
  renderPanel();
  drawOverlay();
}

function setDocStatus(message, warn = false, sticky = false) {
  const status = $("#doc-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("warn", warn);
  if (!sticky) debounce("status", () => { if (status.textContent === message) status.textContent = ""; }, 6000);
}

function setSaveState(text, kind = "") {
  const node = $("#save-state");
  if (!node) return;
  node.querySelector("span").textContent = text;
  node.dataset.kind = kind;
}

/* ------------------------------------------------------------------- paint */

async function paint({ thumbnails = false } = {}) {
  const canvas = $("#pdf-canvas");
  if (!canvas || !state.workingDoc) return;
  try {
    const result = await renderPage(state.workingDoc, state.page, state.scale, canvas);
    state.view = { ...result, inverse: invert(result.transform) };
    const svg = $("#overlay");
    svg.setAttribute("width", String(Math.floor(result.width)));
    svg.setAttribute("height", String(Math.floor(result.height)));
    svg.setAttribute("viewBox", `0 0 ${Math.floor(result.width)} ${Math.floor(result.height)}`);
    $("#current-page").textContent = String(state.page);
    $("#zoom-label").textContent = `${Math.round(state.scale * 100)}%`;
    $('[data-action="prev-page"]').disabled = state.page <= 1;
    $('[data-action="next-page"]').disabled = state.page >= state.workingDoc.numPages;
    await pageData(state.page);
    drawOverlay();
    if (thumbnails || !$("#page-list").children.length) renderPageThumbnails(state.workingDoc, $("#page-list"), state.page, goToPage);
    else document.querySelectorAll(".thumbnail-button").forEach((button, index) => button.classList.toggle("active", index + 1 === state.page));
  } catch (error) {
    if (error?.name === "RenderingCancelledException") return;
    setDocStatus("This page could not be rendered.", true);
  }
}

function goToPage(page) {
  if (!state.workingDoc || page < 1 || page > state.workingDoc.numPages || page === state.page) return;
  state.page = page;
  state.selection = null;
  state.hover = null;
  renderPanel();
  paint();
  $("#page-stage")?.scrollTo({ top: 0, behavior: "smooth" });
}

function setZoom(scale) {
  state.scale = Math.min(4, Math.max(0.25, Math.round(scale * 100) / 100));
  paint();
}

async function fitPage(render = true) {
  const stage = $("#page-stage");
  if (!stage || !state.originalDoc) return;
  const page = await state.originalDoc.getPage(state.page);
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const padding = window.innerWidth < 760 ? 24 : 72;
  state.scale = Math.min(4, Math.max(0.25, Math.min((stage.clientWidth - padding) / viewport.width, (stage.clientHeight - padding) / viewport.height, 2)));
  if (render !== false) await paint();
  else await paint({ thumbnails: true });
}

/* --------------------------------------------------------------- geometry */

const toScreen = ([x, y]) => apply(state.view.transform, x, y);
const toUser = ([x, y]) => apply(state.view.inverse, x, y);

function userPointFromEvent(event) {
  const rect = $("#pdf-canvas").getBoundingClientRect();
  const sx = (event.clientX - rect.left) * (state.view.width / rect.width);
  const sy = (event.clientY - rect.top) * (state.view.height / rect.height);
  return { screen: [sx, sy], user: toUser([sx, sy]) };
}

function textOrigin(x, y, size, rotation) {
  const theta = (-rotation * Math.PI) / 180;
  return [size * Math.cos(theta), size * Math.sin(theta), -size * Math.sin(theta), size * Math.cos(theta), x, y];
}

function pageRotation(pageNumber = state.page) {
  return state.analysis[pageNumber - 1]?.box.rotation ?? 0;
}

function editsOnPage(pageNumber = state.page) {
  return state.edits.filter((edit) => edit.page === pageNumber);
}

function findEdit(id) {
  return state.edits.find((edit) => edit.id === id);
}

function objectById(pageNumber, objectId) {
  return state.analysis[pageNumber - 1]?.objects.find((object) => object.id === objectId) || null;
}

function objectEditId(pageNumber, objectId) {
  return `obj-${pageNumber}-${objectId}`;
}

function objectPlacement(object, edit) {
  return edit?.placement || decomposePlacement(object.unit);
}

function objectQuad(object, edit) {
  return edit?.placement ? unitQuad(placementMatrix(edit.placement)) : object.quad;
}

function textEditQuad(edit) {
  const report = state.report.get(edit.id);
  const lines = report?.lines || String(edit.text).split("\n").length;
  const width = report?.width ?? Math.max(1, ...String(edit.text).split("\n").map((line) => line.length * 0.52));
  const y0 = -(lines - 1) * (edit.lineHeight || 1.2) - 0.25;
  return [[0, y0], [Math.max(width, 0.5), y0], [Math.max(width, 0.5), 0.95], [0, 0.95]].map(([x, y]) => apply(edit.origin, x, y));
}

function runEditQuad(entry, edit) {
  const report = state.report.get(edit.id);
  const ratio = edit.meta.size && entry.run.scale ? edit.meta.size / entry.run.scale : 1;
  const end = Math.max(entry.run.totalUnits, entry.run.offset(edit.meta.keep) + (report?.width ?? 0) * ratio);
  return entry.run.quad(0, end);
}

/* ------------------------------------------------------------ hit testing */

function hitTest(user) {
  const pageEdits = editsOnPage();
  for (const edit of [...pageEdits].reverse()) {
    if (edit.type === "image" && pointInQuad(user, unitQuad(placementMatrix(edit.placement)))) return { kind: "image", id: edit.id };
    if (edit.type === "text" && edit.meta?.kind === "added" && pointInQuad(user, textEditQuad(edit))) return { kind: "added", id: edit.id };
  }
  for (const edit of [...pageEdits].reverse()) if (edit.type === "erase" && pointInQuad(user, edit.quad)) return { kind: "erase", id: edit.id };
  const resolved = state.pageResolved.get(state.page);
  if (resolved) {
    for (const entry of resolved.runs) {
      const edit = findEdit(`run-${state.page}-${entry.index}`);
      if (pointInQuad(user, edit ? runEditQuad(entry, edit) : entry.quad)) return { kind: "run", index: entry.index };
    }
  }
  const ocrWords = state.ocrByPage.get(state.page) || [];
  for (const [index, word] of ocrWords.entries()) if (pointInQuad(user, word.quad)) return { kind: "ocr", index };
  const objects = (state.analysis[state.page - 1]?.objects || [])
    .map((object) => ({ object, edit: findEdit(objectEditId(state.page, object.id)) }))
    .filter(({ edit }) => !edit?.deleted)
    .map((item) => ({ ...item, quad: objectQuad(item.object, item.edit) }))
    .sort((a, b) => quadArea(a.quad) - quadArea(b.quad));
  for (const item of objects) if (pointInQuad(user, item.quad)) return { kind: "object", objectId: item.object.id };
  return null;
}

function ensureResolved(pageNumber) {
  return pageData(pageNumber);
}

/* ------------------------------------------------------------- selection */

function targetQuad(target) {
  if (!target) return null;
  if (target.kind === "image") return unitQuad(placementMatrix(findEdit(target.id).placement));
  if (target.kind === "added") return textEditQuad(findEdit(target.id));
  if (target.kind === "erase") return findEdit(target.id).quad;
  if (target.kind === "object") {
    const object = objectById(state.page, target.objectId);
    return object ? objectQuad(object, findEdit(objectEditId(state.page, target.objectId))) : null;
  }
  if (target.kind === "run") {
    const entry = runEntry(target.index);
    if (!entry) return null;
    const edit = findEdit(`run-${state.page}-${entry.index}`);
    return edit ? runEditQuad(entry, edit) : entry.quad;
  }
  if (target.kind === "ocr") return state.ocrByPage.get(state.page)?.[target.index]?.quad || null;
  return null;
}

function runEntry(index, pageNumber = state.page) {
  return state.pageResolved.get(pageNumber)?.runs.find((entry) => entry.index === index) || null;
}

function displayedRunText(entry, edit) {
  return edit ? entry.item.str.slice(0, edit.meta.keep) + edit.meta.text : entry.item.str;
}

function placementSupportsHandles(target) {
  return target && (target.kind === "image" || target.kind === "object" || target.kind === "added");
}

function selectionPlacementInfo() {
  const selection = state.selection;
  if (!selection) return null;
  if (selection.kind === "image") {
    const edit = findEdit(selection.id);
    return edit ? { placement: edit.placement } : null;
  }
  if (selection.kind === "object") {
    const object = objectById(state.page, selection.objectId);
    if (!object) return null;
    return { placement: objectPlacement(object, findEdit(objectEditId(state.page, selection.objectId))) };
  }
  return null;
}

/* ---------------------------------------------------------------- overlay */

function svg(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function polygon(quad, className) {
  return svg("polygon", { points: quad.map(toScreen).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "), class: className });
}

function handlePositions(placement) {
  const matrix = placementMatrix({ ...placement, flipH: false, flipV: false });
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => ({ u, v, point: toScreen(apply(matrix, u, v)) }));
  const top = toScreen(apply(matrix, 0.5, 1));
  const center = toScreen(apply(matrix, 0.5, 0.5));
  const length = Math.hypot(top[0] - center[0], top[1] - center[1]) || 1;
  const rotate = [top[0] + ((top[0] - center[0]) / length) * 26, top[1] + ((top[1] - center[1]) / length) * 26];
  return { corners, top, rotate };
}

function drawOverlay() {
  const overlay = $("#overlay");
  if (!overlay || !state.view) return;
  overlay.replaceChildren();
  const pageEdits = editsOnPage();
  // Outline every object softly in edit mode so images and graphics are discoverable.
  if (state.tool === "select") {
    for (const object of state.analysis[state.page - 1]?.objects || []) {
      const edit = findEdit(objectEditId(state.page, object.id));
      if (edit?.deleted) continue;
      overlay.append(polygon(objectQuad(object, edit), "object-hint"));
    }
  }
  for (const edit of pageEdits) {
    if (edit.type === "erase") overlay.append(polygon(edit.quad, "erase-hint"));
  }
  if (state.hover && !state.drag) {
    const quad = targetQuad(state.hover);
    if (quad) overlay.append(polygon(quad, "hover-outline"));
  }
  if (state.selection) {
    const quad = state.selection.kind === "run" && state.selection.range ? state.selection.range.quad : targetQuad(state.selection);
    if (quad) overlay.append(polygon(quad, "selection-outline"));
    const info = selectionPlacementInfo();
    if (info && !state.drag) {
      const { corners, top, rotate } = handlePositions(info.placement);
      overlay.append(svg("line", { x1: top[0], y1: top[1], x2: rotate[0], y2: rotate[1], class: "rotate-stem" }));
      overlay.append(svg("circle", { cx: rotate[0], cy: rotate[1], r: 7, class: "handle rotate-handle" }));
      for (const corner of corners) overlay.append(svg("rect", { x: corner.point[0] - 6, y: corner.point[1] - 6, width: 12, height: 12, rx: 3, class: "handle" }));
    }
  }
  const drag = state.drag;
  if (drag?.preview) {
    if (drag.preview.image) {
      const quadScreen = drag.preview.quad.map(toScreen);
      // Map the unit square (image space, y down) to the preview quad.
      const [p0, p1, , p3] = [quadScreen[3], quadScreen[2], quadScreen[1], quadScreen[0]];
      const a = p1[0] - p0[0]; const b = p1[1] - p0[1]; const c = p3[0] - p0[0]; const d = p3[1] - p0[1];
      const image = svg("image", { href: drag.preview.image, x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: "none", opacity: 0.75, transform: `matrix(${a} ${b} ${c} ${d} ${p0[0]} ${p0[1]})` });
      overlay.append(image);
    }
    overlay.append(polygon(drag.preview.quad, "selection-outline dragging"));
  }
  if (drag?.kind === "erase" && drag.current) {
    const [x0, y0] = drag.start.screen;
    const [x1, y1] = drag.current.screen;
    overlay.append(svg("rect", { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), class: "erase-draft" }));
  }
}

/* --------------------------------------------------------------- pointer */

async function onPointerDown(event) {
  if (event.button !== 0 || !state.view) return;
  const point = userPointFromEvent(event);
  await ensureResolved(state.page);
  if (!state.editable && state.tool !== "select") return;
  if (state.tool === "addText") { createAddedText(point.user); setTool("select"); return; }
  if (state.tool === "erase") {
    state.drag = { kind: "erase", start: point, current: point };
    event.currentTarget.setPointerCapture(event.pointerId);
    return;
  }
  if (state.tool !== "select") return;

  const info = selectionPlacementInfo();
  if (info && state.editable) {
    const { corners, rotate } = handlePositions(info.placement);
    if (Math.hypot(point.screen[0] - rotate[0], point.screen[1] - rotate[1]) < 11) return startPlacementDrag(event, point, "rotate", info.placement);
    const corner = corners.find((item) => Math.hypot(point.screen[0] - item.point[0], point.screen[1] - item.point[1]) < 10);
    if (corner) return startPlacementDrag(event, point, "resize", info.placement, corner);
  }

  const target = hitTest(point.user);
  if (!target) { state.selection = null; renderPanel(); drawOverlay(); return; }
  if (target.kind === "run") { selectRunWord(target.index, point.user, event.shiftKey); return; }
  if (target.kind === "ocr") { selectOCRWord(target.index); return; }
  state.selection = target;
  renderPanel();
  drawOverlay();
  if (!state.editable) return;
  if (target.kind === "image" || target.kind === "object") startPlacementDrag(event, point, "move", selectionPlacementInfo().placement);
  if (target.kind === "added") {
    const edit = findEdit(target.id);
    state.drag = { kind: "move-text", id: target.id, start: point, origin: { x: edit.meta.x, y: edit.meta.y }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
}

function startPlacementDrag(event, point, mode, placement, corner) {
  const quad = unitQuad(placementMatrix(placement));
  const bounds = quadBounds(quad.map(toScreen));
  let image = null;
  const selection = state.selection;
  if (selection.kind === "image") image = state.assets.get(findEdit(selection.id).asset)?.url || null;
  else if (selection.kind === "object") {
    const edit = findEdit(objectEditId(state.page, selection.objectId));
    if (edit?.replaceAsset) image = state.assets.get(edit.replaceAsset)?.url || null;
    else if (!placement.rotation && !placement.flipH && !placement.flipV) image = snapshot($("#pdf-canvas"), bounds, state.view.width);
  }
  state.drag = { kind: "placement", mode, start: point, placement: { ...placement }, corner, moved: false, image };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!state.view) return;
  const point = userPointFromEvent(event);
  const drag = state.drag;
  if (!drag) {
    if (state.tool !== "select") return;
    const resolved = state.pageResolved.get(state.page);
    if (!resolved) { ensureResolved(state.page); return; }
    const hover = hitTest(point.user);
    if (JSON.stringify(hover) !== JSON.stringify(state.hover)) { state.hover = hover; drawOverlay(); }
    const frame = $("#page-frame");
    frame.classList.toggle("hover-text", hover?.kind === "run" || hover?.kind === "ocr");
    frame.classList.toggle("hover-move", hover?.kind === "image" || hover?.kind === "object" || hover?.kind === "added");
    return;
  }
  drag.current = point;
  if (Math.hypot(point.screen[0] - drag.start.screen[0], point.screen[1] - drag.start.screen[1]) > 3) drag.moved = true;
  if (drag.kind === "placement" && drag.moved) {
    drag.next = transformPlacement(drag, point, event.shiftKey);
    drag.preview = { quad: unitQuad(placementMatrix(drag.next)), image: drag.image };
  }
  if (drag.kind === "move-text" && drag.moved) {
    const edit = findEdit(drag.id);
    const dx = point.user[0] - drag.start.user[0];
    const dy = point.user[1] - drag.start.user[1];
    const preview = { ...edit, origin: [...edit.origin.slice(0, 4), drag.origin.x + dx, drag.origin.y + dy] };
    drag.preview = { quad: textEditQuad(preview) };
    drag.next = { x: drag.origin.x + dx, y: drag.origin.y + dy };
  }
  drawOverlay();
}

function transformPlacement(drag, point, freeAspect) {
  const start = drag.placement;
  const next = { ...start };
  if (drag.mode === "move") {
    next.cx = start.cx + point.user[0] - drag.start.user[0];
    next.cy = start.cy + point.user[1] - drag.start.user[1];
    return next;
  }
  const theta = (-start.rotation * Math.PI) / 180;
  const ex = [Math.cos(theta), Math.sin(theta)];
  const ey = [-Math.sin(theta), Math.cos(theta)];
  const rel = [point.user[0] - start.cx, point.user[1] - start.cy];
  if (drag.mode === "rotate") {
    const angle = Math.atan2(rel[1], rel[0]) - Math.PI / 2;
    let rotation = normaliseDegrees((-angle * 180) / Math.PI);
    if (freeAspect) rotation = Math.round(rotation / 15) * 15;
    next.rotation = rotation;
    return next;
  }
  // Resize: the opposite corner stays fixed.
  const su = drag.corner.u === 1 ? 1 : -1;
  const sv = drag.corner.v === 1 ? 1 : -1;
  const fixed = [(-su * start.width) / 2, (-sv * start.height) / 2];
  const local = [rel[0] * ex[0] + rel[1] * ex[1], rel[0] * ey[0] + rel[1] * ey[1]];
  let width = Math.max(4, (local[0] - fixed[0]) * su);
  let height = Math.max(4, (local[1] - fixed[1]) * sv);
  if (state.lockAspect !== freeAspect) {
    const ratio = Math.max(width / start.width, height / start.height);
    width = start.width * ratio;
    height = start.height * ratio;
  }
  const centerLocal = [fixed[0] + (su * width) / 2, fixed[1] + (sv * height) / 2];
  next.width = width;
  next.height = height;
  next.cx = start.cx + centerLocal[0] * ex[0] + centerLocal[1] * ey[0];
  next.cy = start.cy + centerLocal[0] * ex[1] + centerLocal[1] * ey[1];
  return next;
}

function onPointerUp(event) {
  const drag = state.drag;
  if (!drag) return;
  state.drag = null;
  try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  if (drag.kind === "erase") {
    const end = userPointFromEvent(event);
    const [x0, y0] = drag.start.screen;
    const [x1, y1] = end.screen;
    if (Math.abs(x1 - x0) < 4 || Math.abs(y1 - y0) < 4) { drawOverlay(); return; }
    const quad = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]].map(toUser);
    createErase(quad);
    return;
  }
  if (drag.kind === "placement" && drag.moved && drag.next) { updatePlacement(drag.next, drag.mode); return; }
  if (drag.kind === "move-text" && drag.moved && drag.next) {
    updateAddedText(drag.id, { x: drag.next.x, y: drag.next.y }, "move-text");
    return;
  }
  drawOverlay();
}

async function onDoubleClick(event) {
  if (state.tool !== "select" || !state.view) return;
  const point = userPointFromEvent(event);
  await ensureResolved(state.page);
  const target = hitTest(point.user);
  if (target?.kind === "run") selectRunLine(target.index);
}

/* ----------------------------------------------------------- text runs */

async function runStyleDefaults(entry, edit) {
  const sampler = await getSampler(state.originalDoc, state.page);
  const colors = sampleQuad(sampler, entry.quad);
  if (edit) {
    return {
      fontValue: fontSpecToValue(edit.font), size: round1(edit.meta.size ?? entry.run.scale), color: edit.color, bg: edit.bg,
      bold: !!edit.bold, italic: !!edit.italic, underline: !!edit.underline, opacity: edit.opacity ?? 1,
    };
  }
  const style = describeFontStyle(entry.fontName);
  return {
    fontValue: entry.profile ? `orig:${entry.profile.uid}` : `std:${style.family}`,
    size: round1(entry.run.scale), color: colors.fg, bg: colors.bg, bold: false, italic: false, underline: false, opacity: 1,
    fallbackStyle: style,
  };
}

const round1 = (value) => Math.round(value * 10) / 10;

async function selectRunWord(index, user, extend) {
  const entry = runEntry(index);
  if (!entry) return;
  const edit = findEdit(`run-${state.page}-${index}`);
  const text = displayedRunText(entry, edit);
  let range;
  if (edit && entry.run.offset(edit.meta.keep) <= toTextUnits(entry, user)) {
    range = { start: edit.meta.keep, end: text.length };
  } else {
    const charIndex = entry.run.indexAt(toTextUnits(entry, user));
    range = entry.run.wordAt(Math.min(charIndex, entry.item.str.length));
    if (edit) range.end = Math.min(range.end, edit.meta.keep) || range.end;
  }
  if (extend && state.selection?.kind === "run" && state.selection.index === index) {
    range = { start: Math.min(range.start, state.selection.range.start), end: Math.max(range.end, state.selection.range.end) };
  }
  await setRunSelection(entry, edit, range);
}

async function selectRunLine(index) {
  const entry = runEntry(index);
  if (!entry) return;
  const edit = findEdit(`run-${state.page}-${index}`);
  await setRunSelection(entry, edit, { start: 0, end: displayedRunText(entry, edit).length });
}

function toTextUnits(entry, user) {
  const inverse = invert(entry.run.matrix);
  return inverse ? apply(inverse, user[0], user[1])[0] : 0;
}

async function setRunSelection(entry, edit, range) {
  const text = displayedRunText(entry, edit);
  const startUnits = range.start <= (edit?.meta.keep ?? Infinity) ? entry.run.offset(Math.min(range.start, entry.item.str.length)) : entry.run.offset(edit.meta.keep);
  const endUnits = edit && range.end > edit.meta.keep ? runEditQuadUnits(entry, edit) : entry.run.offset(Math.min(range.end, entry.item.str.length));
  const style = await runStyleDefaults(entry, edit);
  state.selection = {
    kind: "run", index: entry.index, source: "native", edited: !!edit,
    range: { ...range, quad: entry.run.quad(startUnits, Math.max(endUnits, startUnits + 0.2)) },
    text: text.slice(range.start, range.end), style,
  };
  renderPanel();
  drawOverlay();
  focusSelectionText();
}

function runEditQuadUnits(entry, edit) {
  const report = state.report.get(edit.id);
  const ratio = edit.meta.size && entry.run.scale ? edit.meta.size / entry.run.scale : 1;
  return entry.run.offset(edit.meta.keep) + (report?.width ?? 1) * ratio;
}

function focusSelectionText() {
  const input = $("#selection-text");
  if (input && window.matchMedia("(pointer: fine)").matches) { input.focus(); input.select(); }
}

function readPanelStyle() {
  const panel = $("#properties");
  const value = (field) => panel.querySelector(`[data-field="${field}"]`)?.value;
  const on = (field) => panel.querySelector(`[data-toggle="${field}"]`)?.classList.contains("on") || false;
  return {
    fontValue: value("font"), size: Number(value("size")), color: value("color"), bg: value("bg"),
    bold: on("bold"), italic: on("italic"), underline: on("underline"), opacity: Number(value("opacity") ?? 1),
  };
}

function applySelectionText(deleteText = false) {
  const selection = state.selection;
  if (!selection || !state.editable) return;
  if (selection.kind === "ocr") return applyOCRText(deleteText);
  if (selection.kind !== "run") return;
  const entry = runEntry(selection.index);
  if (!entry) return;
  const id = `run-${state.page}-${entry.index}`;
  const edit = findEdit(id);
  const current = displayedRunText(entry, edit);
  let { start, end } = selection.range;
  let replacement = deleteText ? "" : $("#selection-text").value.replace(/\n/g, " ");
  if (deleteText) {
    if (current[end] === " ") end += 1;
    else if (current[start - 1] === " ") start -= 1;
  }
  const next = current.slice(0, start) + replacement + current.slice(end);
  const style = readPanelStyle();
  const keep = Math.min(edit?.meta.keep ?? start, start);
  const original = entry.item.str;
  const styleChanged = style.fontValue !== (entry.profile ? `orig:${entry.profile.uid}` : style.fontValue) || Math.abs(style.size - entry.run.scale) > 0.05 || style.bold || style.italic || style.underline || style.opacity < 1;
  if (next === original && !styleChanged && !edit?.meta.styled) {
    commit(state.edits.filter((item) => item.id !== id), "Restored original text");
    state.selection = null;
    renderPanel();
    return;
  }
  const engineEdit = buildRunEdit({
    id, page: state.page, run: entry.run, keep, text: next.slice(keep),
    style: {
      font: valueToFontSpec(style.fontValue), color: style.color, bg: style.bg, bold: style.bold, italic: style.italic,
      underline: style.underline, opacity: style.opacity, size: style.size, originalSize: entry.run.scale,
    },
  });
  engineEdit.meta = { kind: "run", index: entry.index, keep, text: next.slice(keep), size: style.size, styled: styleChanged };
  commit(upsert(engineEdit), deleteText ? "Deleted text" : "Edited text");
  const newEnd = start + replacement.length;
  state.selection = { ...selection, edited: true, text: replacement, range: { start, end: Math.max(newEnd, start), quad: selection.range.quad }, style };
  if (deleteText) state.selection = null;
  renderPanel();
  drawOverlay();
}

function upsert(edit) {
  const index = state.edits.findIndex((item) => item.id === edit.id);
  if (index < 0) return [...state.edits, edit];
  const next = state.edits.slice();
  next[index] = edit;
  return next;
}

function revertRun() {
  if (state.selection?.kind !== "run") return;
  const id = `run-${state.page}-${state.selection.index}`;
  commit(state.edits.filter((item) => item.id !== id), "Restored original text");
  state.selection = null;
  renderPanel();
}

/* ------------------------------------------------------------------ OCR */

async function runOCR() {
  const page = state.page;
  const language = $("#ocr-language")?.value || "eng";
  state.ocrState.set(page, { running: true, message: "Preparing this page…" });
  renderPanel();
  try {
    const words = await recognizePDFPage(state.originalDoc, page, language, (progress) => {
      const percent = Number.isFinite(progress.progress) ? ` ${Math.round(progress.progress * 100)}%` : "";
      const label = progress.status === "recognizing text" ? "Reading text" : "Loading OCR";
      state.ocrState.set(page, { running: true, message: `${label}${percent}…` });
      const status = document.querySelector(".ocr-status");
      if (status) status.textContent = `${label}${percent}…`;
    });
    state.ocrByPage.set(page, words.map((word) => {
      const { x, y, width, height } = word.box;
      return { ...word, quad: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] };
    }));
    state.ocrState.set(page, { running: false, done: true, message: words.length ? `Found ${words.length} words. Click a word to edit it.` : "No words found. Try another language or a clearer scan." });
  } catch (error) {
    state.ocrState.set(page, { running: false, message: error instanceof Error ? error.message : "OCR couldn't read this page." });
  }
  if (state.page === page) { renderPanel(); drawOverlay(); }
}

async function selectOCRWord(index) {
  const word = state.ocrByPage.get(state.page)?.[index];
  if (!word) return;
  const id = `ocr-${state.page}-${index}`;
  const edit = findEdit(id);
  const sampler = await getSampler(state.originalDoc, state.page);
  const colors = sampleQuad(sampler, word.quad);
  state.selection = {
    kind: "ocr", index, source: "ocr", edited: !!edit, confidence: word.confidence, text: edit ? edit.text : word.text,
    range: { quad: word.quad },
    style: edit
      ? { fontValue: fontSpecToValue(edit.font), size: round1(edit.meta.size), color: edit.color, bg: edit.bg, bold: !!edit.bold, italic: !!edit.italic, underline: !!edit.underline, opacity: edit.opacity ?? 1 }
      : { fontValue: /[\u0900-\u097F]/.test(word.text) ? "uni" : "std:sans", size: round1(ocrSize(word)), color: colors.fg, bg: colors.bg, bold: false, italic: false, underline: false, opacity: 1 },
  };
  renderPanel();
  drawOverlay();
  focusSelectionText();
}

function ocrSize(word) {
  const data = state.pageResolved.get(state.page);
  const bounds = quadBounds(word.quad.map((point) => apply(data.transform1, ...point)));
  return Math.max(4, bounds.height * 0.82);
}

function applyOCRText(deleteText) {
  const selection = state.selection;
  const word = state.ocrByPage.get(state.page)?.[selection.index];
  const data = state.pageResolved.get(state.page);
  if (!word || !data) return;
  const style = readPanelStyle();
  const bounds = quadBounds(word.quad.map((point) => apply(data.transform1, ...point)));
  const inverse1 = invert(data.transform1);
  const [x, y] = apply(inverse1, bounds.x, bounds.y + bounds.height * 0.8);
  const pad = bounds.height * 0.08;
  const mask = [[bounds.x - pad, bounds.y + bounds.height + pad], [bounds.x + bounds.width + pad, bounds.y + bounds.height + pad], [bounds.x + bounds.width + pad, bounds.y - pad], [bounds.x - pad, bounds.y - pad]].map((point) => apply(inverse1, ...point));
  const text = deleteText ? "" : $("#selection-text").value;
  const id = `ocr-${state.page}-${selection.index}`;
  const edit = {
    id, type: "text", page: state.page, mask, bg: style.bg, origin: textOrigin(x, y, style.size, -pageRotation()), text,
    font: valueToFontSpec(style.fontValue), color: style.color, bold: style.bold, italic: style.italic, underline: style.underline, opacity: style.opacity,
    meta: { kind: "ocr", index: selection.index, size: style.size },
  };
  commit(upsert(edit), deleteText ? "Deleted scanned word" : "Edited scanned word");
  state.selection = deleteText ? null : { ...selection, edited: true, text, style };
  renderPanel();
}

/* ------------------------------------------------------------ added text */

function createAddedText(user) {
  const size = 16;
  const edit = {
    id: newId("text"), type: "text", page: state.page, origin: textOrigin(user[0], user[1], size, -pageRotation()), text: "New text",
    font: { mode: "standard", family: "sans" }, color: "#17264a", opacity: 1, bold: false, italic: false, underline: false,
    meta: { kind: "added", x: user[0], y: user[1], size, rotation: 0 },
  };
  commit([...state.edits, edit], "Added text");
  state.selection = { kind: "added", id: edit.id };
  renderPanel();
  drawOverlay();
  const input = $("#added-text");
  if (input) { input.focus(); input.select(); }
}

function updateAddedText(id, changes, label = "Edited text") {
  const edit = findEdit(id);
  if (!edit) return;
  const meta = { ...edit.meta, ...pick(changes, ["x", "y", "size", "rotation"]) };
  const next = { ...edit, ...pick(changes, ["text", "font", "color", "bold", "italic", "underline", "opacity"]), meta };
  next.origin = textOrigin(meta.x, meta.y, meta.size, meta.rotation - pageRotation(edit.page));
  commit(upsert(next), label, `${label}-${id}`);
  drawOverlay();
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]));
}

/* ---------------------------------------------------------- images & objects */

function insertImage(file, dropPoint) {
  setTool("select");
  readImageFile(file).then((asset) => {
    state.assets.set(asset.id, asset);
    const data = state.analysis[state.page - 1]?.box || { x: 0, y: 0, width: 595, height: 842 };
    const rotation = pageRotation();
    const visualWidth = rotation % 180 ? data.height : data.width;
    const maxWidth = visualWidth * 0.45;
    const ratio = asset.height / asset.width;
    const width = Math.min(maxWidth, asset.width * 0.75);
    const height = width * ratio;
    const center = dropPoint?.user || [data.x + data.width / 2, data.y + data.height / 2];
    const edit = { id: newId("img"), type: "image", page: state.page, asset: asset.id, placement: { cx: center[0], cy: center[1], width, height, rotation: -rotation, flipH: false, flipV: false }, opacity: 1, z: "front" };
    commit([...state.edits, edit], "Inserted image");
    state.selection = { kind: "image", id: edit.id };
    renderPanel();
    drawOverlay();
  }).catch((error) => setDocStatus(error.message, true));
}

function currentObjectEdit() {
  const selection = state.selection;
  if (selection?.kind === "image") return findEdit(selection.id);
  if (selection?.kind === "object") {
    return findEdit(objectEditId(state.page, selection.objectId)) || { id: objectEditId(state.page, selection.objectId), type: "object", page: state.page, objectId: selection.objectId };
  }
  return null;
}

function updateObject(changes, label, coalesce) {
  const edit = currentObjectEdit();
  if (!edit) return;
  const next = { ...edit, ...changes };
  if (next.type === "object" && !next.deleted && !next.placement && !next.replaceAsset && (next.opacity ?? 1) === 1 && !next.border?.width && !Object.values(next.crop || {}).some(Boolean) && (next.z || "same") === "same") {
    commit(state.edits.filter((item) => item.id !== edit.id), label, coalesce);
  } else {
    commit(upsert(next), label, coalesce);
  }
  renderPanel();
  drawOverlay();
}

function updatePlacement(placement, mode) {
  updateObject({ placement }, mode === "rotate" ? "Rotated" : mode === "resize" ? "Resized" : "Moved");
}

async function replaceSelectedImage(file) {
  try {
    const asset = await readImageFile(file);
    state.assets.set(asset.id, asset);
    const edit = currentObjectEdit();
    if (!edit) return;
    const current = edit.type === "image" ? edit.placement : objectPlacement(objectById(state.page, edit.objectId), edit);
    const ratio = asset.height / asset.width;
    let width = current.width;
    let height = width * ratio;
    if (height > current.height) { height = current.height; width = height / ratio; }
    const placement = { ...current, width, height, flipH: false, flipV: false };
    if (edit.type === "image") updateObject({ asset: asset.id, placement }, "Replaced image");
    else updateObject({ replaceAsset: asset.id, placement }, "Replaced image");
  } catch (error) {
    setDocStatus(error.message, true);
  }
}

function createErase(quad) {
  getSampler(state.originalDoc, state.page).then((sampler) => {
    const { bg } = sampleQuad(sampler, quad, { ring: 3 });
    const edit = { id: newId("erase"), type: "erase", page: state.page, quad, color: bg };
    commit([...state.edits, edit], "Erased area");
    state.selection = { kind: "erase", id: edit.id };
    renderPanel();
    drawOverlay();
  });
}

function deleteSelected() {
  const selection = state.selection;
  if (!selection || !state.editable) return;
  if (selection.kind === "run" || selection.kind === "ocr") return applySelectionText(true);
  if (selection.kind === "object") { updateObject({ deleted: true }, "Deleted object"); state.selection = null; renderPanel(); return; }
  if (["image", "added", "erase"].includes(selection.kind)) {
    commit(state.edits.filter((edit) => edit.id !== selection.id), "Deleted");
    state.selection = null;
    renderPanel();
    drawOverlay();
  }
}

/* ---------------------------------------------------------------- panel */

function renderPanel() {
  const panel = $("#properties");
  if (!panel) return;
  const selection = state.selection;
  const profiles = state.analysis[state.page - 1]?.fonts || [];
  let html;
  if (state.tool !== "select") html = renderToolHint(state.tool);
  else if (!selection) html = renderOverview({ capability: state.capability, page: state.page, ocrState: state.ocrState.get(state.page) });
  else if (selection.kind === "run" || selection.kind === "ocr") {
    const report = selection.edited ? state.report.get(`${selection.kind === "run" ? "run" : "ocr"}-${state.page}-${selection.index}`) : null;
    html = renderTextSelection({ selection, profiles, report });
  } else if (selection.kind === "added") {
    const edit = findEdit(selection.id);
    html = edit ? renderAddedText({ edit, profiles, report: state.report.get(edit.id) }) : "";
  } else if (selection.kind === "erase") {
    const edit = findEdit(selection.id);
    html = edit ? renderErase({ edit }) : "";
  } else {
    const edit = currentObjectEdit();
    let ctx;
    if (selection.kind === "image") {
      const asset = state.assets.get(edit.asset);
      ctx = { kindLabel: "Inserted image", detail: asset ? `${asset.width} × ${asset.height} px` : "", placement: edit.placement, edit, rotation: normaliseDegrees(edit.placement.rotation + pageRotation()), lockAspect: state.lockAspect };
    } else {
      const object = objectById(state.page, selection.objectId);
      const placement = objectPlacement(object, edit);
      ctx = {
        kindLabel: object.subtype === "Form" ? "Graphic object" : object.subtype === "Inline" ? "Inline image" : "Image",
        detail: object.subtype === "Image" ? `${object.pixelWidth} × ${object.pixelHeight} px, embedded` : object.subtype === "Form" ? "vector / grouped content" : "embedded in page",
        placement, edit, rotation: normaliseDegrees(placement.rotation + pageRotation()), lockAspect: state.lockAspect, canReset: !!findEdit(edit.id),
      };
    }
    html = renderObject({ ctx });
  }
  if (!state.editable) html = `<p class="notice warn">Editing is unavailable for this encrypted PDF.</p><button class="selection-button wide" data-action="make-image-copy">Make an editable image copy</button>${html}`;
  panel.innerHTML = html || renderOverview({ capability: state.capability, page: state.page, ocrState: state.ocrState.get(state.page) });
}

function onPanelInput(event) {
  const field = event.target.dataset.field;
  const selection = state.selection;
  if (!field || !selection) return;
  if (selection.kind === "added") {
    const value = event.target.value;
    const changes = {
      text: () => ({ text: value }), size: () => ({ size: Number(value) || 12 }), color: () => ({ color: value }),
      rotation: () => ({ rotation: Number(value) || 0 }), opacity: () => ({ opacity: Number(value) }),
    }[field]?.();
    if (changes) debounce("added-input", () => updateAddedText(selection.id, changes, `Edited ${field}`), field === "text" ? 350 : 120);
  }
  if (selection.kind === "image" || selection.kind === "object") {
    if (["opacity"].includes(field)) debounce("obj-input", () => updateObject({ opacity: Number(event.target.value) }, "Opacity", "opacity"), 120);
  }
  if (selection.kind === "erase" && field === "color") debounce("erase", () => { commit(upsert({ ...findEdit(selection.id), color: event.target.value }), "Erase colour", "erase-color"); }, 120);
}

function onPanelChange(event) {
  const field = event.target.dataset.field;
  const selection = state.selection;
  if (!field) return;
  if (field === "ocrLanguage") return;
  if (!selection) return;
  const value = event.target.value;
  if (selection.kind === "run" || selection.kind === "ocr") {
    if (["font", "size", "color", "bg", "opacity"].includes(field) && selection.edited) applySelectionText(false);
    return;
  }
  if (selection.kind === "added" && field === "font") updateAddedText(selection.id, { font: valueToFontSpec(value) }, "Font");
  if (selection.kind === "image" || selection.kind === "object") {
    const edit = currentObjectEdit();
    const placement = edit.type === "image" ? edit.placement : objectPlacement(objectById(state.page, edit.objectId), edit);
    if (field === "lockAspect") { state.lockAspect = event.target.checked; return; }
    if (["x", "y", "width", "height", "rotation"].includes(field)) {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      const next = { ...placement };
      if (field === "x") next.cx = number + placement.width / 2;
      if (field === "y") next.cy = number + placement.height / 2;
      if (field === "width") { next.width = Math.max(1, number); if (state.lockAspect) next.height = placement.height * (next.width / placement.width); }
      if (field === "height") { next.height = Math.max(1, number); if (state.lockAspect) next.width = placement.width * (next.height / placement.height); }
      if (field === "rotation") next.rotation = normaliseDegrees(number - pageRotation());
      updateObject({ placement: next }, "Changed position");
    }
    if (field.startsWith("crop-")) {
      const side = field.slice(5);
      updateObject({ crop: { ...(edit.crop || {}), [side]: Math.min(0.95, Math.max(0, Number(value) / 100 || 0)) } }, "Cropped");
    }
    if (field === "borderWidth" || field === "borderColor") {
      const border = { width: 0, color: "#1f2a44", ...(edit.border || {}) };
      if (field === "borderWidth") border.width = Math.max(0, Number(value) || 0);
      else border.color = value;
      updateObject({ border }, "Border");
    }
    if (field === "z") updateObject({ z: value }, "Layer");
  }
}

function onPanelClick(event) {
  const toggle = event.target.closest("[data-toggle]");
  if (toggle) {
    toggle.classList.toggle("on");
    toggle.setAttribute("aria-pressed", String(toggle.classList.contains("on")));
    const field = toggle.dataset.toggle;
    const selection = state.selection;
    if (selection?.kind === "added") updateAddedText(selection.id, { [field]: toggle.classList.contains("on") }, "Style");
    else if ((selection?.kind === "run" || selection?.kind === "ocr") && selection.edited) applySelectionText(false);
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const edit = currentObjectEdit();
  const placementOf = () => (edit.type === "image" ? edit.placement : objectPlacement(objectById(state.page, edit.objectId), edit));
  switch (action) {
    case "apply-text": applySelectionText(false); break;
    case "delete-text": applySelectionText(true); break;
    case "select-line": selectRunLine(state.selection.index); break;
    case "revert-run": revertRun(); break;
    case "run-ocr": runOCR(); break;
    case "delete-selected": deleteSelected(); break;
    case "choose-image": $("#image-file").click(); break;
    case "replace-image": $("#replace-file").click(); break;
    case "flip-h": updateObject({ placement: { ...placementOf(), flipH: !placementOf().flipH } }, "Flipped"); break;
    case "flip-v": updateObject({ placement: { ...placementOf(), flipV: !placementOf().flipV } }, "Flipped"); break;
    case "rotate-90": updateObject({ placement: { ...placementOf(), rotation: normaliseDegrees(placementOf().rotation + 90) } }, "Rotated"); break;
    case "reset-object": commit(state.edits.filter((item) => item.id !== edit.id), "Reset object"); renderPanel(); drawOverlay(); break;
    case "make-image-copy": makeImageCopy(); break;
    default: break;
  }
}

/* -------------------------------------------------------------- history */

function commit(edits, label, coalesceKey) {
  const now = Date.now();
  const coalesce = coalesceKey && state.lastCommit?.key === coalesceKey && now - state.lastCommit.time < 1500 && state.historyIndex === state.history.length - 1;
  if (coalesce) {
    state.history[state.historyIndex] = edits;
  } else {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(edits);
    state.historyIndex = state.history.length - 1;
  }
  state.lastCommit = { key: coalesceKey, time: now, label };
  state.edits = edits;
  updateHistoryButtons();
  setSaveState("Saving…", "busy");
  scheduleBuild();
}

function undo() {
  if (state.historyIndex === 0) return;
  state.historyIndex -= 1;
  state.edits = state.history[state.historyIndex];
  state.lastCommit = null;
  afterHistoryMove("Undone");
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex += 1;
  state.edits = state.history[state.historyIndex];
  state.lastCommit = null;
  afterHistoryMove("Redone");
}

function afterHistoryMove(message) {
  state.selection = null;
  updateHistoryButtons();
  renderPanel();
  setDocStatus(message);
  scheduleBuild(0);
}

function updateHistoryButtons() {
  const undoButton = $('[data-action="undo"]');
  const redoButton = $('[data-action="redo"]');
  if (undoButton) undoButton.disabled = state.historyIndex === 0;
  if (redoButton) redoButton.disabled = state.historyIndex >= state.history.length - 1;
}

/* ---------------------------------------------------------------- build */

function scheduleBuild(delay = 60) {
  debounce("build", build, delay);
}

let shaperFactoryPromise;
function createShaper(bytes) {
  shaperFactoryPromise ??= getShaperFactory();
  return shaperFactoryPromise.then((factory) => factory(bytes));
}

async function build() {
  if (state.build.running) { state.build.dirty = true; return; }
  state.build.running = true;
  state.build.dirty = false;
  const edits = state.edits;
  const busy = $("#busy-indicator");
  if (busy) busy.hidden = false;
  try {
    let bytes;
    let report = [];
    if (!edits.length) {
      bytes = state.originalBytes;
    } else {
      const result = await applyEdits(state.libs, state.originalBytes, edits, { assets: state.assets, loadFontBytes, createShaper });
      bytes = result.bytes;
      report = result.report;
    }
    // Verification: the working copy is re-opened by an independent parser (PDF.js).
    const workingDoc = bytes === state.originalBytes ? state.originalDoc : await openPDFBytes(bytes, { checkLimits: false });
    if (workingDoc.numPages !== state.originalDoc.numPages) throw new Error("The edited copy failed verification (page count changed).");
    const previous = state.workingDoc;
    state.workingDoc = workingDoc;
    state.workingBytes = bytes;
    if (previous && previous !== state.originalDoc && previous !== workingDoc) previous.destroy().catch(() => {});
    state.report = new Map(report.map((item) => [item.id, item]));
    const errors = report.filter((item) => item.error);
    setSaveState(edits.length ? `${edits.length} edit${edits.length === 1 ? "" : "s"} · verified` : "Original safe", errors.length ? "warn" : "ok");
    if (errors.length) setDocStatus(errors[0].error, true);
    await paint({ thumbnails: true });
    if (state.selection && !state.drag) renderPanelPreservingFocus();
    autosave();
  } catch (error) {
    setSaveState("Edit failed", "warn");
    setDocStatus(error instanceof Error ? error.message : "This edit couldn't be applied.", true, true);
  } finally {
    if (busy) busy.hidden = true;
    state.build.running = false;
    if (state.build.dirty) build();
  }
}

function renderPanelPreservingFocus() {
  const active = document.activeElement;
  const field = active?.dataset?.field;
  if (field && $("#properties").contains(active)) {
    // Only refresh the font notice while the user is typing.
    const selection = state.selection;
    const id = selection?.kind === "added" ? selection.id : selection?.kind === "run" ? `run-${state.page}-${selection.index}` : selection?.kind === "ocr" ? `ocr-${state.page}-${selection.index}` : null;
    const notice = $("#properties .notice:not(:first-child)") || $("#properties .notice");
    if (id && notice && state.report.get(id)) {
      const report = state.report.get(id);
      notice.className = `notice ${report.fallback ? "warn" : "ok"}`;
      notice.textContent = report.fallback ? `Using ${report.font}. ${report.fallback}` : `✓ Written with ${report.font}${report.sameFont ? " — the same font as the PDF" : ""}.`;
    }
    return;
  }
  renderPanel();
}

function autosave() {
  debounce("autosave", async () => {
    if (!state.originalBytes) return;
    if (!state.edits.length) { await clearSession(); return; }
    const used = new Set(state.edits.flatMap((edit) => [edit.asset, edit.replaceAsset]).filter(Boolean));
    const assets = [...state.assets.values()].filter((asset) => used.has(asset.id)).map(({ url, ...asset }) => asset);
    const ok = await saveSession({ fileName: state.fileName, originalBytes: state.originalBytes, edits: state.edits, assets });
    if (!ok) setDocStatus("Autosave is unavailable in this browser; download your PDF before closing.", true);
  }, 800);
}

/* ------------------------------------------------------------- downloads */

function toggleDownloads(event) {
  event.stopPropagation();
  const popover = $("#download-popover");
  popover.hidden = !popover.hidden;
  $('[data-action="toggle-downloads"]').setAttribute("aria-expanded", String(!popover.hidden));
}

function closeDownloads() {
  $("#download-popover").hidden = true;
  $('[data-action="toggle-downloads"]').setAttribute("aria-expanded", "false");
}

async function handleDownload(kind) {
  const status = $("#download-status");
  const scale = Number($("#export-quality").value) || PRODUCT.exportScales.standard;
  const name = baseName(state.fileName);
  try {
    if (state.build.running) { status.textContent = "Finishing your last edit…"; await waitForBuild(); }
    if (kind === "pdf") { downloadPDFBytes(state.workingBytes, state.edits.length ? `${name}-edited.pdf` : `${name}.pdf`); status.textContent = "PDF downloaded."; return; }
    if (kind === "original") { downloadPDFBytes(state.originalBytes, `${name}.pdf`); status.textContent = "Original downloaded."; return; }
    const [scope, format] = kind.split("-");
    const pages = scope === "page" ? [state.page] : Array.from({ length: state.workingDoc.numPages }, (_, index) => index + 1);
    await exportPages(state.workingDoc, pages, format, {
      scale, fileName: state.fileName,
      onProgress: (done, total) => { status.textContent = done < total ? `Rendering page ${done + 1} of ${total}…` : "Download ready."; },
    });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The download failed.";
  }
}

function waitForBuild() {
  return new Promise((resolve) => {
    const check = () => (state.build.running ? setTimeout(check, 100) : resolve());
    check();
  });
}

/** Fallback for PDFs pdf-lib can't rewrite (encrypted): rebuild pages as images. */
async function makeImageCopy() {
  setDocStatus("Creating an editable image copy…", false, true);
  try {
    const { PDFLib } = state.libs;
    const pdfDoc = await PDFLib.PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= state.originalDoc.numPages; pageNumber += 1) {
      const { canvas, viewport } = await renderPageCanvas(state.originalDoc, pageNumber, 2.5);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      const image = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const page = pdfDoc.addPage([viewport.width / 2.5, viewport.height / 2.5]);
      page.drawImage(image, { x: 0, y: 0, width: viewport.width / 2.5, height: viewport.height / 2.5 });
      canvas.width = 0;
    }
    const bytes = await pdfDoc.save();
    await openDocument({ fileName: `${baseName(state.fileName)}-image-copy.pdf`, fileSize: bytes.length, bytes });
    setDocStatus("Editable image copy created. Use OCR to edit its text.", false);
  } catch (error) {
    setDocStatus(error instanceof Error ? error.message : "The image copy couldn't be created.", true);
  }
}

/* ------------------------------------------------------------- keyboard */

function handleKeys(event) {
  if (!state.originalDoc) return;
  const typing = event.target.matches("input, textarea, select, [contenteditable='true']");
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "z" && !typing) { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
  if (mod && event.key.toLowerCase() === "y" && !typing) { event.preventDefault(); redo(); return; }
  if (typing) return;
  if ((event.key === "Delete" || event.key === "Backspace") && state.selection) { event.preventDefault(); deleteSelected(); return; }
  if (event.key === "Escape") { state.selection = null; setTool("select"); return; }
  if (event.key === "ArrowLeft" || event.key === "PageUp") goToPage(state.page - 1);
  if (event.key === "ArrowRight" || event.key === "PageDown") goToPage(state.page + 1);
  if (event.key === "+" || event.key === "=") setZoom(state.scale * 1.15);
  if (event.key === "-") setZoom(state.scale / 1.15);
  const tools = { v: "select", t: "addText", i: "image", e: "erase" };
  if (!mod && tools[event.key.toLowerCase()]) setTool(tools[event.key.toLowerCase()]);
}

document.addEventListener("keydown", handleKeys);
window.addEventListener("beforeunload", (event) => {
  if (state.edits.length && state.build.running) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("resize", () => debounce("resize", () => drawOverlay(), 150));

// Exposed for automated browser tests only.
if (new URLSearchParams(location.search).has("test")) globalThis.__pdfora = { state, loadBytes: (bytes, fileName = "test.pdf") => openDocument({ fileName, fileSize: bytes.length, bytes }) };

showLanding();
