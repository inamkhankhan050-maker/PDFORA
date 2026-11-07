import { PRODUCT } from "../config.js";

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
            <p class="hero-description">Everything you need to work with your documents — in one calm, focused workspace.</p>
            <div class="hero-assurances"><span><span class="check">✓</span> No account needed</span><span><span class="check">✓</span> Files stay on your device</span></div>
          </div>
          <div class="upload-card" id="upload">
            <div class="upload-glow" aria-hidden="true"></div>
            <div class="upload-card-inner">
              <div class="upload-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M24 31V8m0 0-8 8m8-8 8 8M10 28v9a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3v-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
              <h2>Drop your PDF here</h2>
              <p>or <button class="text-button" type="button" data-action="choose-file">choose a file</button> from your device</p>
              <button class="primary-button" type="button" data-action="choose-file">Choose PDF <span aria-hidden="true">→</span></button>
              <div class="upload-meta"><span class="pdf-pill">PDF</span><span>Up to ${PRODUCT.maxFileBytes / 1024 / 1024} MB</span><span class="meta-divider">·</span><span>${PRODUCT.maxPages} pages max</span></div>
              <input class="visually-hidden" id="pdf-file" type="file" accept="application/pdf,.pdf" />
              <p class="upload-message" id="upload-message" role="status" aria-live="polite"></p>
            </div>
            <div class="privacy-note" id="privacy"><span class="lock-icon" aria-hidden="true">♧</span> Your file is processed in your browser. It is never uploaded.</div>
          </div>
          <div class="hero-orbit orbit-one" aria-hidden="true"></div><div class="hero-orbit orbit-two" aria-hidden="true"></div>
        </section>

        <section class="trust-strip" aria-label="Product principles"><div><span class="strip-icon">✳</span><span>Thoughtfully simple</span></div><i></i><div><span class="strip-icon">⌁</span><span>Private by design</span></div><i></i><div><span class="strip-icon">◷</span><span>Works right in your browser</span></div></section>

        <section class="intro-section" id="how-it-works">
          <div class="section-heading"><div class="eyebrow">A BETTER WAY TO WORK WITH PDFS</div><h2>Less hassle.<br /><span>More done.</span></h2><p>Start by opening a document. Your original stays untouched while you work with a local preview.</p></div>
          <div class="principle-grid"><article class="principle-card"><span class="principle-number">01</span><div class="principle-icon icon-blue">↥</div><h3>Open in seconds</h3><p>Choose a PDF from your device. No signup, account or cloud upload required.</p></article><article class="principle-card"><span class="principle-number">02</span><div class="principle-icon icon-lilac">▧</div><h3>See every page</h3><p>Preview pages, move through the document and adjust your view as you go.</p></article><article class="principle-card"><span class="principle-number">03</span><div class="principle-icon icon-mint">↗</div><h3>Keep control</h3><p>Your original file remains unchanged. You decide what to do with it next.</p></article></div>
        </section>
        <footer class="footer"><a class="brand footer-brand" href="#home"><span class="brand-mark">P</span><span>PDF<span class="brand-light">ora</span></span></a><span>Private by design. Made for your pages.</span><span class="footer-year">© ${new Date().getFullYear()} PDFora</span></footer>
      </main>
    </div>`;
}
