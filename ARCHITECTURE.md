# Architecture

## Foundation phase

- `src/main.js` owns the current browser session and connects the landing and document preview screens.
- `src/components/landing.js` renders the responsive upload experience.
- `src/components/editor.js` renders the document preview workspace and page thumbnails.
- `src/services/pdf-service.js` validates the PDF signature and size, opens documents with PDF.js, and renders pages.
- `src/config.js` contains the configurable page and upload limits and pinned PDF.js version.

The source PDF remains a `File` object in browser memory. New text commands are stored separately as page number, PDF coordinates, text, font size, and color. PDF.js supplies page rendering and coordinate transforms; pdf-lib applies the commands to an in-memory copy for export. This is overlay insertion, not native replacement of original text.

## Next architecture steps

1. Add a document capability report and native text-editing strategies.
2. Expand transaction history and local working-copy persistence.
3. Add image, annotation, and page management operations with export verification.
4. Add OCR and AI only after consent, secure backend configuration, schema validation, and preview/apply flows exist.

AI keys must remain server-side. This repository currently has no backend and sends no document content to an external AI provider.
