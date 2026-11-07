# Testing notes

## Foundation manual checks

1. Serve the repository with `python3 -m http.server 4173` and open it in a current desktop browser.
2. Open a valid 1-page PDF and confirm it renders with a thumbnail.
3. Open a 3-page PDF; select thumbnails and use previous/next page controls.
4. Use zoom buttons and Fit page; confirm zoom remains between 25% and 400%.
5. Try a non-PDF, empty file, file over 50 MB, and PDF over 10 pages; confirm each is rejected with a visible message.
6. Download the original and compare it with the input; the preview does not modify the file.
7. Click a word in a text-based PDF; confirm the selection box matches that word, then replace it and undo.
8. Delete a word and confirm the UI describes a visual mask, not secure redaction.
9. Add basic Latin text; export PDF, PNG, and JPG. Confirm the image contains the edits and represents the current page.
10. Open the exported PDF in an independent viewer and verify page count and placement. Confirm the original file is unchanged and note the original word may remain searchable after visual masking.
11. Try Hindi or other Unicode text and confirm PDFora reports the built-in-font limitation rather than claiming success.
12. Repeat upload and navigation at narrow mobile widths.

Automated test tooling is not configured in this foundation snapshot. No feature is labeled tested or verified based on these instructions alone.
