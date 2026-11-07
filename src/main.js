import { PRODUCT } from "./config.js";
import { renderLanding } from "./components/landing.js";
import { renderEditorShell, renderEditorPage, renderPageThumbnails } from "./components/editor.js";
import { exportPDFWithText, formatBytes, openPDF, validatePDFFile } from "./services/pdf-service.js";

const app = document.querySelector("#app");
const state = { document: null, file: null, page: 1, scale: 1, pageDimensions: null, pageTransform: null, edits: [], addTextMode: false, dragDepth: 0 };

function showLanding(message = "") {
  if (state.document) state.document.destroy().catch(() => {});
  state.document = null;
  state.file = null;
  state.edits = [];
  state.addTextMode = false;
  app.innerHTML = renderLanding();
  if (message) setUploadMessage(message, true);
  bindLanding();
}

function setUploadMessage(message, error = false) {
  const status = document.querySelector("#upload-message");
  if (status) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }
}

async function loadFile(file) {
  const validation = validatePDFFile(file);
  if (!validation.ok) return setUploadMessage(validation.message, true);
  setUploadMessage(`Checking ${file.name}…`);
  try {
    const documentProxy = await openPDF(file);
    state.document = documentProxy;
    state.file = file;
    state.page = 1;
    state.scale = 1;
    state.edits = [];
    state.addTextMode = false;
    app.innerHTML = renderEditorShell(file, documentProxy.numPages);
    bindEditor();
    renderPageThumbnails(documentProxy, document.querySelector("#page-list"), state.page, goToPage);
    await paintPage();
  } catch (error) {
    setUploadMessage(error instanceof Error ? error.message : "PDFora couldn't open this file.", true);
  }
}

function bindLanding() {
  const input = document.querySelector("#pdf-file");
  document.querySelectorAll('[data-action="choose-file"]').forEach((button) => button.addEventListener("click", () => input.click()));
  input.addEventListener("change", (event) => {
    const [file] = event.currentTarget.files;
    if (file) loadFile(file);
    event.currentTarget.value = "";
  });
  const card = document.querySelector(".upload-card");
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
}

function bindEditor() {
  document.querySelectorAll('[data-action="close-document"]').forEach((button) => button.addEventListener("click", () => showLanding()));
  document.querySelector('[data-action="prev-page"]').addEventListener("click", () => goToPage(state.page - 1));
  document.querySelector('[data-action="next-page"]').addEventListener("click", () => goToPage(state.page + 1));
  document.querySelector('[data-action="zoom-in"]').addEventListener("click", () => setZoom(state.scale + 0.1));
  document.querySelector('[data-action="zoom-out"]').addEventListener("click", () => setZoom(state.scale - 0.1));
  document.querySelector('[data-action="fit-page"]').addEventListener("click", fitPage);
  document.querySelector('[data-action="download-original"]').addEventListener("click", downloadOriginal);
  document.querySelectorAll('[data-action="add-text-mode"]').forEach((button) => button.addEventListener("click", activateTextPlacement));
  document.querySelector('[data-action="undo-edit"]').addEventListener("click", undoEdit);
  document.querySelector('[data-action="export-pdf"]').addEventListener("click", exportEditedPDF);
  document.querySelector("#pdf-canvas").addEventListener("click", placeText);
  document.querySelector("#page-stage").addEventListener("wheel", handleTrackpadZoom, { passive: false });
}

async function paintPage() {
  const canvas = document.querySelector("#pdf-canvas");
  if (!canvas || !state.document) return;
  try {
    state.pageDimensions = await renderEditorPage(state.document, state.page, state.scale, canvas);
    state.pageTransform = state.pageDimensions.transform;
    document.querySelector("#current-page").textContent = String(state.page);
    document.querySelector("#zoom-label").textContent = `${Math.round(state.scale * 100)}%`;
    renderPageThumbnails(state.document, document.querySelector("#page-list"), state.page, goToPage);
    document.querySelector('[data-action="prev-page"]').disabled = state.page <= 1;
    document.querySelector('[data-action="next-page"]').disabled = state.page >= state.document.numPages;
    renderTextOverlays();
    updateEditControls();
  } catch {
    const stage = document.querySelector("#page-stage");
    if (stage) stage.innerHTML = '<div class="canvas-error">This page could not be rendered. Try another page or PDF.</div>';
  }
}

function activateTextPlacement() {
  const text = document.querySelector("#text-content").value.trim();
  const size = Number(document.querySelector("#text-size").value);
  const status = document.querySelector("#edit-status");
  if (!text) {
    status.textContent = "Enter text first, then choose where to place it.";
    document.querySelector("#text-content").focus();
    return;
  }
  if (!Number.isFinite(size) || size < 6 || size > 96) {
    status.textContent = "Choose a text size from 6 to 96 points.";
    return;
  }
  state.addTextMode = true;
  document.querySelector("#page-stage").classList.add("placing-text");
  status.textContent = "Click the page where the new text should begin.";
}

function placeText(event) {
  if (!state.addTextMode || !state.pageTransform) return;
  const text = document.querySelector("#text-content").value.trim();
  if (!text) return;
  const size = Number(document.querySelector("#text-size").value);
  const color = document.querySelector("#text-color").value;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const [a, b, c, d, e, f] = state.pageTransform;
  const determinant = a * d - b * c;
  if (!determinant) return;
  const command = {
    page: state.page,
    x: (d * (x - e) - c * (y - f)) / determinant,
    y: (-b * (x - e) + a * (y - f)) / determinant,
    text,
    size,
    color,
  };
  state.edits.push(command);
  state.addTextMode = false;
  document.querySelector("#page-stage").classList.remove("placing-text");
  document.querySelector("#edit-status").textContent = `Added text to page ${state.page}. Use Undo to remove it.`;
  renderTextOverlays();
  updateEditControls();
}

function renderTextOverlays() {
  const layer = document.querySelector("#text-overlay-layer");
  if (!layer || !state.pageTransform) return;
  layer.replaceChildren();
  const [a, b, c, d, e, f] = state.pageTransform;
  for (const edit of state.edits.filter((item) => item.page === state.page)) {
    const node = document.createElement("span");
    node.className = "placed-text";
    node.textContent = edit.text;
    node.style.left = `${a * edit.x + c * edit.y + e}px`;
    node.style.top = `${b * edit.x + d * edit.y + f - edit.size * state.scale * 0.9}px`;
    node.style.fontSize = `${edit.size * state.scale}px`;
    node.style.color = edit.color;
    layer.append(node);
  }
}

function updateEditControls() {
  const undo = document.querySelector('[data-action="undo-edit"]');
  const exportButton = document.querySelector('[data-action="export-pdf"]');
  if (!undo || !exportButton) return;
  undo.disabled = state.edits.length === 0;
  exportButton.disabled = state.edits.length === 0;
}

function undoEdit() {
  const edit = state.edits.pop();
  if (!edit) return;
  state.addTextMode = false;
  document.querySelector("#page-stage").classList.remove("placing-text");
  document.querySelector("#edit-status").textContent = "Removed the last text addition.";
  renderTextOverlays();
  updateEditControls();
}

async function exportEditedPDF() {
  const button = document.querySelector('[data-action="export-pdf"]');
  const status = document.querySelector("#edit-status");
  button.disabled = true;
  status.textContent = "Preparing your edited copy…";
  try {
    const bytes = await exportPDFWithText(state.file, state.edits);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${state.file.name.replace(/\.pdf$/i, "")}-edited.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    status.textContent = "Edited copy downloaded. The original is unchanged.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The edited PDF couldn't be exported.";
  } finally {
    button.disabled = state.edits.length === 0;
  }
}

function goToPage(page) {
  if (!state.document || page < 1 || page > state.document.numPages || page === state.page) return;
  state.page = page;
  paintPage();
  document.querySelector("#page-stage")?.scrollTo({ top: 0, behavior: "smooth" });
}

function setZoom(scale) {
  state.scale = Math.min(4, Math.max(0.25, Math.round(scale * 100) / 100));
  paintPage();
}

function fitPage() {
  const stage = document.querySelector("#page-stage");
  if (!stage || !state.document) return;
  state.document.getPage(state.page).then((page) => {
    const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const padding = window.innerWidth < 760 ? 32 : 88;
    setZoom(Math.min((stage.clientWidth - padding) / viewport.width, (stage.clientHeight - padding) / viewport.height, 2));
  });
}

function handleTrackpadZoom(event) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    setZoom(state.scale + (event.deltaY < 0 ? 0.05 : -0.05));
  }
}

function handleEditorKeys(event) {
  if (!state.document || event.target.matches("input, textarea, select, [contenteditable='true']")) return;
  if (event.key === "ArrowLeft" || event.key === "PageUp") goToPage(state.page - 1);
  if (event.key === "ArrowRight" || event.key === "PageDown") goToPage(state.page + 1);
  if (event.key === "+" || event.key === "=") setZoom(state.scale + 0.1);
  if (event.key === "-") setZoom(state.scale - 0.1);
}

function downloadOriginal() {
  if (!state.file) return;
  const url = URL.createObjectURL(state.file);
  const link = document.createElement("a");
  link.href = url;
  link.download = state.file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener("keydown", handleEditorKeys);
showLanding();
