import { escapeHTML } from "../utils/html.js";

export function fontOptions(profiles, selected) {
  const options = [];
  for (const profile of profiles.filter((item) => item.usable)) {
    options.push([`orig:${profile.uid}`, `${profile.displayName} · from this PDF`]);
  }
  options.push(["std:sans", "Helvetica (sans)"], ["std:serif", "Times (serif)"], ["std:mono", "Courier (mono)"], ["uni", "Noto Sans · Hindi & Unicode"]);
  return options.map(([value, label]) => `<option value="${escapeHTML(value)}"${value === selected ? " selected" : ""}>${escapeHTML(label)}</option>`).join("");
}

export function fontSpecToValue(spec) {
  if (!spec) return "std:sans";
  if (spec.mode === "original") return `orig:${spec.resourceKey}`;
  if (spec.mode === "unicode") return "uni";
  return `std:${spec.family || "sans"}`;
}

export function valueToFontSpec(value) {
  if (value.startsWith("orig:")) return { mode: "original", resourceKey: value.slice(5) };
  if (value === "uni") return { mode: "unicode" };
  return { mode: "standard", family: value.slice(4) || "sans" };
}

const toggle = (field, label, on, title) => `<button class="style-toggle${on ? " on" : ""}" data-toggle="${field}" aria-pressed="${!!on}" title="${title}">${label}</button>`;

function styleRow(style) {
  return `<div class="style-row">${toggle("bold", "<b>B</b>", style.bold, "Bold")}${toggle("italic", "<i>I</i>", style.italic, "Italic")}${toggle("underline", "<u>U</u>", style.underline, "Underline")}</div>`;
}

function fontNotice(report) {
  if (!report) return "";
  if (report.error) return `<p class="notice warn">${escapeHTML(report.error)}</p>`;
  if (report.fallback) return `<p class="notice warn">Using <b>${escapeHTML(report.font)}</b>. ${escapeHTML(report.fallback)}</p>`;
  if (report.font) return `<p class="notice ok">✓ Written with <b>${escapeHTML(report.font)}</b>${report.sameFont ? " — the same font as the PDF" : ""}.</p>`;
  return "";
}

export function renderOverview({ capability, page, ocrState }) {
  const info = capability?.pages?.[page - 1];
  const fonts = info?.fonts || [];
  return `
    <div class="panel-head"><div class="properties-top-icon">✎</div><h2>Edit this PDF<br /><span>directly.</span></h2></div>
    <ul class="how-list">
      <li><b>Click any word</b> to change or delete it. Double-click selects the whole line.</li>
      <li><b>Click an image or logo</b> to move, resize, rotate, crop, replace or delete it.</li>
      <li><b>Add text / Add image</b> from the toolbar, or <b>Erase area</b> to clean a region.</li>
    </ul>
    ${info ? `<div class="report-card"><p class="menu-heading">Page ${page} check</p>
      <dl>
        <div><dt>Text</dt><dd>${info.scanned ? "Scanned / image only" : `${info.runs} text runs`}</dd></div>
        <div><dt>Fonts</dt><dd>${fonts.length ? `${fonts.filter((font) => font.reusable).length} of ${fonts.length} reusable` : "—"}</dd></div>
        <div><dt>Objects</dt><dd>${info.images} images · ${info.forms} graphics</dd></div>
        <div><dt>Size</dt><dd>${Math.round(info.width)} × ${Math.round(info.height)} pt${info.rotation ? ` · ${info.rotation}°` : ""}</dd></div>
      </dl>
      ${fonts.length ? `<p class="font-list">${fonts.map((font) => `<span class="${font.reusable ? "ok" : ""}" title="${font.reusable ? "New text can be written in this font" : "Text in this font is edited with the closest substitute"}">${escapeHTML(font.name)}</span>`).join("")}</p>` : ""}
    </div>` : ""}
    ${renderOCRControls(ocrState, info)}
    <div class="properties-note"><span>🔒</span><div><strong>Original preserved</strong><small>Edits apply to a separate working copy in your browser.</small></div></div>`;
}

export function renderOCRControls(ocrState = {}, info) {
  return `<div class="ocr-controls">
      <label class="field-label" for="ocr-language">${info?.scanned ? "This page looks scanned" : "Scanned text (OCR)"}</label>
      <select id="ocr-language" class="ocr-language" data-field="ocrLanguage">
        <option value="eng">English</option><option value="hin">Hindi</option><option value="eng+hin">English + Hindi</option>
      </select>
      <button class="selection-button ocr-button" data-action="run-ocr" ${ocrState.running ? "disabled" : ""}>${ocrState.done ? "Recognize again" : "Recognize text on this page"}</button>
      <p class="ocr-status" role="status" aria-live="polite">${escapeHTML(ocrState.message || "OCR runs in your browser. Check recognized words before editing them.")}</p>
    </div>`;
}

export function renderTextSelection({ selection, profiles, report }) {
  const style = selection.style;
  return `
    <div class="panel-head"><div class="properties-top-icon">T</div><h2>${selection.source === "ocr" ? "Scanned word" : "Edit text"}<br /><span>${selection.edited ? "edited" : "original"}</span></h2></div>
    ${selection.source === "ocr" ? `<p class="notice">OCR confidence ${selection.confidence}%. Check the spelling before applying.</p>` : ""}
    <label class="field-label" for="selection-text">Selected text</label>
    <textarea id="selection-text" class="text-input" rows="2" data-field="selectionText" maxlength="2000">${escapeHTML(selection.text)}</textarea>
    <div class="selection-buttons">
      <button class="selection-button" data-action="apply-text">Apply</button>
      <button class="selection-button delete-word" data-action="delete-text">Delete</button>
    </div>
    ${selection.source === "native" ? `<button class="link-button" data-action="select-line">Select the whole line</button>` : ""}
    ${selection.edited ? `<button class="link-button" data-action="revert-run">Restore original text</button>` : ""}
    <div class="field-grid">
      <label class="field-label span-2">Font<select data-field="font" class="select-input">${fontOptions(profiles, style.fontValue)}</select></label>
      <label class="field-label">Size<input data-field="size" class="size-input" type="number" min="2" max="400" step="0.5" value="${style.size}" /></label>
      <label class="field-label">Colour<input data-field="color" class="color-input" type="color" value="${style.color}" /></label>
      <label class="field-label">Background<input data-field="bg" class="color-input" type="color" value="${style.bg}" /></label>
      <label class="field-label">Opacity<input data-field="opacity" type="range" min="0.1" max="1" step="0.05" value="${style.opacity ?? 1}" /></label>
    </div>
    ${styleRow(style)}
    ${fontNotice(report)}
    <p class="selection-warning">The replaced original text is covered with the background colour; it is not secure redaction.</p>`;
}

export function renderAddedText({ edit, profiles, report }) {
  const meta = edit.meta;
  return `
    <div class="panel-head"><div class="properties-top-icon">T</div><h2>New text<br /><span>drag to move</span></h2></div>
    <label class="field-label" for="added-text">Text</label>
    <textarea id="added-text" class="text-input" rows="3" data-field="text" maxlength="5000">${escapeHTML(edit.text)}</textarea>
    <div class="field-grid">
      <label class="field-label span-2">Font<select data-field="font" class="select-input">${fontOptions(profiles, fontSpecToValue(edit.font))}</select></label>
      <label class="field-label">Size<input data-field="size" class="size-input" type="number" min="2" max="400" step="0.5" value="${meta.size}" /></label>
      <label class="field-label">Colour<input data-field="color" class="color-input" type="color" value="${edit.color}" /></label>
      <label class="field-label">Rotation°<input data-field="rotation" class="size-input" type="number" min="-180" max="180" step="1" value="${meta.rotation}" /></label>
      <label class="field-label">Opacity<input data-field="opacity" type="range" min="0.1" max="1" step="0.05" value="${edit.opacity ?? 1}" /></label>
    </div>
    ${styleRow(edit)}
    ${fontNotice(report)}
    <button class="selection-button delete-word wide" data-action="delete-selected">Delete text</button>`;
}

function number(field, label, value, attrs = "") {
  return `<label class="field-label">${label}<input data-field="${field}" class="size-input" type="number" step="0.5" value="${Math.round(value * 10) / 10}" ${attrs} /></label>`;
}

export function renderObject({ ctx }) {
  const { kindLabel, placement, edit, lockAspect, rotation } = ctx;
  const crop = edit.crop || {};
  const border = edit.border || { width: 0, color: "#1f2a44" };
  return `
    <div class="panel-head"><div class="properties-top-icon">▣</div><h2>${escapeHTML(kindLabel)}<br /><span>${escapeHTML(ctx.detail || "")}</span></h2></div>
    <div class="field-grid">
      ${number("x", "X (pt)", placement.cx - placement.width / 2)}
      ${number("y", "Y (pt)", placement.cy - placement.height / 2)}
      ${number("width", "Width", placement.width, 'min="1"')}
      ${number("height", "Height", placement.height, 'min="1"')}
      ${number("rotation", "Rotation°", rotation, 'min="-180" max="180" step="1"')}
      <label class="field-label">Opacity<input data-field="opacity" type="range" min="0.05" max="1" step="0.05" value="${edit.opacity ?? 1}" /></label>
    </div>
    <label class="check-label"><input type="checkbox" data-field="lockAspect" ${lockAspect ? "checked" : ""}/> Keep aspect ratio</label>
    <div class="style-row">
      <button class="style-toggle" data-action="flip-h" title="Flip horizontally">⇋ Flip H</button>
      <button class="style-toggle" data-action="flip-v" title="Flip vertically">⇵ Flip V</button>
      <button class="style-toggle" data-action="rotate-90" title="Rotate 90°">⟳ 90°</button>
    </div>
    <p class="menu-heading">Crop (%)</p>
    <div class="field-grid four">
      ${["left", "top", "right", "bottom"].map((side) => `<label class="field-label">${side[0].toUpperCase() + side.slice(1)}<input data-field="crop-${side}" class="size-input" type="number" min="0" max="95" step="1" value="${Math.round((crop[side] || 0) * 100)}" /></label>`).join("")}
    </div>
    <div class="field-grid">
      <label class="field-label">Border<input data-field="borderWidth" class="size-input" type="number" min="0" max="50" step="0.5" value="${border.width || 0}" /></label>
      <label class="field-label">Border colour<input data-field="borderColor" class="color-input" type="color" value="${border.color || "#1f2a44"}" /></label>
    </div>
    <label class="field-label">Layer<select data-field="z" class="select-input">
      <option value="same"${(edit.z || "same") === "same" ? " selected" : ""}>Keep in place</option>
      <option value="front"${edit.z === "front" ? " selected" : ""}>Bring to front</option>
      <option value="back"${edit.z === "back" ? " selected" : ""}>Send to back</option>
    </select></label>
    <div class="selection-buttons">
      <button class="selection-button" data-action="replace-image">Replace image</button>
      <button class="selection-button delete-word" data-action="delete-selected">Delete</button>
    </div>
    ${ctx.canReset ? `<button class="link-button" data-action="reset-object">Reset to original</button>` : ""}`;
}

export function renderErase({ edit }) {
  return `
    <div class="panel-head"><div class="properties-top-icon">⌫</div><h2>Erased area<br /><span>filled with colour</span></h2></div>
    <label class="field-label">Fill colour<input data-field="color" class="color-input" type="color" value="${edit.color}" /></label>
    <p class="selection-warning">Erasing paints over the area. Underlying content is hidden, not removed from the file.</p>
    <button class="selection-button delete-word wide" data-action="delete-selected">Remove erase</button>`;
}

export function renderToolHint(tool) {
  const hints = {
    addText: ["Add text", "Click anywhere on the page to place new text."],
    image: ["Add image", "Choose a PNG, JPG or WebP. It is placed on this page and you can drag it anywhere."],
    erase: ["Erase area", "Drag a rectangle over anything — an ad, a logo, a stamp. It is filled with the surrounding background colour."],
  };
  const [title, body] = hints[tool] || ["", ""];
  return `<div class="panel-head"><div class="properties-top-icon">✦</div><h2>${title}<br /><span>tool</span></h2></div><p>${body}</p>${tool === "image" ? `<button class="selection-button wide" data-action="choose-image">Choose image…</button>` : ""}`;
}
