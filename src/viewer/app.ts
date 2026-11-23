import "pdfjs-dist/legacy/web/pdf_viewer.css";
import "./styles.css";
import { layout } from "./layout";
import { FindState, PdfReader, type ReaderState } from "./pdf-reader";
import { DocumentSidebar } from "./sidebar";
import { OverflowPanel } from "./toolbar";
import {
  readPreferences, themeOptions, type Preferences, type PreferenceStore,
} from "./preferences";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing viewer element: ${id}`);
  return node as T;
}

function button(id: string): HTMLButtonElement {
  return element<HTMLButtonElement>(id);
}

function input(id: string): HTMLInputElement {
  return element<HTMLInputElement>(id);
}

type MatchCount = { current: number; total: number };

export function startViewer(store: PreferenceStore) {
  element("app").innerHTML = layout;

  const toolbar = element("document-toolbar");
  const scrollRegion = element<HTMLDivElement>("scroll-region");
  const pageInput = input("page-number");
  const pageCount = element("page-count");
  const previousPage = button("previous-page");
  const nextPage = button("next-page");
  const zoom = element<HTMLSelectElement>("zoom");
  const zoomPercentage = element("zoom-percentage");
  const theme = element<HTMLSelectElement>("theme");
  const invert = button("invert");
  const picker = input("file-picker");
  const searchPanel = element("search-panel");
  const searchToggle = button("show-search");
  const download = button("download");
  const overflow = new OverflowPanel(button("overflow-toggle"), element("overflow-panel"));
  const compactActions = new Map<string, HTMLButtonElement>();
  for (const action of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
    const target = action.dataset.action!;
    compactActions.set(target, action);
    action.addEventListener("click", () => button(target).click());
  }
  const query = input("search-query");
  const searchStatus = element("search-status");
  const urlDialog = element<HTMLDialogElement>("url-dialog");
  const urlInput = input("pdf-url");
  const urlError = element("url-error");
  const passwordDialog = element<HTMLDialogElement>("password-dialog");
  const passwordInput = input("pdf-password");
  const loadProgress = element<HTMLProgressElement>("load-progress");
  const notice = element("notice");

  let state: ReaderState = { kind: "idle" };
  let submitPassword: ((password: string) => void) | undefined;

  const reader = new PdfReader(scrollRegion, element<HTMLDivElement>("pages"), {
    state: updateState,
    password(submit, incorrect) {
      submitPassword = submit;
      passwordInput.value = "";
      element("password-error").hidden = !incorrect;
      if (!passwordDialog.open) passwordDialog.showModal();
      passwordInput.focus();
    },
    dismissPassword() {
      submitPassword = undefined;
      passwordInput.value = "";
      if (passwordDialog.open) passwordDialog.close();
    },
    notice: showNotice,
  });
  const sidebar = new DocumentSidebar({
    panel: element("sidebar"),
    toggle: button("toggle-sidebar"),
    scrim: element("sidebar-scrim"),
    thumbnailTab: button("show-thumbnails"),
    outlineTab: button("show-outline"),
    thumbnailPanel: element("thumbnails"),
    thumbnailList: element("thumbnail-list"),
    outline: element("outline"),
    documentRegion: scrollRegion,
  }, {
    goToPage: page => { void reader.goToPage(page); },
    goToDestination: destination => { void reader.goToDestination(destination); },
  }, reader.events);

  function showNotice(message: string) {
    element("notice-message").textContent = message;
    notice.hidden = false;
  }

  function updateState(next: ReaderState) {
    state = next;
    const ready = next.kind === "ready";
    toolbar.hidden = searchToggle.hidden = download.hidden = element("overflow-document-actions").hidden = !ready;
    scrollRegion.tabIndex = ready ? 0 : -1;
    element("welcome").hidden = next.kind !== "idle";
    element("load-panel").hidden = next.kind !== "loading";
    element("file-error").hidden = next.kind !== "error";
    const filename = element("filename");
    filename.textContent = filename.title = ready ? next.name : "PDF Reader";
    sidebar.setDocument(ready ? next.pdf : undefined);

    if (next.kind === "ready") {
      document.title = `${next.name} · PDF Reader`;
      updatePage(reader.view.currentPageNumber);
      scrollRegion.focus({ preventScroll: true });
      return;
    }

    setDownloadBusy(false);
    if (next.kind !== "loading") sidebar.close();
    hideSearch(false);
    query.value = "";
    searchStatus.textContent = "";
    notice.hidden = true;
    document.title = "PDF Reader";

    if (next.kind === "loading") {
      element("load-name").textContent = next.name;
      if (next.progress === undefined) loadProgress.removeAttribute("value");
      else loadProgress.value = next.progress;
    } else if (next.kind === "error") {
      element("error-message").textContent = next.message;
      button("retry-file").focus();
    }
  }

  function updatePage(pageNumber: number) {
    if (state.kind !== "ready") return;
    pageInput.value = String(pageNumber);
    pageCount.textContent = `/ ${state.pdf.numPages}`;
    pageInput.style.width = `${Math.max(2, String(state.pdf.numPages).length)}ch`;
    previousPage.disabled = pageNumber <= 1;
    nextPage.disabled = pageNumber >= state.pdf.numPages;
    sidebar.select(pageNumber);
  }

  function find(type = "", findPrevious = false) {
    if (state.kind !== "ready") return;
    const phrase = query.value.trim();
    if (!phrase) searchStatus.textContent = "";
    reader.events.dispatch("find", {
      source: query,
      type,
      query: phrase,
      findPrevious,
      highlightAll: true,
      caseSensitive: false,
      entireWord: false,
      matchDiacritics: false,
    });
  }

  function showSearch() {
    if (state.kind !== "ready") return;
    searchPanel.hidden = false;
    searchToggle.setAttribute("aria-expanded", "true");
    compactActions.get("show-search")?.setAttribute("aria-expanded", "true");
    query.focus();
    query.select();
    if (query.value) find();
  }

  function hideSearch(restoreFocus = true) {
    if (searchPanel.hidden) return;
    searchPanel.hidden = true;
    searchToggle.setAttribute("aria-expanded", "false");
    compactActions.get("show-search")?.setAttribute("aria-expanded", "false");
    reader.events.dispatch("findbarclose", { source: query });
    if (restoreFocus) (searchToggle.offsetParent ? searchToggle : overflow.toggle).focus();
  }

  function updateMatches(matches: MatchCount) {
    if (!searchPanel.hidden && query.value.trim() && matches.total) {
      searchStatus.textContent = `${matches.current} of ${matches.total}`;
    }
  }

  reader.events.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => updatePage(pageNumber));
  reader.events.on("rotationchanging", ({ pagesRotation }: { pagesRotation: number }) => sidebar.rotate(pagesRotation));
  reader.events.on("scalechanging", ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
    const percentage = `${Math.round(scale * 100)}%`;
    zoomPercentage.textContent = zoom.options[0].textContent = percentage;
    zoom.value = presetValue === "page-fit" || presetValue === "page-width" ? presetValue : "";
    zoom.title = `Zoom: ${percentage}`;
    zoom.setAttribute("aria-label", `Zoom level, ${percentage}`);
    for (const fit of ["fit-page", "fit-width"]) {
      const preset = fit === "fit-page" ? "page-fit" : "page-width";
      const pressed = String(presetValue === preset);
      button(fit).setAttribute("aria-pressed", pressed);
      compactActions.get(fit)?.setAttribute("aria-pressed", pressed);
    }
  });
  reader.events.on("updatefindmatchescount", ({ matchesCount }: { matchesCount: MatchCount }) => updateMatches(matchesCount));
  reader.events.on("updatefindcontrolstate", ({ state: result, matchesCount }: { state: number; matchesCount: MatchCount }) => {
    if (searchPanel.hidden || !query.value.trim()) return;
    if (result === FindState.PENDING) searchStatus.textContent = "Searching…";
    else if (result === FindState.NOT_FOUND) searchStatus.textContent = "No matches";
    else updateMatches(matchesCount);
  });

  function setZoom(value: string) {
    const page = reader.view.currentPageNumber;
    reader.view.currentScaleValue = value;
    if (value === "page-fit" || reader.view.currentPageNumber !== page) {
      reader.view.currentPageNumber = page;
    }
  }

  new ResizeObserver(() => {
    if (state.kind !== "ready") return;
    const preset = reader.view.currentScaleValue;
    if (preset === "page-fit" || preset === "page-width") setZoom(preset);
    reader.view.update();
  }).observe(scrollRegion);

  const changed = new Set<keyof Preferences>();
  function applyTheme(value: Preferences["theme"]) {
    document.documentElement.dataset.theme = theme.value = value;
  }
  function applyInversion(value: boolean) {
    invert.setAttribute("aria-pressed", String(value));
    reader.colors.setInverted(value);
  }
  async function restorePreferences() {
    const preferences = readPreferences(await store.read().catch(() => ({})));
    if (!changed.has("theme")) applyTheme(preferences.theme);
    if (!changed.has("inverted")) applyInversion(preferences.inverted);
  }
  function savePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    changed.add(key);
    void store.write(key, value).catch(() => showNotice("Couldn’t save preferences."));
  }
  void restorePreferences();

  theme.addEventListener("change", () => {
    const value = themeOptions.find(option => option === theme.value) ?? "system";
    applyTheme(value);
    savePreference("theme", value);
  });
  invert.addEventListener("click", () => {
    const value = invert.getAttribute("aria-pressed") !== "true";
    applyInversion(value);
    savePreference("inverted", value);
  });
  element("dismiss-notice").addEventListener("click", () => { notice.hidden = true; });

  function openLocalFile() {
    overflow.close(true);
    picker.click();
  }
  for (const id of ["open-file", "choose-file", "retry-file"]) button(id).addEventListener("click", openLocalFile);
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (file) void reader.open(file);
  });

  button("open-url").addEventListener("click", () => {
    overflow.close(true);
    urlError.hidden = true;
    urlDialog.showModal();
    urlInput.select();
  });
  button("cancel-url").addEventListener("click", () => urlDialog.close());
  urlInput.addEventListener("input", () => { urlError.hidden = true; });
  element("url-form").addEventListener("submit", event => {
    event.preventDefault();
    const url = URL.parse(urlInput.value.trim());
    if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      urlError.textContent = "Enter an HTTP or HTTPS URL without embedded credentials.";
      urlError.hidden = false;
      return;
    }
    urlDialog.close();
    void reader.open(url);
  });

  element("password-form").addEventListener("submit", event => {
    event.preventDefault();
    const submit = submitPassword;
    submitPassword = undefined;
    passwordDialog.close();
    submit?.(passwordInput.value);
    passwordInput.value = "";
  });
  passwordDialog.addEventListener("cancel", event => {
    event.preventDefault();
    closePdf();
  });
  button("cancel-password").addEventListener("click", closePdf);
  button("cancel-load").addEventListener("click", closePdf);
  button("close-file").addEventListener("click", closePdf);

  function closePdf() {
    reader.close();
    button("choose-file").focus();
  }

  function setDownloadBusy(busy: boolean) {
    download.disabled = busy;
    const compactDownload = compactActions.get("download");
    if (compactDownload) compactDownload.disabled = busy;
  }

  download.addEventListener("click", async () => {
    const started = state;
    setDownloadBusy(true);
    try {
      await reader.downloadOriginal();
    } finally {
      if (state === started) setDownloadBusy(false);
    }
  });

  element("page-navigation").addEventListener("submit", event => {
    event.preventDefault();
    pageInput.blur();
  });
  pageInput.addEventListener("change", () => {
    const page = Number(pageInput.value);
    if (Number.isInteger(page) && state.kind === "ready") {
      void reader.goToPage(Math.max(1, Math.min(state.pdf.numPages, page)));
    }
    updatePage(reader.view.currentPageNumber);
  });
  previousPage.addEventListener("click", () => { void reader.goToPage(reader.view.currentPageNumber - 1); });
  nextPage.addEventListener("click", () => { void reader.goToPage(reader.view.currentPageNumber + 1); });
  zoom.addEventListener("change", () => setZoom(zoom.value));
  button("zoom-in").addEventListener("click", () => reader.view.increaseScale());
  button("zoom-out").addEventListener("click", () => reader.view.decreaseScale());
  button("fit-page").addEventListener("click", () => setZoom("page-fit"));
  button("fit-width").addEventListener("click", () => setZoom("page-width"));
  button("rotate").addEventListener("click", () => {
    const page = reader.view.currentPageNumber;
    reader.view.pagesRotation += 90;
    void reader.goToPage(page);
  });

  searchToggle.addEventListener("click", () => searchPanel.hidden ? showSearch() : hideSearch());
  button("close-search").addEventListener("click", () => hideSearch());
  query.addEventListener("input", () => find());
  query.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      find("again", true);
    }
  });
  element("search-form").addEventListener("submit", event => {
    event.preventDefault();
    find("again");
  });
  button("previous-match").addEventListener("click", () => find("again", true));
  button("next-match").addEventListener("click", () => find("again"));

  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || passwordDialog.open || urlDialog.open) return;
    if (event.key === "Escape" && !searchPanel.hidden) {
      hideSearch();
    } else if (event.key === "Escape" && sidebar.close(true)) {
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        openLocalFile();
      } else if (key === "f" && state.kind === "ready") {
        event.preventDefault();
        showSearch();
      }
    }
  });

  bindDrop(file => { void reader.open(file); });
  window.addEventListener("pagehide", event => {
    if (!event.persisted) reader.close();
  });
}

function bindDrop(open: (file: File) => void) {
  const overlay = element("drop-overlay");
  let depth = 0;

  const reset = () => {
    depth = 0;
    overlay.hidden = true;
  };
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files");

  window.addEventListener("dragenter", event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener("dragover", event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", () => {
    if (depth > 0 && --depth === 0) reset();
  });
  window.addEventListener("drop", event => {
    reset();
    if (!hasFiles(event)) return;
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) open(file);
  });
  window.addEventListener("dragend", reset);
}
