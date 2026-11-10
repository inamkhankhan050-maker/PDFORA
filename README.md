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
- Open password-protected PDFs by entering the password in a private in-browser dialog; incorrect passwords can be retried.
- Browser-side rendering with PDF.js, page thumbnails, page navigation, fit, and 25%–400% zoom.
- Click a word in text PDFs to select, replace, or visually mask it for deletion. For scanned PDFs, run OCR on each page first; English, Hindi, and English + Hindi are available.
- Add basic Latin text overlays with a chosen size and color; undo additions and export a separate PDF copy using pdf-lib.
- Download the current page as PNG or JPG with the visible edits included.
- Download of the original, unchanged file.
- Clear error messages for invalid, unreadable, oversized, and out-of-range files.

Text replacement and deletion use visual overlays, not native content-stream editing or secure redaction. Removed text may remain searchable inside the PDF, and white masking may not match non-white backgrounds. Image editing, AI, object removal, forms, and annotations are not implemented yet. PDF export requires an internet connection to load pdf-lib; encrypted/password-protected inputs may open but cannot currently be re-saved as an edited PDF. Only basic Latin replacement/addition text is supported by the built-in font. OCR downloads its engine and language data in the browser; it processes the rendered page locally. PNG/JPG export downloads the current page only.

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
    ocr-service.js
  styles.css
```

## Privacy

The selected PDF stays in browser memory. PDF.js is downloaded from cdnjs and OCR resources from jsDelivr; page content is processed in the browser and is not uploaded to those CDNs. No AI service or backend is currently connected.
