const icons = {
  sidebar: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M9 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  fitPage: '<rect x="7" y="3" width="10" height="18" rx="1"/><path d="m10 9 2-2 2 2m-4 6 2 2 2-2"/>',
  fitWidth: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="m9 10-2 2 2 2m6-4 2 2-2 2"/>',
  rotate: '<path d="M20 8a8 8 0 0 0-14-1M20 3v5h-5"/><rect x="6" y="11" width="9" height="9" rx="1" transform="rotate(-20 10.5 15.5)"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  invert: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  more: '<path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="3"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

function iconButton(
  id: string, icon: keyof typeof icons, label: string, attributes = "", tooltip = label,
) {
  return `<button id="${id}" type="button" class="icon-button" aria-label="${label}" title="${tooltip}" ${attributes}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon]}</svg>
  </button>`;
}

export const layout = `
  <header class="reader-header">
    <div class="toolbar-start">
      ${iconButton("toggle-sidebar", "sidebar", "Toggle sidebar", 'aria-controls="sidebar" aria-expanded="false" disabled')}
      <span id="filename">PDF Reader</span>
    </div>
    <div id="document-toolbar" class="document-toolbar" hidden>
      <form id="page-navigation" aria-label="Page navigation">
        <input id="page-number" type="text" inputmode="numeric" size="3" aria-label="Page number" value="1">
        <span id="page-count"></span>
      </form>
      <div class="zoom-controls" role="group" aria-label="Zoom controls">
        ${iconButton("zoom-out", "minus", "Zoom out")}
        <label class="zoom-display">
          <select id="zoom" aria-label="Zoom level">
            <option value="" hidden></option>
            <option value="page-fit">Fit page</option>
            <option value="page-width">Fit width</option>
            <option value="1">Actual size</option>
          </select>
          <span id="zoom-percentage" aria-hidden="true">100%</span>
        </label>
        ${iconButton("zoom-in", "plus", "Zoom in")}
      </div>
      <div class="layout-controls" role="group" aria-label="Page layout">
        ${iconButton("fit-page", "fitPage", "Fit page", 'aria-pressed="false"')}
        ${iconButton("fit-width", "fitWidth", "Fit width", 'aria-pressed="false"')}
        ${iconButton("rotate", "rotate", "Rotate clockwise")}
      </div>
    </div>
    <div class="toolbar-end">
      ${iconButton("show-search", "search", "Find in PDF", 'aria-expanded="false" aria-controls="search-panel" hidden',
        "Find in PDF (Ctrl or Command + F)")}
      ${iconButton("invert", "invert", "Invert PDF", 'aria-pressed="false"', "Invert PDF lightness while preserving hue")}
      ${iconButton("download", "download", "Download the original PDF", "hidden")}
      ${iconButton("overflow-toggle", "more", "More actions", 'aria-controls="overflow-panel" aria-expanded="false"')}
    </div>
    <input id="file-picker" type="file" accept=".pdf,application/pdf" hidden>
    <div id="overflow-panel" class="overflow-panel" role="group" aria-label="More actions" hidden>
      <button id="open-file" type="button" title="Open file (Ctrl or Command + O)">Open file</button>
      <button id="open-url" type="button">Open URL</button>
      <div id="overflow-document-actions" hidden>
        <button id="previous-page" type="button">Previous page</button>
        <button id="next-page" type="button">Next page</button>
        <button class="compact-action" type="button" data-action="fit-page" aria-pressed="false">Fit page</button>
        <button class="compact-action" type="button" data-action="fit-width" aria-pressed="false">Fit width</button>
        <button class="compact-action" type="button" data-action="rotate">Rotate clockwise</button>
        <button class="compact-action" type="button" data-action="show-search"
          aria-expanded="false" aria-controls="search-panel">Find in PDF</button>
        <button class="compact-action" type="button" data-action="download">Download original PDF</button>
        <button id="close-file" type="button">Close PDF</button>
      </div>
      <label class="theme-control">
        <span>Theme</span>
        <select id="theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </div>
    <div id="search-panel" class="search-panel" role="search" aria-label="Find in PDF" hidden>
      <form id="search-form" class="search-form">
        <input id="search-query" type="search" placeholder="Find in PDF…" aria-label="Find in PDF" autocomplete="off">
        <output id="search-status" role="status" aria-live="polite"></output>
        ${iconButton("previous-match", "up", "Previous match")}
        ${iconButton("next-match", "down", "Next match")}
        ${iconButton("close-search", "close", "Close search")}
      </form>
    </div>
  </header>
  <main class="workspace">
    <div id="sidebar-scrim" class="sidebar-scrim" aria-hidden="true" hidden></div>
    <aside id="sidebar" class="document-sidebar" aria-label="Document navigation" hidden>
      <div class="sidebar-controls" role="group" aria-label="Sidebar view">
        <button id="show-thumbnails" type="button" aria-controls="thumbnails" aria-pressed="true">Thumbnails</button>
        <button id="show-outline" type="button" aria-controls="outline" aria-pressed="false">Outline</button>
      </div>
      <div id="thumbnails" tabindex="0" role="region" aria-label="Page thumbnails"
        aria-description="Use the arrow keys to browse thumbnails and Enter to open a page.">
        <div id="thumbnail-list"></div>
      </div>
      <nav id="outline" aria-label="Document outline" hidden></nav>
    </aside>
    <div id="scroll-region" class="scroll-region" tabindex="-1" role="region" aria-label="PDF pages">
      <div id="pages" class="pdfViewer"></div>
    </div>
    <div id="welcome" class="workspace-overlay">
      <section class="workspace-message">
        <h1>Open a PDF</h1>
        <p>Drop a PDF here or choose a file from your device.</p>
        <button id="choose-file" class="button primary" type="button">Choose file</button>
      </section>
    </div>
    <div id="load-panel" class="workspace-overlay" hidden>
      <section class="workspace-message">
        <h1>Opening PDF</h1>
        <p id="load-name"></p>
        <progress id="load-progress" max="100" aria-label="Loading PDF"></progress>
        <button id="cancel-load" class="button" type="button">Cancel</button>
      </section>
    </div>
    <div id="file-error" class="workspace-overlay" hidden>
      <section class="workspace-message">
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
