# PDFora

**Edit Anything. Perfect Every Page.**

PDFora is a browser-based PDF studio. This repository currently implements the foundation phase: a responsive website, local PDF validation, page previews, thumbnails, navigation, zoom, and downloading the untouched original.

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
- Download of the original, unchanged file.
- Clear error messages for invalid, unreadable, oversized, and out-of-range files.

Editing, OCR, AI, object removal, forms, annotations, and edited-PDF export are not implemented yet. The editor labels the current view as a preview and does not claim editing has occurred.

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
