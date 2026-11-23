import type { PDFPageView, PDFViewer } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import { ColorRenderer } from "./color-renderer";

interface PageRender {
  source: Pick<PDFPageView, "canvas">;
  cssTransform: boolean;
  error?: Error;
}

export class PageColors {
  private readonly renderer = new ColorRenderer();
  private rendered = new WeakSet<HTMLCanvasElement>();
  private readonly displayed = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  private frame = 0;
  private inverted = false;

  constructor(private readonly viewer: PDFViewer) {
    viewer.eventBus.on("pagerendered", (event: PageRender) => {
      const { canvas } = event.source;
      if (canvas && !event.cssTransform && !event.error) this.rendered.add(canvas);
      this.schedule();
    });
    viewer.eventBus.on("updateviewarea", () => this.schedule());
    viewer.eventBus.on("pagesdestroy", () => this.reset());
  }

  setInverted(inverted: boolean) {
    this.inverted = inverted;
    if (inverted) {
      this.update();
    } else {
      this.clear();
    }
  }

  private schedule() {
    if (!this.inverted || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private update() {
    const visible = new Set<HTMLCanvasElement>();
    const region = this.viewer.container.getBoundingClientRect();
    for (const page of this.viewer.getCachedPageViews() as Iterable<PDFPageView>) {
      const box = page.div.getBoundingClientRect();
      if (!page.div.isConnected || box.bottom <= region.top || box.top >= region.bottom
          || box.right <= region.left || box.left >= region.right) continue;

      const canvases = page.div.querySelectorAll<HTMLCanvasElement>(".canvasWrapper > canvas");
      for (const source of canvases) {
        if (!this.rendered.has(source) || !source.width || !source.height) continue;
        visible.add(source);
        this.showInverted(source);
      }
    }

    for (const source of this.displayed.keys()) {
      if (!visible.has(source)) this.remove(source);
    }
  }

  private showInverted(source: HTMLCanvasElement) {
    let output = this.displayed.get(source);
    if (!output) {
      output = document.createElement("canvas");
      output.setAttribute("aria-hidden", "true");
      if (!this.renderer.draw(source, output)) return;
      this.displayed.set(source, output);
      source.classList.add("pdf-original-colors");
    }

    // Detail canvases are positioned over just the visible part of a zoomed page.
    // Match PDF.js's placement, including any transform applied during zoom.
    output.style.cssText = source.style.cssText;
    output.className = source.classList.contains("detailView")
      ? "detailView pdf-inverted-canvas"
      : "pdf-inverted-canvas";
    if (source.nextSibling !== output) source.after(output);
  }

  private remove(source: HTMLCanvasElement) {
    const output = this.displayed.get(source);
    if (!output) return;
    source.classList.remove("pdf-original-colors");
    output.remove();
    output.width = output.height = 0;
    this.displayed.delete(source);
  }

  private clear() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const source of this.displayed.keys()) this.remove(source);
    this.renderer.releaseBuffer();
  }

  private reset() {
    this.clear();
    this.rendered = new WeakSet();
  }
}
