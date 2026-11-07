import { PRODUCT } from "../config.js";
import { escapeHTML } from "../utils/html.js";

const FEATURES = [
  ["✎", "Edit existing text", "Change or delete any word. New letters are written in the PDF's own font whenever it contains them."],
  ["T", "Add text anywhere", "Type in English or Hindi, pick a font, size, colour, rotation and opacity."],
  ["▣", "Edit images freely", "Move, resize, rotate, flip, crop, fade, border, replace or delete images and logos."],
  ["⌫", "Remove objects & ads", "Delete embedded objects, or erase any area with its background colour."],
  ["⌕", "OCR for scans", "Recognize English or Hindi on scanned pages, then edit the words."],
  ["↓", "Download PDF, JPG, PNG", "Get the edited PDF, or every page as high-resolution images."],
];

export function renderLanding() {
  return `
    <div class="site-shell">
      <header class="topbar">
        <a class="brand" href="#home" aria-label="PDFora home"><span class="brand-mark">P</span><span>PDF<span class="brand-light">ora</span></span></a>
        <nav class="top-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <a class="top-cta" href="#upload">Open a PDF <span aria-hidden="true">↗</span></a>
      </header>

      <main id="home">
        <section class="hero" aria-labelledby="hero-title">
          <div class="hero-copy">
            <div class="eyebrow"><span class="eyebrow-dot"></span> YOUR DOCUMENT, YOUR SPACE</div>
            <h1 id="hero-title">Edit PDFs.<br /><span>Your way.</span></h1>
            <p class="hero-description">Edit text in its original font, change images, remove objects and download as PDF, JPG or PNG — right in your browser.</p>
            <div class="hero-assurances"><span><span class="check">✓</span> No account needed</span><span><span class="check">✓</span> Files stay on your device</span></div>
          </div>
          <div class="upload-card" id="upload">
            <div class="upload-glow" aria-hidden="true"></div>
            <div class="upload-card-inner">
              <div class="upload-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M24 31V8m0 0-8 8m8-8 8 8M10 28v9a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3v-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
              <h2>Drop your PDF here</h2>
              <p>Or <button class="text-button" type="button" data-action="choose-file">choose a file</button> from your device.</p>
              <button class="primary-button" type="button" data-action="choose-file">Choose PDF <span aria-hidden="true">→</span></button>
              <div class="upload-meta"><span class="pdf-pill">PDF</span><span>Up to ${PRODUCT.maxFileBytes / 1024 / 1024} MB</span><span class="meta-divider">·</span><span>${PRODUCT.maxPages} pages max</span></div>
              <input class="visually-hidden" id="pdf-file" type="file" accept="application/pdf,.pdf" />
              <p class="upload-message" id="upload-message" role="status" aria-live="polite"></p>
              <div id="password-slot"></div>
              <div id="restore-slot"></div>
            </div>
            <div class="privacy-note" id="privacy"><span class="lock-icon" aria-hidden="true">♧</span> Your file is processed in your browser. It is never uploaded.</div>
          </div>
          <div class="hero-orbit orbit-one" aria-hidden="true"></div><div class="hero-orbit orbit-two" aria-hidden="true"></div>
        </section>

        <section class="trust-strip" aria-label="Product principles"><div><span class="strip-icon">✳</span><span>Thoughtfully simple</span></div><i></i><div><span class="strip-icon">⌁</span><span>Private by design</span></div><i></i><div><span class="strip-icon">◷</span><span>Works right in your browser</span></div></section>

        <section class="feature-section" id="features" aria-labelledby="features-title">
          <div class="section-heading"><div class="eyebrow">WHAT YOU CAN DO</div><h2 id="features-title">Every tool<br /><span>actually works.</span></h2></div>
          <div class="feature-grid">${FEATURES.map(([icon, title, body]) => `<button class="feature-card" type="button" data-feature="${escapeHTML(title)}"><span class="feature-icon">${icon}</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></button>`).join("")}</div>
        </section>

        <section class="intro-section" id="how-it-works">
          <div class="section-heading"><div class="eyebrow">A BETTER WAY TO WORK WITH PDFS</div><h2>Less hassle.<br /><span>More done.</span></h2><p>Start by opening a document. Your original stays untouched while you work with a local preview.</p></div>
          <div class="principle-grid"><article class="principle-card"><span class="principle-number">01</span><div class="principle-icon icon-blue">↥</div><h3>Open in seconds</h3><p>Choose a PDF from your device. No signup, account or cloud upload required.</p></article><article class="principle-card"><span class="principle-number">02</span><div class="principle-icon icon-lilac">▧</div><h3>See every page</h3><p>Preview pages, move through the document and adjust your view as you go.</p></article><article class="principle-card"><span class="principle-number">03</span><div class="principle-icon icon-mint">↗</div><h3>Keep control</h3><p>Your original file remains unchanged. You decide what to do with it next.</p></article></div>
        </section>
        <footer class="footer"><a class="brand footer-brand" href="#home"><span class="brand-mark">P</span><span>PDF<span class="brand-light">ora</span></span></a><span>Private by design. Made for your pages.</span><span class="footer-year">© ${new Date().getFullYear()} PDFora</span></footer>
      </main>
    </div>`;
}

export function renderPasswordPrompt(message) {
  return `<form class="password-form" autocomplete="off">
      <label class="field-label" for="pdf-password">${escapeHTML(message)}</label>
      <div class="password-row"><input id="pdf-password" class="text-input single-line" type="password" required /><button class="primary-button small" type="submit">Open</button></div>
    </form>`;
}

export function renderRestoreCard(session) {
  const when = new Date(session.savedAt || Date.now()).toLocaleString();
  const count = session.edits?.length || 0;
  return `<div class="restore-card"><div><strong>Continue editing ${escapeHTML(session.fileName)}</strong><small>${count} edit${count === 1 ? "" : "s"} · saved in this browser ${escapeHTML(when)}</small></div>
    <div class="restore-actions"><button class="primary-button small" type="button" data-action="restore-session">Restore</button><button class="text-button" type="button" data-action="discard-session">Discard</button></div></div>`;
}
