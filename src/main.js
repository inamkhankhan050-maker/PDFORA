import { PRODUCT } from "./config.js";
import { renderLanding } from "./components/landing.js";
import { renderEditorShell, renderEditorPage, renderPageThumbnails } from "./components/editor.js";
import { formatBytes, openPDF, validatePDFFile } from "./services/pdf-service.js";

const app = document.querySelector("#app");
const state = { document: null, file: null, page: 1, scale: 1, pageDimensions: null, dragDepth: 0 };

function showLanding(message = "") {
  if (state.document) state.document.destroy().catch(() => {});
  state.document = null;
  state.file = null;
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
  document.querySelector("#page-stage").addEventListener("wheel", handleTrackpadZoom, { passive: false });
}

async function paintPage() {
  const canvas = document.querySelector("#pdf-canvas");
  if (!canvas || !state.document) return;
  try {
    state.pageDimensions = await renderEditorPage(state.document, state.page, state.scale, canvas);
    document.querySelector("#current-page").textContent = String(state.page);
    document.querySelector("#zoom-label").textContent = `${Math.round(state.scale * 100)}%`;
    renderPageThumbnails(state.document, document.querySelector("#page-list"), state.page, goToPage);
    document.querySelector('[data-action="prev-page"]').disabled = state.page <= 1;
    document.querySelector('[data-action="next-page"]').disabled = state.page >= state.document.numPages;
  } catch {
    const stage = document.querySelector("#page-stage");
    if (stage) stage.innerHTML = '<div class="canvas-error">This page could not be rendered. Try another page or PDF.</div>';
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
