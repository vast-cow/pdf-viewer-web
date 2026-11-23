import {
  AnnotationEditorType, getDocument, getPdfFilenameFromUrl, InvalidPDFException,
  PasswordResponses, PDFDataRangeTransport, ResponseException,
  type PDFDocumentLoadingTask, type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  DownloadManager, EventBus, LinkTarget, PDFFindController, PDFLinkService, PDFViewer,
  type PDFPageView,
} from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import { annotationImages, pdfAssets } from "./pdf-assets";
import { PageColors } from "./page-colors";

export { FindState } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

type Source = File | URL;

interface DocumentSession {
  source: Source;
  name: string;
  task?: PDFDocumentLoadingTask;
  pdf?: PDFDocumentProxy;
}

export type ReaderState =
  | { kind: "idle" }
  | { kind: "loading"; name: string; progress?: number }
  | { kind: "ready"; name: string; pages: number }
  | { kind: "error"; message: string };

interface ReaderCallbacks {
  state(state: ReaderState): void;
  password(submit: (password: string) => void, incorrect: boolean): void;
  dismissPassword(): void;
  notice(message: string): void;
}

const rangeSize = 64 * 1024;

class LocalFileRanges extends PDFDataRangeTransport {
  private stopped = false;

  constructor(
    private readonly file: File,
    initialData: Uint8Array,
    private readonly onReadError: () => void,
  ) {
    super(file.size, initialData, true, file.name);
  }

  override requestDataRange(begin: number, end: number) {
    void this.file.slice(begin, end).arrayBuffer().then(data => {
      if (!this.stopped) this.onDataRange(begin, new Uint8Array(data));
    }, () => {
      if (!this.stopped) this.onReadError();
    });
  }

  override abort() {
    this.stopped = true;
  }
}

function describeError(error: unknown, remote: boolean): string {
  if (error instanceof InvalidPDFException) return "This PDF is invalid or damaged.";
  if (error instanceof ResponseException && error.status === 404) return "No PDF was found at this URL.";
  return remote
    ? "Couldn’t load this PDF. Check the URL and whether the server allows cross-origin PDF requests."
    : "Couldn’t read this PDF. Check that the file is accessible and try opening it again.";
}

function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Allow the browser to begin reading the blob before revoking the download URL.
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

function pdfBlob(bytes: Uint8Array, type = "application/pdf"): Blob {
  const { buffer, byteOffset, byteLength } = bytes;
  const content = buffer instanceof ArrayBuffer ? new DataView(buffer, byteOffset, byteLength) : bytes.slice();
  return new Blob([content], { type });
}

class AttachmentDownloads extends DownloadManager {
  override openOrDownloadData(data: Uint8Array, filename: string) {
    this.downloadData(data, filename, "application/octet-stream");
    return false;
  }

  override downloadData(data: Uint8Array, filename: string, contentType: string) {
    download(pdfBlob(data, contentType), filename);
  }
}

export class PdfReader {
  readonly events = new EventBus();
  readonly view: PDFViewer;
  readonly colors: PageColors;
  private readonly links: PDFLinkService;
  private active: DocumentSession | undefined;
  private disposing = Promise.resolve();

  constructor(container: HTMLDivElement, pages: HTMLDivElement, private readonly callbacks: ReaderCallbacks) {
    this.links = new PDFLinkService({ eventBus: this.events, externalLinkTarget: LinkTarget.BLANK });
    const findController = new PDFFindController({ eventBus: this.events, linkService: this.links });
    this.view = new PDFViewer({
      container,
      viewer: pages,
      eventBus: this.events,
      linkService: this.links,
      findController,
      downloadManager: new AttachmentDownloads(),
      annotationEditorMode: AnnotationEditorType.DISABLE,
      imageResourcesPath: annotationImages,
      maxCanvasPixels: 4 * 1024 * 1024,
      maxCanvasDim: 8192,
      enableOptimizedPartialRendering: true,
    });
    this.links.setViewer(this.view);
    this.colors = new PageColors(this.view);

    this.events.on("pagesinit", () => {
      const session = this.active;
      if (!session?.pdf) return;
      this.callbacks.state({ kind: "ready", name: session.name, pages: session.pdf.numPages });
      this.view.currentScaleValue = "page-fit";
    });
    this.events.on("pagerendered", ({ error, pageNumber }: { error?: Error; pageNumber: number }) => {
      if (error) this.callbacks.notice(`Page ${pageNumber} couldn’t be rendered.`);
    });
  }

  async open(source: Source) {
    this.detach();
    const name = source instanceof File ? source.name : getPdfFilenameFromUrl(source.href);
    const session: DocumentSession = { source, name };
    this.active = session;
    this.callbacks.state({ kind: "loading", name });

    try {
      await this.disposing;
      if (this.active !== session) return;
      const input = source instanceof File
        ? await this.localInput(source, session)
        : { url: source.href, docBaseUrl: source.href };
      if (this.active !== session) return;

      const task = session.task = getDocument({
        ...pdfAssets, ...input, rangeChunkSize: rangeSize, disableStream: true, disableAutoFetch: true,
        canvasMaxAreaInBytes: 32 * 1024 * 1024,
      });
      task.onProgress = ({ percent }: { percent: number }) => {
        if (this.active === session && !session.pdf && Number.isFinite(percent)) {
          this.callbacks.state({ kind: "loading", name, progress: percent });
        }
      };
      task.onPassword = (submit: (password: string) => void, reason: number) => {
        if (this.active === session) this.callbacks.password(submit, reason === PasswordResponses.INCORRECT_PASSWORD);
      };

      const pdf = await task.promise;
      if (this.active !== session) return;
      this.callbacks.dismissPassword();
      // Surface a damaged first page before the viewer takes ownership.
      await pdf.getPage(1);
      if (this.active !== session) return;

      session.pdf = pdf;
      this.links.setDocument(pdf);
      this.view.setDocument(pdf);
      await this.view.pagesPromise;
    } catch (error) {
      if (this.active === session) this.fail(describeError(error, source instanceof URL));
    }
  }

  close() {
    this.detach();
    this.callbacks.state({ kind: "idle" });
  }

  async goToPage(pageNumber: number) {
    const session = this.active;
    if (!session?.pdf || pageNumber < 1 || pageNumber > session.pdf.numPages) return;
    this.view.currentPageNumber = pageNumber;
    const preset = this.view.currentScaleValue;
    if (preset !== "page-fit" && preset !== "page-width") return;

    try {
      const page = await session.pdf.getPage(pageNumber);
      if (this.active !== session || this.view.currentPageNumber !== pageNumber
          || this.view.currentScaleValue !== preset) return;

      const pageView = this.view.getPageView(pageNumber - 1) as PDFPageView;
      if (!pageView.pdfPage) pageView.setPdfPage(page);
      this.view.currentScaleValue = preset;
      this.view.currentPageNumber = pageNumber;
    } catch {
      if (this.active === session && this.view.currentPageNumber === pageNumber) {
        this.callbacks.notice(`Page ${pageNumber} couldn’t be opened.`);
      }
    }
  }

  async downloadOriginal() {
    const session = this.active;
    if (!session?.pdf) return;
    try {
      const blob = session.source instanceof File ? session.source : pdfBlob(await session.pdf.getData());
      if (this.active === session) download(blob, session.name);
    } catch {
      if (this.active === session) this.callbacks.notice("Couldn’t download the original PDF.");
    }
  }

  private async localInput(file: File, session: DocumentSession) {
    const initial = new Uint8Array(await file.slice(0, rangeSize).arrayBuffer());
    if (file.size <= rangeSize) return { data: initial };
    return {
      range: new LocalFileRanges(file, initial, () => {
        if (this.active === session) this.fail("Couldn’t read the PDF file. Try opening it again.");
      }),
    };
  }

  private fail(message: string) {
    this.detach();
    this.callbacks.state({ kind: "error", message });
  }

  private detach() {
    this.callbacks.dismissPassword();
    const previous = this.active;
    this.active = undefined;
    if (!previous) return;
    if (previous.pdf) {
      const cached = this.view.getCachedPageViews() as Set<PDFPageView>;
      this.view.setDocument(null);
      this.links.setDocument(null);
      for (const page of cached) page.destroy();
    }
    if (previous.task) {
      this.disposing = previous.task.destroy().catch(error => {
        console.warn("PDF.js cleanup failed.", error);
      });
    }
  }
}
