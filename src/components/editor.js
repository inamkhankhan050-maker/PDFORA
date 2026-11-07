import { formatBytes, renderPage } from "../services/pdf-service.js";

export function renderEditorShell(file, pageCount) {
  const name = file.name.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  return `
    <div class="editor-shell">
      <header class="editor-topbar">
        <a class="brand" href="#home" data-action="close-document"><span class="brand-mark">P</span><span>PDF<span class="brand-light">ora</span></span></a>
        <div class="document-name"><span class="document-file-icon">PDF</span><span class="document-title" title="${name}">${name}</span><span class="save-state"><i></i> Original safe</span></div>
        <div class="editor-actions"><button class="icon-button" data-action="close-document" aria-label="Close document" title="Close document">×</button></div>
      </header>
      <main class="editor-layout">
        <aside class="page-rail"><div class="rail-heading">PAGES <span>${pageCount}</span></div><div id="page-list" class="page-list"></div><button class="back-link" data-action="close-document">← Back to home</button></aside>
        <section class="document-area">
          <div class="document-toolbar">
            <div class="toolbar-file"><span class="toolbar-file-icon">▤</span><span>${name}</span><small>${formatBytes(file.size)}</small></div>
            <div class="toolbar-controls">
              <button class="toolbar-action" data-action="add-text-mode">＋ <span>Add text</span></button>
              <button class="toolbar-action" data-action="undo-edit" disabled>↶ <span>Undo</span></button>
              <button class="toolbar-action export-action" data-action="export-pdf" disabled aria-label="Download edited PDF" title="Download edited PDF">↓ <span>PDF</span></button>
              <button class="toolbar-action image-action" data-action="export-png" aria-label="Download current page as PNG" title="Download current page as PNG">▧ <span>PNG</span></button>
              <button class="toolbar-action image-action" data-action="export-jpg" aria-label="Download current page as JPG" title="Download current page as JPG">▧ <span>JPG</span></button>
              <span class="toolbar-separator"></span>
              <button class="icon-button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
              <span id="zoom-label">100%</span>
              <button class="icon-button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
              <button class="fit-button" data-action="fit-page">Fit</button>
            </div>
          </div>
          <div class="page-stage" id="page-stage">
            <div class="pdf-page-frame">
              <canvas id="pdf-canvas" aria-label="PDF page preview"></canvas>
              <div id="selectable-text-layer" class="selectable-text-layer"></div>
              <div id="text-overlay-layer" class="text-overlay-layer"></div>
              <div class="page-watermark">Preview · original file unchanged</div>
            </div>
          </div>
          <div class="page-controls">
            <button class="page-nav-button" data-action="prev-page" aria-label="Previous page">‹</button>
            <span>Page <strong id="current-page">1</strong> of <strong>${pageCount}</strong></span>
            <button class="page-nav-button" data-action="next-page" aria-label="Next page">›</button>
            <span class="page-control-divider"></span>
            <button class="page-download" data-action="download-original">↓ <span>Original</span></button>
          </div>
        </section>
        <aside class="properties-rail">
          <div class="properties-top-icon">T</div>
          <h2>Edit a word<br /><span>or add text.</span></h2>
          <p>Click a word in the PDF to replace or delete it. Scanned pages need OCR first.</p>
          <div class="selection-tools" id="selection-tools" hidden>
            <label class="field-label" for="replacement-text">Selected word</label>
            <input id="replacement-text" class="text-input single-line" type="text" maxlength="200" />
            <div class="selection-buttons">
              <button class="selection-button" data-action="replace-word">Replace</button>
              <button class="selection-button delete-word" data-action="delete-word">Delete word</button>
            </div>
            <p class="selection-warning">Visual mask only: removed text may remain searchable. Not secure redaction. Colored backgrounds may not match.</p>
          </div>
          <div class="selection-hint" id="selection-hint">Click a word in the page, or add new text below.</div>
          <div class="ocr-controls" id="ocr-controls">
            <label class="field-label" for="ocr-language">Scanned page language</label>
            <select id="ocr-language" class="ocr-language">
              <option value="eng">English</option>
              <option value="hin">Hindi</option>
              <option value="eng+hin">English + Hindi</option>
            </select>
            <button class="selection-button ocr-button" data-action="run-ocr">Recognize text on this page</button>
            <p class="selection-warning">OCR runs in your browser. Check recognized words before applying edits.</p>
            <p id="ocr-status" class="ocr-status" role="status" aria-live="polite"></p>
          </div>
          <label class="field-label" for="text-content">Add new text</label>
          <textarea id="text-content" class="text-input" rows="3" maxlength="500" placeholder="Type something to add…"></textarea>
          <div class="field-row">
            <label class="field-label" for="text-size">Size</label>
            <label class="field-label" for="text-color">Color</label>
          </div>
          <div class="field-row"><input id="text-size" class="size-input" type="number" min="6" max="96" value="18"/><input id="text-color" class="color-input" type="color" value="#17264a"/></div>
          <button class="properties-return place-text-button" data-action="add-text-mode">Click page to place text <span>↗</span></button>
          <p class="edit-status" id="edit-status" role="status" aria-live="polite"></p>
          <div class="properties-note"><span>🔒</span><div><strong>Original preserved</strong><small>Export creates a separate copy.</small></div></div>
        </aside>
      </main>
    </div>`;
}

export async function renderEditorPage(document, pageNumber, scale, canvas) {
  return renderPage(document, pageNumber, scale, canvas);
}

export function renderPageThumbnails(pdfDocument, container, activePage, selectPage) {
  container.replaceChildren();
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const button = globalThis.document.createElement("button");
    button.className = `thumbnail-button${pageNumber === activePage ? " active" : ""}`;
    button.setAttribute("aria-label", `Go to page ${pageNumber}`);
    const canvas = globalThis.document.createElement("canvas");
    const label = globalThis.document.createElement("span");
    label.textContent = String(pageNumber).padStart(2, "0");
    button.append(canvas, label);
    container.append(button);
    button.addEventListener("click", () => selectPage(pageNumber));
    pdfDocument.getPage(pageNumber).then((page) => {
      const viewport = page.getViewport({ scale: 0.19, rotation: page.rotate });
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      page.render({ canvasContext: context, viewport }).promise.catch(() => {});
    });
  }
}
