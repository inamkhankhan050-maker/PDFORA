# Testing

## Browser end-to-end (headless Chromium, 2026-11-07)

Tested with Playwright on `rl.pdf` (ReportLab, DejaVu Serif + Helvetica) and the app served statically. The test hook `globalThis.__pdfora` is only exposed when the URL has `?test`.

| Feature | Status | Notes |
|---|---|---|
| Click a word and replace it, same font | Verified | "Muhammad" → "Ahmed" in the PDF's own DejaVuSerif; "World" → "Duniya" in an embedded Type0 DejaVu Sans |
| Rewrite a whole English line (double-click) | Verified | Old text no longer in the file (PyMuPDF text check) |
| Delete a word | Verified | |
| Edit text on a coloured background | Verified | Background colour sampled, "4500" → "12,750" in Helvetica-Bold |
| Add new text in the PDF's own fonts | Verified | Font list offers fonts embedded in the PDF, standard fonts, Noto Sans |
| Add Hindi text | Visually verified | Renders correctly with Noto Sans Devanagari; copy/search of new Hindi text is garbled |
| Move / rotate an image | Verified | |
| Resize an image by its corner handle | Verified | |
| Insert / replace / delete / flip / crop image | Verified in Node | |
| Erase an area | Verified | |
| Undo / redo | Verified | |
| Download PDF | Verified | 2 pages, fonts and images checked with PyMuPDF |
| Download page as JPG, all pages as PNG ZIP | Verified | |
| Mobile width (390 px) | Visually checked | Toolbar and panel stack below the page |

## Known limits

- Replaced, deleted or erased text is **removed from the content stream** (remaining glyphs keep their position). Text inside nested form XObjects is only covered.
- Scanned pages still use OCR + overlay (unchanged).
- Not implemented: AI assistant, forms, signatures, annotations, page add/delete/reorder, metadata editing.
