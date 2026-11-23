import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { EventBus } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

type OutlineItem = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];
type Destination = NonNullable<OutlineItem["dest"]>;

interface SidebarActions {
  goToPage(page: number): void;
  goToDestination(destination: Destination): void;
}

interface SidebarElements {
  panel: HTMLElement;
  toggle: HTMLButtonElement;
  scrim: HTMLElement;
  thumbnailTab: HTMLButtonElement;
  outlineTab: HTMLButtonElement;
  thumbnailPanel: HTMLElement;
  thumbnailList: HTMLElement;
  outline: HTMLElement;
  documentRegion: HTMLElement;
}

interface Thumbnail {
  button: HTMLButtonElement;
  frame: HTMLElement;
  canvas?: HTMLCanvasElement;
  finished?: boolean;
}

interface ThumbnailJob {
  thumbnail: Thumbnail;
  task?: RenderTask;
}

const rowHeight = 168;
const overscan = 2;

class ThumbnailList {
  private pdf?: PDFDocumentProxy;
  private page = 1;
  private rotation = 0;
  private visible = false;
  private frame = 0;
  private job?: ThumbnailJob;
  private readonly rows = new Map<number, Thumbnail>();

  constructor(
    private readonly viewport: HTMLElement,
    private readonly list: HTMLElement,
    navigate: (page: number) => void,
    private readonly events: EventBus,
  ) {
    list.style.setProperty("--thumbnail-row-height", `${rowHeight}px`);
    viewport.addEventListener("scroll", () => this.schedule());
    new ResizeObserver(() => this.schedule()).observe(viewport);
    list.addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
      if (button) navigate(Number(button.dataset.page));
    });
    viewport.addEventListener("keydown", event => {
      if (!this.pdf || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const current = Number((event.target as HTMLElement).dataset.page) || this.page;
      let page: number;
      switch (event.key) {
        case "ArrowUp": page = Math.max(1, current - 1); break;
        case "ArrowDown": page = Math.min(this.pdf.numPages, current + 1); break;
        case "Home": page = 1; break;
        case "End": page = this.pdf.numPages; break;
        case "Enter":
        case " ":
          if (event.target !== viewport) return;
          event.preventDefault();
          navigate(current);
          return;
        default: return;
      }
      event.preventDefault();
      this.reveal(page);
      this.update();
      this.rows.get(page)?.button.focus({ preventScroll: true });
    });
  }

  setDocument(pdf?: PDFDocumentProxy) {
    this.pdf = pdf;
    this.page = 1;
    this.rotation = 0;
    this.clear();
    this.list.style.height = `${(pdf?.numPages ?? 0) * rowHeight}px`;
    this.viewport.scrollTop = 0;
  }

  show(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) {
      this.reveal(this.page);
      this.schedule();
    } else {
      this.clear();
    }
  }

  select(page: number) {
    if (this.page === page) return;
    this.rows.get(this.page)?.button.removeAttribute("aria-current");
    this.page = page;
    this.rows.get(page)?.button.setAttribute("aria-current", "page");
    if (this.visible) {
      this.reveal(page);
      this.schedule();
    }
  }

  rotate(rotation: number) {
    this.rotation = rotation;
    for (const thumbnail of this.rows.values()) {
      this.release(thumbnail);
      thumbnail.finished = false;
    }
    this.schedule();
  }

  private reveal(page: number) {
    const top = (page - 1) * rowHeight;
    const { clientHeight, scrollTop } = this.viewport;
    if (top < scrollTop || top + rowHeight > scrollTop + clientHeight) {
      this.viewport.scrollTop = top + (rowHeight - clientHeight) / 2;
    }
  }

  private clear() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const thumbnail of this.rows.values()) this.release(thumbnail);
    this.rows.clear();
    this.list.replaceChildren();
  }

  private release(thumbnail: Thumbnail) {
    if (this.job?.thumbnail === thumbnail) {
      const job = this.job;
      this.job = undefined;
      job.task?.cancel();
    }
    if (thumbnail.canvas) {
      thumbnail.canvas.remove();
      thumbnail.canvas.width = thumbnail.canvas.height = 0;
      thumbnail.canvas = undefined;
    }
  }

  private schedule() {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private update() {
    if (!this.pdf || !this.visible) return;
    const { clientHeight, scrollTop } = this.viewport;
    if (!clientHeight) return;
    const firstVisible = Math.floor(scrollTop / rowHeight) + 1;
    const first = Math.max(1, firstVisible - overscan);
    const last = Math.min(this.pdf.numPages, Math.ceil((scrollTop + clientHeight) / rowHeight) + overscan);

    for (const [page, thumbnail] of this.rows) {
      if (page >= first && page <= last) continue;
      if (document.activeElement === thumbnail.button) this.viewport.focus({ preventScroll: true });
      this.release(thumbnail);
      thumbnail.button.remove();
      this.rows.delete(page);
    }

    let next: [number, Thumbnail] | undefined;
    for (let page = last; page >= first; page--) {
      const thumbnail = this.rows.get(page) ?? this.add(page);
      if (!thumbnail.finished && (!next || Math.abs(page - firstVisible) < Math.abs(next[0] - firstVisible))) {
        next = [page, thumbnail];
      }
    }
    if (!this.job && next) void this.render(this.pdf, ...next);
  }

  private add(page: number): Thumbnail {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumbnail";
    button.tabIndex = -1;
    button.dataset.page = String(page);
    button.style.top = `${(page - 1) * rowHeight}px`;
    button.setAttribute("aria-label", `Page ${page}`);
    if (page === this.page) button.setAttribute("aria-current", "page");
    const frame = document.createElement("span");
    frame.className = "thumbnail-frame";
    frame.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = String(page);
    button.append(frame, label);
    this.list.insertBefore(button, this.rows.get(page + 1)?.button ?? null);
    const thumbnail = { button, frame };
    this.rows.set(page, thumbnail);
    return thumbnail;
  }

  private async render(pdf: PDFDocumentProxy, pageNumber: number, thumbnail: Thumbnail) {
    const job: ThumbnailJob = { thumbnail };
    this.job = job;
    let canvas: HTMLCanvasElement | undefined;
    let page: PDFPageProxy | undefined;
    try {
      page = await pdf.getPage(pageNumber);
      if (this.job !== job) return;
      const rotation = (page.rotate + this.rotation) % 360;
      const natural = page.getViewport({ scale: 1, rotation });
      const viewport = page.getViewport({ scale: Math.min(110 / natural.width, 125 / natural.height), rotation });
      const density = Math.min(window.devicePixelRatio || 1, 2);
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width * density));
      canvas.height = Math.max(1, Math.ceil(viewport.height * density));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      job.task = page.render({ canvas, viewport, transform: [density, 0, 0, density, 0, 0] });
      await job.task.promise;
      if (this.job !== job) return;
      thumbnail.frame.append(canvas);
      thumbnail.canvas = canvas;
    } catch {
      // A missing preview still leaves the page number available for navigation.
    } finally {
      if (canvas && thumbnail.canvas !== canvas) canvas.width = canvas.height = 0;
      if (job.task && this.pdf === pdf) {
        // PDFViewer cleans the page's rendering data if its own cache doesn't use it.
        this.events.dispatch("thumbnailrendered", { source: this, pageNumber, pdfPage: page });
      }
      if (this.job === job) {
        this.job = undefined;
        thumbnail.finished = true;
        this.schedule();
      }
    }
  }
}

export class DocumentSidebar {
  private readonly thumbnails: ThumbnailList;
  private pdf?: PDFDocumentProxy;
  private requestedOpen = false;
  private showingOutline = false;
  private outlineRequested = false;
  private readonly narrow = matchMedia("(max-width: 720px)");

  constructor(private readonly elements: SidebarElements, private readonly actions: SidebarActions, events: EventBus) {
    const { panel, toggle, scrim, thumbnailTab, outlineTab, thumbnailPanel, thumbnailList } = elements;
    this.thumbnails = new ThumbnailList(thumbnailPanel, thumbnailList, page => {
      this.actions.goToPage(page);
      this.finishNavigation();
    }, events);
    toggle.addEventListener("click", event => {
      this.requestedOpen = panel.hidden === true;
      this.updateVisibility();
      if (this.requestedOpen && event.detail === 0) {
        (this.showingOutline ? outlineTab : thumbnailTab).focus({ preventScroll: true });
      }
    });
    scrim.addEventListener("click", () => this.close(true));
    this.narrow.addEventListener("change", () => this.updateVisibility());
    thumbnailTab.addEventListener("click", () => this.switchView(false));
    outlineTab.addEventListener("click", () => this.switchView(true));
  }

  setDocument(pdf?: PDFDocumentProxy) {
    if (this.pdf === pdf) return;
    this.pdf = pdf;
    this.thumbnails.show(false);
    this.thumbnails.setDocument(pdf);
    this.outlineRequested = false;
    this.elements.outline.replaceChildren();
    this.elements.outline.scrollTop = 0;
    this.updateVisibility();
  }

  select(page: number) {
    this.thumbnails.select(page);
  }

  rotate(rotation: number) {
    this.thumbnails.rotate(rotation);
  }

  close(restoreFocus = false) {
    if (!this.requestedOpen) return false;
    this.requestedOpen = false;
    this.updateVisibility();
    if (restoreFocus && !this.elements.toggle.disabled) this.elements.toggle.focus();
    return true;
  }

  private switchView(outline: boolean) {
    const { thumbnailTab, outlineTab, thumbnailPanel } = this.elements;
    this.showingOutline = outline;
    thumbnailTab.setAttribute("aria-pressed", String(!outline));
    outlineTab.setAttribute("aria-pressed", String(outline));
    thumbnailPanel.hidden = outline;
    this.elements.outline.hidden = !outline;
    this.updateVisibility();
  }

  private updateVisibility() {
    const { panel, toggle, scrim, documentRegion, outlineTab, thumbnailTab } = this.elements;
    const open = Boolean(this.pdf && this.requestedOpen);
    toggle.disabled = !this.pdf;
    toggle.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
    scrim.hidden = !open || !this.narrow.matches;
    if (!scrim.hidden && documentRegion.contains(document.activeElement)) {
      (this.showingOutline ? outlineTab : thumbnailTab).focus({ preventScroll: true });
    }
    documentRegion.inert = !scrim.hidden;
    this.thumbnails.show(open && !this.showingOutline);
    if (open && this.showingOutline && !this.outlineRequested && this.pdf) void this.loadOutline(this.pdf);
  }

  private finishNavigation() {
    if (this.narrow.matches) {
      this.close();
      this.elements.documentRegion.focus({ preventScroll: true });
    }
  }

  private async loadOutline(pdf: PDFDocumentProxy) {
    const { outline } = this.elements;
    this.outlineRequested = true;
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Loading outline…";
    outline.replaceChildren(status);
    try {
      const items = await pdf.getOutline();
      if (this.pdf !== pdf) return;
      if (items?.length) outline.replaceChildren(this.outlineTree(items));
      else status.textContent = "This PDF has no document outline.";
    } catch {
      if (this.pdf === pdf) status.textContent = "Couldn’t load the document outline.";
    }
  }

  private outlineTree(items: OutlineItem[]): HTMLUListElement {
    const list = document.createElement("ul");
    for (const item of items) {
      const entry = document.createElement("li");
      let label: HTMLElement;
      if (item.url) {
        const link = document.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        label = link;
      } else if (item.dest !== null) {
        const destination = item.dest;
        const button = document.createElement("button");
        button.type = "button";
        button.addEventListener("click", () => {
          this.actions.goToDestination(destination);
          this.finishNavigation();
        });
        label = button;
      } else {
        label = document.createElement("span");
      }
      label.textContent = item.title || "Untitled bookmark";
      entry.append(label);
      if (item.items.length) entry.append(this.outlineTree(item.items));
      list.append(entry);
    }
    return list;
  }
}
