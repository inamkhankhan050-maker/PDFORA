# Architecture

## Foundation phase

- `src/main.js` owns the current browser session and connects the landing and document preview screens.
- `src/components/landing.js` renders the responsive upload experience.
- `src/components/editor.js` renders the document preview workspace and page thumbnails.
- `src/services/pdf-service.js` validates the PDF signature and size, opens documents with PDF.js, and renders pages.
- `src/config.js` contains the configurable page and upload limits and pinned PDF.js version.

The source PDF remains a `File` object in browser memory. There is no mutation path in this phase. Rendering is isolated from future editing adapters so editing and export can be introduced without claiming PDF.js itself performs native text editing.

## Next architecture steps

1. Add a document capability report and a dedicated editing/export adapter.
2. Add transaction history and local working-copy persistence.
3. Add annotation and page management operations with export verification.
4. Add OCR and AI only after consent, secure backend configuration, schema validation, and preview/apply flows exist.

AI keys must remain server-side. This repository currently has no backend and sends no document content to an external AI provider.
