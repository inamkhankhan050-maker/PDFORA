import { formatBytes } from "../services/pdf-service.js";
import { escapeHTML } from "../utils/html.js";

const TOOLS = [
  { id: "select", icon: "↖", label: "Edit", title: "Edit text and objects (V)" },
  { id: "addText", icon: "T", label: "Add text", title: "Add new text (T)" },
  { id: "image", icon: "▣", label: "Add image", title: "Insert an image (I)" },
  { id: "erase", icon: "◫", label: "Erase area", title: "Erase an area with its background colour (E)" },
];

export function renderEditorShell(file, pageCount) {
  const name = escapeHTML(file.name);
  return `
    <div class="editor-shell">
      <header class="editor-topbar">
        <a class="brand" href="#home" data-action="close-document"><span class="brand-mark">P</span><span>PDF<span class="brand-light">ora</span></span></a>
        <div class="document-name"><span class="document-file-icon">PDF</span><span class="document-title" title="${name}">${name}</span><span class="save-state" id="save-state"><i></i> <span>Original safe</span></span></div>
        <div class="editor-actions">
          <button class="icon-button" data-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>↶</button>
          <button class="icon-button" data-action="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>↷</button>
          <button class="icon-button" data-action="print" aria-label="Print" title="Print"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg></button>
          <div class="download-menu">
            <button class="download-trigger" data-action="toggle-downloads" aria-haspopup="true" aria-expanded="false">↓ <span>Download</span></button>
            <div class="download-popover" id="download-popover" hidden>
              <p class="menu-heading">Document</p>
              <button data-download="pdf"><b>PDF</b><small>Edited copy · fonts &amp; text kept</small></button>
              <button data-download="original"><b>Original PDF</b><small>Unchanged upload</small></button>
              <p class="menu-heading">This page</p>
              <div class="menu-row"><button data-download="page-jpg"><b>JPG</b></button><button data-download="page-png"><b>PNG</b></button></div>
              <p class="menu-heading">All ${pageCount} page${pageCount === 1 ? "" : "s"}</p>
              <div class="menu-row"><button data-download="all-jpg"><b>JPG</b>${pageCount > 1 ? "<small>ZIP</small>" : ""}</button><button data-download="all-png"><b>PNG</b>${pageCount > 1 ? "<small>ZIP</small>" : ""}</button></div>
              <label class="menu-quality">Image quality
                <select id="export-quality"><option value="2">Standard · 144 dpi</option><option value="4">High · 288 dpi</option></select>
              </label>
              <p class="menu-status" id="download-status" role="status" aria-live="polite"></p>
            </div>
          </div>
          <button class="icon-button" data-action="close-document" aria-label="Close document" title="Close document">×</button>
        </div>
      </header>
      <main class="editor-layout">
        <aside class="page-rail"><div class="rail-heading">PAGES <span>${pageCount}</span></div><div id="page-list" class="page-list"></div><button class="back-link" data-action="close-document">← Back to home</button></aside>
        <section class="document-area">
          <div class="document-toolbar">
            <div class="tool-group" role="toolbar" aria-label="Editing tools">
              ${TOOLS.map((tool) => `<button class="tool-button${tool.id === "select" ? " active" : ""}" data-tool="${tool.id}" title="${tool.title}" aria-pressed="${tool.id === "select"}"><span class="tool-icon">${tool.icon}</span><span>${tool.label}</span></button>`).join("")}
            </div>
            <div class="toolbar-controls">
              <small class="file-size">${formatBytes(file.size)}</small>
              <span class="toolbar-separator"></span>
              <button class="icon-button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
              <span id="zoom-label">100%</span>
              <button class="icon-button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
              <button class="fit-button" data-action="fit-page">Fit</button>
            </div>
          </div>
          <div class="page-stage" id="page-stage">
            <div class="pdf-page-frame" id="page-frame">
              <canvas id="pdf-canvas" aria-label="PDF page"></canvas>
              <svg id="overlay" class="edit-overlay" aria-hidden="true"></svg>
              <div id="busy-indicator" class="busy-indicator" hidden>Updating page…</div>
            </div>
          </div>
          <div class="page-controls">
            <button class="page-nav-button" data-action="prev-page" aria-label="Previous page">‹</button>
            <span>Page <strong id="current-page">1</strong> of <strong>${pageCount}</strong></span>
            <button class="page-nav-button" data-action="next-page" aria-label="Next page">›</button>
            <span class="page-control-divider"></span>
            <span class="doc-status" id="doc-status" role="status" aria-live="polite"></span>
          </div>
        </section>
        <aside class="properties-rail" id="properties" aria-label="Properties"></aside>
      </main>
      <input class="visually-hidden" id="image-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" />
      <input class="visually-hidden" id="replace-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" />
    </div>`;
}

export function renderPageThumbnails(pdfDocument, container, activePage, selectPage) {
  const existing = container.querySelectorAll(".thumbnail-button");
  if (existing.length !== pdfDocument.numPages) {
    container.replaceChildren();
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const button = globalThis.document.createElement("button");
      button.className = "thumbnail-button";
      button.setAttribute("aria-label", `Go to page ${pageNumber}`);
      const canvas = globalThis.document.createElement("canvas");
      const label = globalThis.document.createElement("span");
      label.textContent = String(pageNumber).padStart(2, "0");
      button.append(canvas, label);
      container.append(button);
      button.addEventListener("click", () => selectPage(pageNumber));
    }
  }
  container.querySelectorAll(".thumbnail-button").forEach((button, index) => {
    button.classList.toggle("active", index + 1 === activePage);
    const canvas = button.querySelector("canvas");
    pdfDocument.getPage(index + 1).then((page) => {
      const viewport = page.getViewport({ scale: 0.19, rotation: page.rotate });
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      page.render({ canvasContext: context, viewport }).promise.catch(() => {});
    }).catch(() => {});
  });
}
