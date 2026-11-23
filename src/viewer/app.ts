import "pdfjs-dist/legacy/web/pdf_viewer.css";
import "./styles.css";
import { layout } from "./layout";
import { FindState, PdfReader, type ReaderState } from "./pdf-reader";
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
  const theme = element<HTMLSelectElement>("theme");
  const invert = button("invert");
  const picker = input("file-picker");
  const searchPanel = element("search-panel");
  const searchToggle = button("show-search");
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

  function showNotice(message: string) {
    element("notice-message").textContent = message;
    notice.hidden = false;
  }

  function updateState(next: ReaderState) {
    state = next;
    toolbar.hidden = next.kind !== "ready";
    scrollRegion.tabIndex = next.kind === "ready" ? 0 : -1;
    element("welcome").hidden = next.kind !== "idle";
    element("load-panel").hidden = next.kind !== "loading";
    element("file-error").hidden = next.kind !== "error";

    if (next.kind === "ready") {
      const filename = element("filename");
      filename.textContent = filename.title = next.name;
      document.title = `${next.name} · PDF Reader`;
      updatePage(reader.view.currentPageNumber);
      scrollRegion.focus({ preventScroll: true });
      return;
    }

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
    pageCount.textContent = `/ ${state.pages}`;
    previousPage.disabled = pageNumber <= 1;
    nextPage.disabled = pageNumber >= state.pages;
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
    query.focus();
    query.select();
    if (query.value) find();
  }

  function hideSearch(restoreFocus = true) {
    if (searchPanel.hidden) return;
    searchPanel.hidden = true;
    searchToggle.setAttribute("aria-expanded", "false");
    reader.events.dispatch("findbarclose", { source: query });
    if (restoreFocus) searchToggle.focus();
  }

  function updateMatches(matches: MatchCount) {
    if (!searchPanel.hidden && query.value.trim() && matches.total) {
      searchStatus.textContent = `${matches.current} of ${matches.total}`;
    }
  }

  reader.events.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => updatePage(pageNumber));
  reader.events.on("scalechanging", ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
    const current = zoom.options[0];
    current.textContent = `${Math.round(scale * 100)}%`;
    zoom.value = presetValue === "page-fit" || presetValue === "page-width" ? presetValue : "";
    zoom.title = `Zoom: ${current.textContent}`;
  });
  reader.events.on("updatefindmatchescount", ({ matchesCount }: { matchesCount: MatchCount }) => updateMatches(matchesCount));
  reader.events.on("updatefindcontrolstate", ({ state: result, matchesCount }: { state: number; matchesCount: MatchCount }) => {
    if (searchPanel.hidden || !query.value.trim()) return;
    if (result === FindState.PENDING) searchStatus.textContent = "Searching…";
    else if (result === FindState.NOT_FOUND) searchStatus.textContent = "No matches";
    else updateMatches(matchesCount);
  });

  new ResizeObserver(() => {
    if (state.kind !== "ready") return;
    const preset = reader.view.currentScaleValue;
    if (preset === "page-fit" || preset === "page-width") reader.view.currentScaleValue = preset;
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

  for (const id of ["open-file", "choose-file", "retry-file"]) {
    button(id).addEventListener("click", () => picker.click());
  }
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (file) void reader.open(file);
  });

  button("open-url").addEventListener("click", () => {
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

  button("download").addEventListener("click", async () => {
    const download = button("download");
    download.disabled = true;
    try {
      await reader.downloadOriginal();
    } finally {
      download.disabled = false;
    }
  });

  element("page-navigation").addEventListener("submit", event => {
    event.preventDefault();
    pageInput.blur();
  });
  pageInput.addEventListener("change", () => {
    const page = Number(pageInput.value);
    if (Number.isInteger(page) && state.kind === "ready") {
      void reader.goToPage(Math.max(1, Math.min(state.pages, page)));
    }
    updatePage(reader.view.currentPageNumber);
  });
  previousPage.addEventListener("click", () => { void reader.goToPage(reader.view.currentPageNumber - 1); });
  nextPage.addEventListener("click", () => { void reader.goToPage(reader.view.currentPageNumber + 1); });
  zoom.addEventListener("change", () => { reader.view.currentScaleValue = zoom.value; });
  button("zoom-in").addEventListener("click", () => reader.view.increaseScale());
  button("zoom-out").addEventListener("click", () => reader.view.decreaseScale());

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

  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || passwordDialog.open || urlDialog.open) return;
    if (event.key === "Escape" && !searchPanel.hidden) {
      hideSearch();
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        picker.click();
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
