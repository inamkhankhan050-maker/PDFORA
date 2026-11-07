# PDFora

**Edit Anything. Perfect Every Page.**

PDFora is a browser-based PDF studio. The current foundation includes a responsive website, local PDF validation, page previews, thumbnails, navigation, zoom, click-to-select word replacement/deletion, new-text overlays, undo, edited-copy export, and current-page PNG/JPG downloads.

## Run locally

PDFora is a static website and does not need a build step. Serve the repository root over HTTP (ES modules do not work from `file://`):

```sh
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

PDF.js is loaded from cdnjs at a pinned version. An internet connection is required to load the PDF renderer. PDF files are read and rendered in the browser and are not uploaded.

## Current functionality

- Responsive landing page with drag-and-drop and file picker.
- PDF signature, type, 50 MB file size, and 1–10 page validation.
- Browser-side rendering with PDF.js, page thumbnails, page navigation, fit, and 25%–400% zoom.
- Click a word in text-based PDFs to select it, replace it, or visually mask it for deletion.
- Add basic Latin text overlays with a chosen size and color; undo additions and export a separate PDF copy using pdf-lib.
- Download the current page as PNG or JPG with the visible edits included.
- Download of the original, unchanged file.
- Clear error messages for invalid, unreadable, oversized, and out-of-range files.

Text replacement and deletion use visual overlays, not native content-stream editing or secure redaction. Removed text may remain searchable inside the PDF, and white masking may not match non-white backgrounds. Image editing, OCR, AI, object removal, forms, and annotations are not implemented yet. Export requires an internet connection to load pdf-lib; only basic Latin characters are supported by the built-in font. PNG/JPG export downloads the current page only.

## Repository map

```text
index.html
src/
  config.js
  main.js
  components/
    editor.js
    landing.js
  services/
    pdf-service.js
  styles.css
```

## Privacy

The selected PDF stays in browser memory. PDF.js is downloaded from cdnjs; no document bytes are sent to that CDN. No AI service or backend is currently connected.
