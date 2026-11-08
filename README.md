# PDFora

A PDF editor that runs fully in the browser. Open a PDF, click a word to replace or remove it, add new text, and download an edited copy or the page as an image.
Live: https://inamkhankhan050-maker.github.io/PDFORA/

It is meant for small fixes, like a wrong name, date or typo, without uploading the file anywhere. There is no backend: the PDF is read into browser memory, edited there and downloaded again.

![Editor](screenshots/editor.png)

## Features

- Drag-and-drop or file picker. Accepts real PDFs of 1 to 10 pages, up to 50 MB, with clear messages for anything else.
- Page preview with thumbnails, page navigation, fit and 25% to 400% zoom.
- Click a word in a text PDF to replace it or remove it.
- Scanned pages: run OCR on a page first (English, Hindi, or both), then click words the same way.
- Add new text with a chosen size and colour. Undo works for edits.
- Download the edited PDF, the current page as PNG or JPG, or the original file.

## How it works

- `pdf-service.js` checks the file and renders pages with PDF.js.
- PDF.js text positions go into a transparent layer on top of the page, so a click maps to a word. For scanned pages, Tesseract.js word boxes fill the same layer.
- Edits are stored as a list (page, position, text, size, colour). On export, pdf-lib applies them to a copy of the PDF.

## Limits

- Replacing or deleting a word paints a white box with new text on top. The original text is still inside the file and can be searched or copied. This is not secure redaction.
- The white box won't match coloured backgrounds.
- New and replacement text only supports basic Latin characters (built-in PDF font). Hindi text can be read with OCR but not written.
- PDF.js, pdf-lib and Tesseract.js load from CDNs, so the page needs internet. The PDF itself is not uploaded.
- No automated tests yet. Testing is manual: text PDFs, scanned PDFs, a file over 10 pages and a non-PDF.

## Tech stack

Plain JavaScript (ES modules), HTML, CSS. PDF.js 4.10 for rendering, pdf-lib 1.17 for export, Tesseract.js 5 for OCR. Hosted on GitHub Pages.

## Run locally

No build step. Serve the folder over HTTP (ES modules don't load from `file://`):

```sh
python3 -m http.server 4173
```

Then open http://localhost:4173.

## Folder structure

```
index.html
src/
  main.js              app state, switches between upload and editor
  config.js            file size and page limits, PDF.js version
  components/          landing.js (upload), editor.js (preview and tools)
  services/            pdf-service.js, ocr-service.js
  styles.css
```

## Roadmap

- Image editing and annotations
- Add, delete and reorder pages
- Save work in progress in the browser

## License

MIT
