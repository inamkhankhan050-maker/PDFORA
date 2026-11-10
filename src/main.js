import { PRODUCT } from "./config.js";
import { renderLanding } from "./components/landing.js";
import { renderEditorShell, renderEditorPage, renderPageThumbnails } from "./components/editor.js";
import { exportPDFWithText, formatBytes, openPDF, renderSelectableText, validatePDFFile } from "./services/pdf-service.js";
import { recognizePDFPage } from "./services/ocr-service.js";

const app = document.querySelector("#app");
const state = { document: null, file: null, page: 1, scale: 1, pageDimensions: null, pageTransform: null, edits: [], selectedWord: null, ocrByPage: new Map(), addTextMode: false, dragDepth: 0 };

function showLanding(message = "") {
  if (state.document) state.document.destroy().catch(() => {});
  state.document = null;
  state.file = null;
  state.edits = [];
  state.selectedWord = null;
  state.ocrByPage = new Map();
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

async function loadFile(file, password = "") {
  const validation = validatePDFFile(file);
  if (!validation.ok) return setUploadMessage(validation.message, true);
  setUploadMessage(`Checking ${file.name}…`);
  try {
    const documentProxy = await openPDF(file, password);
    state.document = documentProxy;
    state.file = file;
    state.page = 1;
    state.scale = 1;
    state.edits = [];
    state.selectedWord = null;
    state.ocrByPage = new Map();
    state.addTextMode = false;
    app.innerHTML = renderEditorShell(file, documentProxy.numPages);
    bindEditor();
    renderPageThumbnails(documentProxy, document.querySelector("#page-list"), state.page, goToPage);
    await paintPage();
  } catch (error) {
    if (error?.name === "PasswordException") {
      const enteredPassword = await requestPDFPassword(error.code === 2);
      if (enteredPassword !== null) return loadFile(file, enteredPassword);
      setUploadMessage(`Opening ${file.name} was cancelled.`);
      return;
    }
    setUploadMessage(error instanceof Error ? error.message : "PDFora couldn't open this file.", true);
  }
}

function requestPDFPassword(incorrect = false) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "password-dialog";
    dialog.innerHTML = `
      <form class="password-form">
        <div class="password-icon" aria-hidden="true">🔒</div>
        <h2>Password-protected PDF</h2>
        <p>${incorrect ? "That password didn't work. Try again." : "Enter the password to open this PDF."}</p>
        <label for="pdf-password">PDF password</label>
        <input id="pdf-password" type="password" autocomplete="current-password" required />
        <div class="password-actions">
          <button class="password-cancel" type="button">Cancel</button>
          <button class="password-submit" type="submit">Open PDF</button>
        </div>
      </form>`;
    const form = dialog.querySelector(".password-form");
    const input = dialog.querySelector("#pdf-password");
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    dialog.querySelector(".password-cancel").addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
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
  document.querySelector('[data-action="export-jpg"]').addEventListener("click", () => exportEditedPageImage("jpg"));
  document.querySelector('[data-action="export-png"]').addEventListener("click", () => exportEditedPageImage("png"));
  document.querySelector("#pdf-canvas").addEventListener("click", placeText);
  document.querySelector("#selectable-text-layer").addEventListener("click", selectWord);
  document.querySelector('[data-action="replace-word"]').addEventListener("click", () => applyWordEdit(false));
  document.querySelector('[data-action="delete-word"]').addEventListener("click", () => applyWordEdit(true));
  document.querySelector('[data-action="run-ocr"]').addEventListener("click", runOCR);
  document.querySelector("#replacement-text").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyWordEdit(false);
    }
  });
  document.querySelector("#page-stage").addEventListener("wheel", handleTrackpadZoom, { passive: false });
}

async function paintPage() {
  const canvas = document.querySelector("#pdf-canvas");
  if (!canvas || !state.document) return;
  try {
    state.pageDimensions = await renderEditorPage(state.document, state.page, state.scale, canvas);
    state.pageTransform = state.pageDimensions.transform;
    const textReport = await renderSelectableText(state.document, state.page, state.scale, document.querySelector("#selectable-text-layer"));
    const ocrWords = state.ocrByPage.get(state.page) || [];
    appendOCRWordSpans(ocrWords);
    document.querySelector("#current-page").textContent = String(state.page);
    document.querySelector("#zoom-label").textContent = `${Math.round(state.scale * 100)}%`;
    renderPageThumbnails(state.document, document.querySelector("#page-list"), state.page, goToPage);
    document.querySelector('[data-action="prev-page"]').disabled = state.page <= 1;
    document.querySelector('[data-action="next-page"]').disabled = state.page >= state.document.numPages;
    renderTextOverlays();
    renderSelectedWord();
    if (!state.selectedWord) {
      document.querySelector("#selection-hint").textContent = textReport.wordCount === 0 && !ocrWords.length
        ? "This page has no selectable text yet. Choose the page language and run OCR to enable word edits."
        : "Click a word to select it, or drag across native PDF text to select several words.";
    }
    updateEditControls();
  } catch {
    const stage = document.querySelector("#page-stage");
    if (stage) stage.innerHTML = '<div class="canvas-error">This page could not be rendered. Try another page or PDF.</div>';
  }
}

function appendOCRWordSpans(words) {
  if (!words.length || !state.pageDimensions) return;
  const layer = document.querySelector("#selectable-text-layer");
  const canvas = document.querySelector("#pdf-canvas");
  const scaleX = canvas.clientWidth / state.pageDimensions.width;
  const scaleY = canvas.clientHeight / state.pageDimensions.height;
  const [a, b, c, d, e, f] = state.pageTransform;
  for (const word of words) {
    const { x, y, width, height } = word.box;
    const points = [[x,y],[x+width,y],[x,y+height],[x+width,y+height]].map(([px,py]) => [a*px+c*py+e,b*px+d*py+f]);
    const xs = points.map(([px]) => px);
    const ys = points.map(([,py]) => py);
    const span = document.createElement("span");
    span.className = "selectable-text-item ocr-word";
    span.textContent = word.text;
    span.dataset.source = "ocr";
    span.dataset.fontSize = String(word.size);
    span.dataset.confidence = String(word.confidence);
    span.dataset.pdfX = String(x);
    span.dataset.pdfY = String(y);
    span.dataset.pdfWidth = String(width);
    span.dataset.pdfHeight = String(height);
    span.style.left = `${Math.min(...xs) * scaleX}px`;
    span.style.top = `${Math.min(...ys) * scaleY}px`;
    span.style.width = `${Math.max(...xs) - Math.min(...xs)}px`;
    span.style.height = `${Math.max(...ys) - Math.min(...ys)}px`;
    span.style.fontSize = `${Math.max(8, (Math.max(...ys) - Math.min(...ys)) * scaleY)}px`;
    layer.append(span);
  }
}

async function runOCR() {
  const button = document.querySelector('[data-action="run-ocr"]');
  const status = document.querySelector("#ocr-status");
  const language = document.querySelector("#ocr-language").value;
  button.disabled = true;
  status.textContent = "Preparing this page…";
  try {
    const words = await recognizePDFPage(state.document, state.page, language, (progress) => {
      const percent = Number.isFinite(progress.progress) ? ` ${Math.round(progress.progress * 100)}%` : "";
      const stage = progress.status === "recognizing text" ? "Reading text" : "Loading OCR";
      status.textContent = `${stage}${percent}…`;
    });
    state.ocrByPage.set(state.page, words);
    state.selectedWord = null;
    document.querySelector("#selection-tools").hidden = true;
    await paintPage();
    status.textContent = words.length
      ? `Found ${words.length} words. Click a word to edit it; verify OCR spelling before applying.`
      : "No words found. Try another language or a clearer scan.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "OCR couldn't read this page.";
  } finally {
    button.disabled = false;
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
  const x = (event.clientX - rect.left) * state.pageDimensions.width / rect.width;
  const y = (event.clientY - rect.top) * state.pageDimensions.height / rect.height;
  const [pdfX, pdfY] = inverseTransformPoint(x, y, state.pageTransform);
  const command = {
    type: "addText",
    page: state.page,
    x: pdfX,
    y: pdfY,
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

function selectWord(event) {
  if (state.addTextMode) return;
  const item = event.target.closest(".selectable-text-item");
  if (!item) return;
  event.preventDefault();
  if (item.dataset.source === "ocr") {
    const box = {
      x: Number(item.dataset.pdfX), y: Number(item.dataset.pdfY),
      width: Number(item.dataset.pdfWidth), height: Number(item.dataset.pdfHeight),
    };
    state.selectedWord = {
      id: `${state.page}-${Date.now()}`, page: state.page, text: item.textContent || "", box,
      size: Number(item.dataset.fontSize) || 12, source: "ocr", confidence: Number(item.dataset.confidence) || 0,
    };
    showWordSelection(state.selectedWord);
    return;
  }
  let offset = 0;
  const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (caret && item.contains(caret.startContainer)) {
    offset = caret.startOffset;
  } else {
    const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    if (position && item.contains(position.offsetNode)) offset = position.offset;
  }
  const text = item.textContent || "";
  const words = [...text.matchAll(/\S+/g)];
  const selected = words.find((word) => offset >= word.index && offset <= word.index + word[0].length) || words[0];
  if (!selected) return;
  const range = document.createRange();
  range.setStart(item.firstChild, selected.index);
  range.setEnd(item.firstChild, selected.index + selected[0].length);
  const rect = range.getBoundingClientRect();
  const canvas = document.querySelector("#pdf-canvas");
  const canvasRect = canvas.getBoundingClientRect();
  const scaleX = state.pageDimensions.width / canvasRect.width;
  const scaleY = state.pageDimensions.height / canvasRect.height;
  const screenBox = {
    x: (rect.left - canvasRect.left),
    y: (rect.top - canvasRect.top),
    width: rect.width,
    height: rect.height,
  };
  const points = [
    [screenBox.x * scaleX, screenBox.y * scaleY],
    [(screenBox.x + screenBox.width) * scaleX, screenBox.y * scaleY],
    [screenBox.x * scaleX, (screenBox.y + screenBox.height) * scaleY],
    [(screenBox.x + screenBox.width) * scaleX, (screenBox.y + screenBox.height) * scaleY],
  ].map(([x, y]) => inverseTransformPoint(x, y, state.pageTransform));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const padding = 0.6;
  const box = {
    x: Math.min(...xs) - padding,
    y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2,
    height: Math.max(...ys) - Math.min(...ys) + padding * 2,
  };
  state.selectedWord = {
    id: `${state.page}-${selected.index}-${Date.now()}`,
    page: state.page,
    text: selected[0],
    box,
    screenBox,
    size: Number(item.dataset.fontSize) || 12,
  };
  showWordSelection(state.selectedWord);
}

function showWordSelection(selected) {
  document.querySelector("#replacement-text").value = selected.text;
  document.querySelector("#selection-tools").hidden = false;
  document.querySelector("#selection-hint").textContent = `Selected “${selected.text}” on page ${state.page}${selected.source === "ocr" ? ` · OCR confidence ${selected.confidence}%` : ""}.`;
  document.querySelector("#edit-status").textContent = "Change the word or delete it, then export a copy.";
  renderSelectedWord();
  const input = document.querySelector("#replacement-text");
  input.focus();
  input.select();
}

function inverseTransformPoint(x, y, transform) {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  return [(d * (x - e) - c * (y - f)) / determinant, (-b * (x - e) + a * (y - f)) / determinant];
}

function applyWordEdit(deleteWord) {
  const selected = state.selectedWord;
  if (!selected) return;
  const replacement = deleteWord ? "" : document.querySelector("#replacement-text").value;
  state.edits.push({
    type: "replaceWord",
    page: selected.page,
    originalWord: selected.text,
    replacement,
    x: selected.box.x,
    y: selected.box.y + selected.box.height * 0.18,
    maskY: selected.box.y,
    width: selected.box.width,
    height: selected.box.height,
    size: selected.size,
    color: document.querySelector("#text-color").value,
  });
  document.querySelector("#edit-status").textContent = deleteWord ? `Masked “${selected.text}” visually in the working copy.` : `Replaced “${selected.text}” visually. Font and spacing may differ.`;
  state.selectedWord = null;
  document.querySelector("#selection-tools").hidden = true;
  document.querySelector("#selection-hint").textContent = "Select another word, or add new text below.";
  renderTextOverlays();
  renderSelectedWord();
  updateEditControls();
}

function renderTextOverlays() {
  const layer = document.querySelector("#text-overlay-layer");
  if (!layer || !state.pageTransform) return;
  layer.replaceChildren();
  const [a, b, c, d, e, f] = state.pageTransform;
  const canvas = document.querySelector("#pdf-canvas");
  const pageScaleX = canvas.clientWidth / state.pageDimensions.width;
  const pageScaleY = canvas.clientHeight / state.pageDimensions.height;
  for (const edit of state.edits.filter((item) => item.page === state.page)) {
    if (edit.type === "replaceWord") {
      const points = [
        [edit.x, edit.maskY ?? edit.y], [edit.x + edit.width, edit.maskY ?? edit.y],
        [edit.x, (edit.maskY ?? edit.y) + edit.height], [edit.x + edit.width, (edit.maskY ?? edit.y) + edit.height],
      ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const mask = document.createElement("span");
      mask.className = "word-mask";
      mask.style.left = `${Math.min(...xs) * pageScaleX}px`;
      mask.style.top = `${Math.min(...ys) * pageScaleY}px`;
      mask.style.width = `${(Math.max(...xs) - Math.min(...xs)) * pageScaleX}px`;
      mask.style.height = `${(Math.max(...ys) - Math.min(...ys)) * pageScaleY}px`;
      layer.append(mask);
      if (edit.replacement) {
        const replacement = document.createElement("span");
        replacement.className = "placed-text";
        replacement.textContent = edit.replacement;
        replacement.style.left = `${(a * edit.x + c * edit.y + e) * pageScaleX}px`;
        replacement.style.top = `${(b * edit.x + d * edit.y + f - edit.size * state.scale * 0.9) * pageScaleY}px`;
        replacement.style.fontSize = `${edit.size * state.scale * pageScaleY}px`;
        replacement.style.color = edit.color;
        layer.append(replacement);
      }
      continue;
    }
    const node = document.createElement("span");
    node.className = "placed-text";
    node.textContent = edit.text;
    node.style.left = `${(a * edit.x + c * edit.y + e) * pageScaleX}px`;
    node.style.top = `${(b * edit.x + d * edit.y + f - edit.size * state.scale * 0.9) * pageScaleY}px`;
    node.style.fontSize = `${edit.size * state.scale * pageScaleY}px`;
    node.style.color = edit.color;
    layer.append(node);
  }
}

function renderSelectedWord() {
  const layer = document.querySelector("#text-overlay-layer");
  const selected = state.selectedWord;
  if (!layer || !selected || selected.page !== state.page || !state.pageDimensions) return;
  const canvas = document.querySelector("#pdf-canvas");
  const scaleX = canvas.clientWidth / state.pageDimensions.width;
  const scaleY = canvas.clientHeight / state.pageDimensions.height;
  const [a, b, c, d, e, f] = state.pageTransform;
  const points = [
    [selected.box.x, selected.box.y], [selected.box.x + selected.box.width, selected.box.y],
    [selected.box.x, selected.box.y + selected.box.height], [selected.box.x + selected.box.width, selected.box.y + selected.box.height],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const highlight = document.createElement("span");
  highlight.className = "selected-word-highlight";
  highlight.style.left = `${Math.min(...xs) * scaleX}px`;
  highlight.style.top = `${Math.min(...ys) * scaleY}px`;
  highlight.style.width = `${(Math.max(...xs) - Math.min(...xs)) * scaleX}px`;
  highlight.style.height = `${(Math.max(...ys) - Math.min(...ys)) * scaleY}px`;
  layer.append(highlight);
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
  document.querySelector("#edit-status").textContent = "Undid the last edit.";
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

async function exportEditedPageImage(format) {
  const status = document.querySelector("#edit-status");
  status.textContent = `Preparing page ${state.page} as ${format.toUpperCase()}…`;
  try {
    const page = await state.document.getPage(state.page);
    const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const maxPixels = 30_000_000;
    const scale = Math.min(2, Math.sqrt(maxPixels / (baseViewport.width * baseViewport.height)));
    const viewport = page.getViewport({ scale, rotation: page.rotate });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser couldn't create an image export canvas.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const [a, b, c, d, e, f] = viewport.transform;
    for (const edit of state.edits.filter((item) => item.page === state.page)) {
      context.save();
      context.setTransform(a, b, c, d, e, f);
      if (edit.type === "replaceWord") {
        context.fillStyle = "#ffffff";
        context.fillRect(edit.x, edit.maskY ?? edit.y, edit.width, edit.height);
        if (edit.replacement) {
          context.fillStyle = edit.color;
          context.font = `${edit.size}px Helvetica, Arial, sans-serif`;
          context.textBaseline = "alphabetic";
          context.fillText(edit.replacement, edit.x, edit.y);
        }
      } else {
        context.fillStyle = edit.color;
        context.font = `${edit.size}px Helvetica, Arial, sans-serif`;
        context.textBaseline = "alphabetic";
        context.fillText(edit.text, edit.x, edit.y);
      }
      context.restore();
    }
    const mime = format === "jpg" ? "image/jpeg" : "image/png";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.94));
    if (!blob) throw new Error("The browser couldn't encode this page as an image.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const basename = state.file.name.replace(/\.pdf$/i, "") || "pdfora-page";
    link.href = url;
    link.download = `${basename}-page-${state.page}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Downloaded page ${state.page} as ${format.toUpperCase()} with visible edits.`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The page image couldn't be exported.";
  }
}

function goToPage(page) {
  if (!state.document || page < 1 || page > state.document.numPages || page === state.page) return;
  state.page = page;
  state.selectedWord = null;
  document.querySelector("#selection-tools").hidden = true;
  document.querySelector("#selection-hint").textContent = "Select a word in the page, or add new text below.";
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
