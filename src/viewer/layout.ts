export const layout = `
  <header class="reader-header">
    <div class="identity-row">
      <div class="identity">
        <img class="brand-icon" src="./reader-icon.png" width="30" height="30" alt="">
        <span class="brand-name">PDF Reader</span>
      </div>
      <div class="file-actions">
        <button id="open-file" class="button primary" type="button" title="Open file (Ctrl or Command + O)">Open file</button>
        <button id="open-url" class="button" type="button">Open URL</button>
        <input id="file-picker" type="file" accept=".pdf,application/pdf" hidden>
      </div>
      <div class="preferences">
        <label class="theme-control">
          <span>Theme</span>
          <select id="theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <button id="invert" class="button" type="button" aria-pressed="false"
          title="Invert PDF lightness while preserving hue">
          <span class="color-symbol" aria-hidden="true"></span> Invert PDF
        </button>
      </div>
    </div>
    <div id="document-toolbar" class="document-toolbar" hidden>
      <div class="document-name">
        <span id="filename"></span>
        <button id="close-file" class="icon-button" type="button" aria-label="Close PDF" title="Close PDF">×</button>
      </div>
      <div class="view-controls">
        <form id="page-navigation" class="control-group" aria-label="Page navigation">
          <button id="previous-page" class="icon-button" type="button" aria-label="Previous page" title="Previous page">‹</button>
          <input id="page-number" type="text" inputmode="numeric" pattern="[0-9]*" size="3" aria-label="Page number" value="1">
          <span id="page-count"></span>
          <button id="next-page" class="icon-button" type="button" aria-label="Next page" title="Next page">›</button>
        </form>
        <div class="control-group zoom-controls" role="group" aria-label="Zoom controls">
          <button id="zoom-out" class="icon-button" type="button" aria-label="Zoom out" title="Zoom out">−</button>
          <select id="zoom" aria-label="Zoom level">
            <option value="" hidden></option>
            <option value="page-fit">Fit page</option>
            <option value="page-width">Fit width</option>
            <option value="1">Actual size</option>
          </select>
          <button id="zoom-in" class="icon-button" type="button" aria-label="Zoom in" title="Zoom in">+</button>
        </div>
      </div>
      <div class="document-actions">
        <button id="show-search" class="button" type="button" aria-expanded="false" aria-controls="search-panel"
          title="Find in PDF (Ctrl or Command + F)">Find</button>
        <button id="download" class="button" type="button" title="Download the original PDF">Download</button>
      </div>
    </div>
    <div id="search-panel" class="search-panel" role="search" aria-label="Find in PDF" hidden>
      <form id="search-form" class="search-form">
        <input id="search-query" type="search" placeholder="Find in PDF…" aria-label="Find in PDF" autocomplete="off">
        <output id="search-status" role="status" aria-live="polite"></output>
        <div class="control-group search-buttons">
          <button id="previous-match" class="icon-button" type="button" aria-label="Previous match" title="Previous match">‹</button>
          <button class="icon-button" type="submit" aria-label="Next match" title="Next match">›</button>
          <button id="close-search" class="icon-button" type="button" aria-label="Close search" title="Close search">×</button>
        </div>
      </form>
    </div>
  </header>
  <main class="workspace">
    <div id="scroll-region" class="scroll-region" tabindex="0" role="region" aria-label="PDF pages">
      <div id="pages" class="pdfViewer"></div>
    </div>
    <div id="welcome" class="workspace-overlay">
      <section class="welcome-card">
        <img class="welcome-icon" src="./reader-icon.png" width="58" height="58" alt="">
        <h1>Open a PDF</h1>
        <p>Drop a PDF here or choose a file from your device.</p>
        <button id="choose-file" class="button primary" type="button">Choose file</button>
      </section>
    </div>
    <div id="load-panel" class="workspace-overlay" hidden>
      <section class="welcome-card">
        <h1>Opening PDF</h1>
        <p id="load-name"></p>
        <progress id="load-progress" max="100" aria-label="Loading PDF"></progress>
        <button id="cancel-load" class="button" type="button">Cancel</button>
      </section>
    </div>
    <div id="file-error" class="workspace-overlay" hidden>
      <section class="welcome-card">
        <h1>PDF couldn’t be opened</h1>
        <p id="error-message" role="alert"></p>
        <button id="retry-file" class="button primary" type="button">Choose file</button>
      </section>
    </div>
    <div id="notice" class="notice" hidden>
      <span id="notice-message" role="alert"></span>
      <button id="dismiss-notice" class="icon-button" type="button" aria-label="Dismiss message">×</button>
    </div>
    <div id="drop-overlay" class="workspace-overlay drop-overlay" aria-hidden="true" hidden>
      <div>Drop PDF to open</div>
    </div>
  </main>
  <dialog id="url-dialog" aria-labelledby="url-title">
    <form id="url-form">
      <h2 id="url-title">Open PDF from URL</h2>
      <label for="pdf-url">PDF URL</label>
      <input id="pdf-url" type="url" required placeholder="https://example.com/document.pdf" autofocus>
      <p id="url-error" class="field-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button id="cancel-url" class="button" type="button">Cancel</button>
        <button class="button primary" type="submit">Open PDF</button>
      </div>
    </form>
  </dialog>
  <dialog id="password-dialog" aria-labelledby="password-title">
    <form id="password-form">
      <h2 id="password-title">Password required</h2>
      <label for="pdf-password">PDF password</label>
      <input id="pdf-password" type="password" autocomplete="off" required autofocus>
      <p id="password-error" class="field-error" role="alert" hidden>Incorrect password. Try again.</p>
      <div class="dialog-actions">
        <button id="cancel-password" class="button" type="button">Cancel</button>
        <button class="button primary" type="submit">Unlock PDF</button>
      </div>
    </form>
  </dialog>
`;
