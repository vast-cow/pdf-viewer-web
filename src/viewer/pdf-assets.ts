import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url&no-inline";
import rendererUrl from "pdfjs-dist/legacy/build/pdf.renderer.min.mjs?url&no-inline";

GlobalWorkerOptions.workerSrc = workerUrl;
GlobalWorkerOptions.rendererSrc = rendererUrl;

const assets = new URL(
  import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : "./pdfjs/",
  document.baseURI,
);

export const pdfAssets = {
  cMapUrl: new URL("cmaps/", assets).href,
  standardFontDataUrl: new URL("standard_fonts/", assets).href,
  iccUrl: new URL("iccs/", assets).href,
  wasmUrl: new URL("wasm/", assets).href,
};

export const annotationImages = new URL(
  import.meta.env.DEV ? "web/images/" : "images/",
  assets,
).href;
