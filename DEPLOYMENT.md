# Deployment

PDFora is static in the foundation phase and can be hosted on GitHub Pages or any static host. Publish the repository root; no build command is required. Asset paths are relative so the site also works from a repository subpath.

PDF.js and its worker are loaded from cdnjs at the same pinned version. A future AI feature will require a secure backend; never put provider keys in browser code or Vite-prefixed public environment variables.
