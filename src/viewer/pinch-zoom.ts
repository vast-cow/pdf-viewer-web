import { MathClamp, TouchManager } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFViewer } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

// PDFViewer.updateScale rounds to hundredths and enforces these limits.
const minScale = 0.1;
const maxScale = 25;
const drawingDelay = 200;

type ZoomInput = "touch" | "wheel" | "gesture";
type SafariGesture = Event & { scale: number; clientX: number; clientY: number };

export function bindPinchZoom(view: PDFViewer, signal: AbortSignal) {
  const { container } = view;
  container.classList.add("pinch-zoom");
  signal.addEventListener("abort", () => container.classList.remove("pinch-zoom"), { once: true });

  let lastInput: ZoomInput | undefined;
  let lastScale = view.currentScale;
  let remainder = 1;
  let touchPinching = false;
  let gestureScale: number | undefined;
  let gestureUsesTouch = false;

  function zoomBy(input: ZoomInput, factor: number, x: number, y: number, pan?: [number, number]) {
    const scale = view.currentScale;
    if (input !== lastInput || lastScale !== scale) remainder = 1;
    lastInput = input;

    const target = MathClamp(scale * factor * remainder, minScale, maxScale);
    const rounded = Math.round(target * 100) / 100;
    if (rounded === Math.round(scale * 100) / 100) {
      if (pan) view.panBy(...pan);
    } else {
      const { left, top } = container.getBoundingClientRect();
      const [offsetTop, offsetLeft] = view.containerTopLeft;
      // PDF.js subtracts offsets relative to the workspace. Supply coordinates in that frame.
      view.updateScale({
        scaleFactor: rounded / scale,
        origin: [x - left + offsetLeft, y - top + offsetTop],
        pan,
        drawingDelay,
      });
    }
    lastScale = view.currentScale;
    remainder = target / lastScale;
  }

  new TouchManager({
    container,
    signal,
    onPinchStart() {
      touchPinching = true;
      gestureUsesTouch = true;
    },
    onPinching([x, y]: [number, number], previous: number, distance: number, dx: number, dy: number) {
      zoomBy("touch", distance / previous, x, y, [dx, dy]);
    },
    onPanning(dx: number, dy: number) {
      view.panBy(dx, dy);
    },
    onPinchEnd() {
      touchPinching = false;
      if (lastInput === "touch") lastInput = undefined;
    },
  });

  const options = { passive: false, signal };
  container.addEventListener("wheel", event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (touchPinching || gestureScale !== undefined) return;

    const mode = event.deltaMode;
    const pixelsPerUnit = mode === WheelEvent.DOM_DELTA_LINE ? 30 :
      mode === WheelEvent.DOM_DELTA_PAGE ? container.clientHeight : 1;
    const delta = event.deltaY * pixelsPerUnit;
    if (delta) zoomBy("wheel", MathClamp(Math.exp(-delta / 100), 0.9, 1.1), event.clientX, event.clientY);
  }, options);

  container.addEventListener("gesturestart", event => {
    event.preventDefault();
    gestureScale = 1;
    gestureUsesTouch = touchPinching;
    if (lastInput === "gesture") lastInput = undefined;
  }, options);

  container.addEventListener("gesturechange", event => {
    if (gestureScale === undefined) return;
    event.preventDefault();
    if (gestureUsesTouch) return;

    const { scale, clientX, clientY } = event as SafariGesture;
    if (!Number.isFinite(scale) || scale <= 0 || scale === gestureScale) return;
    const factor = MathClamp(scale / gestureScale, 0.9, 1.1);
    gestureScale = scale;
    zoomBy("gesture", factor, clientX, clientY);
  }, options);

  container.addEventListener("gestureend", () => { gestureScale = undefined; }, options);
}
