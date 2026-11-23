import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { launchChrome, waitFor } from "./chrome.mjs";
import { samplePdf } from "./pdf-fixture.mjs";

const web = resolve("dist/web");
const extension = resolve("dist/extension");
const small = samplePdf();
const large = samplePdf(240, 400_000);
const mime = {
  ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm",
};

async function serve() {
  let blockedRanges = 0;
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (["/sample.pdf", "/large.pdf", "/slow-download.pdf", "/without-cors.pdf"].includes(pathname)) {
      const bytes = ["/large.pdf", "/slow-download.pdf"].includes(pathname) ? large : small;
      if (pathname !== "/without-cors.pdf") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "Range");
        res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "application/pdf");
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(Number(range[2]), bytes.length - 1);
        if (pathname === "/slow-download.pdf" && start >= 131_072 && end < bytes.length - 1) {
          blockedRanges++;
          res.once("close", () => { blockedRanges--; });
          return;
        }
        const body = bytes.subarray(start, end + 1);
        res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": body.length }).end(body);
      } else {
        res.writeHead(200, { "Content-Length": bytes.length }).end(bytes);
      }
      return;
    }

    // Mount the build in a subdirectory as a static host would.
    const path = pathname === "/reader/" ? "index.html" : pathname.slice("/reader/".length);
    try {
      const file = resolve(web, path);
      if (!file.startsWith(web + "/")) throw new Error("Invalid test resource path");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    get blockedRanges() { return blockedRanges; },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

const sourceCanvas = '.page[data-page-number="1"] .canvasWrapper > canvas[role="presentation"]';
const invertedCanvas = '.page[data-page-number="1"] .pdf-inverted-canvas';
const text = '.page[data-page-number="1"] .textLayer span[dir]';
const selectedThumbnail = '.thumbnail[aria-current="page"]';
const headerColor = `getComputedStyle(document.querySelector(".reader-header")).backgroundColor`;

function click(page, selector) {
  return page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
}

async function menuAction(page, selector) {
  await click(page, "#overflow-toggle");
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).getClientRects().length > 0`), true);
  await click(page, selector);
}

function setValue(page, selector, value, event = "input") {
  return page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    return input.value;
  })()`);
}

async function selectTheme(page, theme) {
  await click(page, "#overflow-toggle");
  await ready(page, "#overflow-panel:not([hidden]) #theme");
  await setValue(page, "#theme", theme, "change");
  await click(page, "#overflow-toggle");
}

function exists(page, selector) {
  return page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
}

function currentPage(page, number) {
  return page.evaluate(`document.querySelector("#page-number").value === "${number}"`);
}

function zoomState(page, anchor) {
  return page.evaluate(`(() => {
    const region = document.querySelector("#scroll-region");
    const bounds = region.getBoundingClientRect();
    const { x, y } = ${JSON.stringify(anchor ?? null)} ?? {
      x: Math.round(bounds.left + bounds.width * 0.4),
      y: Math.round(bounds.top + bounds.height * 0.6),
    };
    const { left, top, width, height } = document.querySelector("#pages .page").getBoundingClientRect();
    return {
      x, y, width, height, pageX: (x - left) / width, pageY: (y - top) / height,
      percent: parseInt(document.querySelector("#zoom-percentage").textContent, 10),
      viewportScale: visualViewport.scale,
    };
  })()`);
}

function assertZoom(before, after, direction) {
  for (const property of ["width", "height", "percent"]) {
    assert.ok(direction * (after[property] - before[property]) > 0,
      `${property} should ${direction > 0 ? "increase" : "decrease"}: ${before[property]} → ${after[property]}`);
  }
  assert.ok(Math.abs(after.width - 480 * after.percent / 100) <= 2, "toolbar matches the PDF scale");
  assert.equal(after.viewportScale, before.viewportScale);
}

function pinch(page, { x, y }, scaleFactor, gestureSourceType) {
  return page.command("Input.synthesizePinchGesture", { x, y, scaleFactor, gestureSourceType });
}

function touchPair(page, { x, y }, radius, type) {
  const touchPoints = type === "touchEnd" ? [] : [{ x: x - radius, y, id: 1 }, { x: x + radius, y, id: 2 }];
  return page.command("Input.dispatchTouchEvent", { type, touchPoints });
}

function safariGesture(page, selector, type, scale, { x, y }) {
  return page.evaluate(`(() => {
    const event = new MouseEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} });
    Object.defineProperty(event, "scale", { value: ${scale} });
    return document.querySelector(${JSON.stringify(selector)}).dispatchEvent(event);
  })()`);
}

async function ready(page, selector) {
  try {
    await waitFor(() => exists(page, selector), selector);
  } catch (error) {
    const detail = await page.evaluate(`({
      title: document.title,
      loading: !document.querySelector("#load-panel")?.hidden,
      error: document.querySelector("#error-message")?.textContent,
      notice: document.querySelector("#notice-message")?.textContent,
      textLayer: document.querySelector(".textLayer")?.innerHTML.slice(0, 400),
    })`);
    throw new Error(`${error.message}: ${JSON.stringify(detail)}`, { cause: error });
  }
}

async function chooseFile(page, path) {
  const { root } = await page.command("DOM.getDocument");
  const { nodeId } = await page.command("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-picker" });
  await page.command("DOM.setFileInputFiles", { nodeId, files: [path] });
}

async function openUrl(page, url) {
  await menuAction(page, "#open-url");
  await setValue(page, "#pdf-url", url);
  await page.evaluate('document.querySelector("#url-form").requestSubmit(); true');
}

function sample(page, selector, left, top) {
  return page.evaluate(`(() => {
    const canvas = document.querySelector(${JSON.stringify(selector)});
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    context.drawImage(canvas, Math.floor(canvas.width * ${left}), Math.floor(canvas.height * ${top}), 1, 1, 0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  })()`);
}

async function newPage(chrome, url, shader = true) {
  const { targetId } = await chrome.send("Target.createTarget", { url });
  const page = await chrome.attach(targetId);
  await ready(page, "#file-picker");
  await page.evaluate(shader ? `(() => {
    globalThis.shaderDraws = 0;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      globalThis.shaderDraws++;
      return draw.apply(this, args);
    };
  })()` : `(() => {
    globalThis.webglRequests = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === "webgl2") {
        globalThis.webglRequests++;
        return null;
      }
      return getContext.call(this, type, ...args);
    };
  })()`);
  return { targetId, page };
}

test("built PDF reader in Chrome", { timeout: 90_000 }, async t => {
  await Promise.all([
    readFile(join(web, "index.html")),
    readFile(join(extension, "manifest.json")),
  ]);
  const directory = await mkdtemp(join(tmpdir(), "pdf-reader-test-"));
  const server = await serve();
  const chrome = launchChrome(join(directory, "profile"));
  t.after(async () => {
    await chrome.close();
    await server.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  await chrome.send("Browser.getVersion");
  const path = join(directory, "sample.pdf");
  const largePath = join(directory, "large.pdf");
  const invalidPath = join(directory, "invalid.pdf");
  await Promise.all([writeFile(path, small), writeFile(largePath, large), writeFile(invalidPath, "This is not a PDF.")]);
  const url = `${server.origin}/reader/`;

  await t.test("static build renders, searches and inverts with WebGL2", async () => {
    const { targetId, page } = await newPage(chrome, url);
    await chooseFile(page, path);
    await ready(page, text);
    assert.equal(await page.evaluate('document.querySelector("#page-count").textContent'), "/ 4");
    assert.equal(await page.evaluate('document.querySelector(".page").getBoundingClientRect().bottom <= document.querySelector("#scroll-region").getBoundingClientRect().bottom'), true);
    assert.deepEqual(await sample(page, sourceCanvas, 0.1, 0.08), [51, 102, 153, 255]);
    await page.evaluate(`globalThis.originalCanvas = document.querySelector(${JSON.stringify(sourceCanvas)}); true`);

    await page.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    const systemDark = await page.evaluate(headerColor);
    await selectTheme(page, "light");
    const light = await page.evaluate(headerColor);
    await selectTheme(page, "dark");
    const dark = await page.evaluate(headerColor);
    assert.notEqual(light, dark);
    assert.equal(systemDark, dark);
    assert.deepEqual(await sample(page, sourceCanvas, 0.1, 0.08), [51, 102, 153, 255]);
    assert.equal(await exists(page, invertedCanvas), false);

    await click(page, "#invert");
    await ready(page, invertedCanvas);
    assert.ok(await page.evaluate("shaderDraws > 0"), "used the WebGL2 shader");
    assert.deepEqual(await sample(page, invertedCanvas, 0.1, 0.08), [102, 153, 204, 255]);
    assert.deepEqual(await sample(page, invertedCanvas, 0.9, 0.85), [0, 0, 0, 255]);
    assert.equal(await page.evaluate(headerColor), dark);
    assert.equal(await page.evaluate(`originalCanvas === document.querySelector(${JSON.stringify(sourceCanvas)})`), true);
    await click(page, "#invert");
    assert.equal(await exists(page, invertedCanvas), false);
    assert.deepEqual(await sample(page, sourceCanvas, 0.1, 0.08), [51, 102, 153, 255]);
    await click(page, "#invert");
    await ready(page, invertedCanvas);

    const coordinates = await page.evaluate(`(() => {
      const span = document.querySelector(${JSON.stringify(text)});
      const { left, right, top, height } = span.getBoundingClientRect();
      return { start: left + 1, end: right - 1, y: top + height / 2 };
    })()`);
    const { start, end, y } = coordinates;
    await chrome.send("Target.activateTarget", { targetId });
    await page.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: start, y });
    await page.command("Input.dispatchMouseEvent", { type: "mousePressed", x: start, y, button: "left", buttons: 1, clickCount: 1 });
    for (const x of [(start + end) / 2, end]) {
      await page.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    }
    await page.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: end, y, button: "left", clickCount: 1 });
    assert.match(await page.evaluate("getSelection().toString()"), /Selectable text on page 1/);

    const external = await waitFor(() => page.evaluate('document.querySelector(".annotationLayer a[href^=https]")?.href'), "external link");
    assert.equal(external, "https://example.com/");
    await click(page, '.annotationLayer a[href^="#"]');
    await waitFor(() => page.evaluate('document.querySelector("#page-number").value === "3"'), "internal PDF link");
    await menuAction(page, "#previous-page");
    await waitFor(() => page.evaluate('document.querySelector("#page-number").value === "2"'), "previous page");

    await click(page, "#show-search");
    await setValue(page, "#search-query", "needle");
    await waitFor(() => page.evaluate('document.querySelector("#search-status").textContent === "1 of 1"'), "search match");
    await ready(page, '.page[data-page-number="3"] .textLayer .highlight.selected');
    assert.equal(await page.evaluate('document.querySelector("#page-number").value'), "3");
    await click(page, "#close-search");
    await setValue(page, "#zoom", "page-width", "change");
    assert.equal(await page.evaluate('document.querySelector("#zoom").value'), "page-width");
    await click(page, "#zoom-in");
    assert.match(await page.evaluate('document.querySelector("#zoom").selectedOptions[0].textContent'), /%/);
    await click(page, "#zoom-out");
    await setValue(page, "#zoom", "page-fit", "change");

    await page.command("Page.reload");
    await waitFor(() => page.evaluate('document.querySelector("#theme")?.value === "dark" && document.querySelector("#invert")?.getAttribute("aria-pressed") === "true"'), "saved web preferences");
  });

  await t.test("Canvas fallback, ranged local PDF, URL, drag-and-drop, and invalid input", async () => {
    const { targetId, page } = await newPage(chrome, url, false);
    await page.command("Emulation.setDeviceMetricsOverride", { width: 375, height: 760, deviceScaleFactor: 2, mobile: true });
    assert.equal(await page.evaluate('document.documentElement.scrollWidth === innerWidth'), true);
    await chooseFile(page, largePath);
    await ready(page, text);
    assert.equal(await page.evaluate('document.querySelector("#page-count").textContent'), "/ 240");
    const resolution = await page.evaluate(`(() => {
      const canvas = document.querySelector(${JSON.stringify(sourceCanvas)});
      return canvas.width / canvas.offsetWidth;
    })()`);
    assert.ok(resolution >= 1.9, "rendered near the 2× device pixel ratio");
    if (!await page.evaluate('document.querySelector("#invert").getAttribute("aria-pressed") === "true"')) {
      await click(page, "#invert");
    }
    await ready(page, invertedCanvas);
    assert.ok(await page.evaluate("webglRequests > 0"), "tested Canvas fallback with WebGL2 disabled");
    assert.deepEqual(await sample(page, invertedCanvas, 0.1, 0.08), [102, 153, 204, 255]);

    for (let pageNumber = 20; pageNumber <= 240; pageNumber += 20) {
      await setValue(page, "#page-number", String(pageNumber), "change");
      await ready(page, `.page[data-page-number="${pageNumber}"] .pdf-inverted-canvas`);
    }
    const counts = await page.evaluate(`({
      pageCanvases: document.querySelectorAll('.canvasWrapper > canvas[role="presentation"]').length,
      inverted: document.querySelectorAll('.pdf-inverted-canvas').length,
    })`);
    assert.ok(counts.pageCanvases <= 10, JSON.stringify(counts));
    assert.ok(counts.inverted <= 4, JSON.stringify(counts));
    await menuAction(page, "#close-file");
    assert.equal(await exists(page, "#pages canvas"), false);
    await chooseFile(page, invalidPath);
    await waitFor(() => page.evaluate('document.querySelector("#error-message").textContent.includes("invalid")'), "invalid PDF error");

    await page.evaluate(`(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(small.toString("base64"))}), value => value.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "dropped.pdf", { type: "application/pdf" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
    })()`);
    await waitFor(() => page.evaluate('document.querySelector("#filename").textContent === "dropped.pdf"'), "dropped file");

    await openUrl(page, `${server.origin}/large.pdf`);
    await waitFor(() => page.evaluate('document.querySelector("#filename").textContent === "large.pdf"'), "remote ranged PDF");
    await ready(page, invertedCanvas);
    await chrome.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: join(directory, "downloads") });
    await menuAction(page, '[data-action="download"]');
    const bytes = await waitFor(() => readFile(join(directory, "downloads", "large.pdf")).catch(() => null), "original remote PDF download");
    assert.deepEqual(bytes, large);
    await chrome.send("Target.closeTarget", { targetId });
  });

  await t.test("password protection prompts, retries and cancels", async () => {
    const { targetId, page } = await newPage(chrome, url);
    const encrypted = resolve("tests/browser/fixtures/password.pdf");
    await chooseFile(page, encrypted);
    await ready(page, "#password-dialog[open]");
    await click(page, "#cancel-password");
    await ready(page, "#welcome:not([hidden])");
    assert.equal(await exists(page, "#password-dialog[open]"), false);

    await chooseFile(page, encrypted);
    await ready(page, "#password-dialog[open]");
    await setValue(page, "#pdf-password", "wrong-password");
    await page.evaluate('document.querySelector("#password-form").requestSubmit(); true');
    await ready(page, "#password-dialog[open] #password-error:not([hidden])");
    await setValue(page, "#pdf-password", "fixture-password");
    await page.evaluate('document.querySelector("#password-form").requestSubmit(); true');
    await ready(page, text);
    assert.equal(await exists(page, "#password-dialog[open]"), false);
    await chrome.send("Target.closeTarget", { targetId });
  });

  await t.test("fit presets account for lazily loaded page dimensions", async () => {
    const { targetId, page } = await newPage(chrome, url);
    const mixedPath = join(directory, "mixed-pages.pdf");
    await writeFile(mixedPath, samplePdf(2, 0, [980, 750]));
    await chooseFile(page, mixedPath);
    await ready(page, text);
    await menuAction(page, "#next-page");
    const secondCanvas = '.page[data-page-number="2"] .canvasWrapper > canvas[role="presentation"]';
    await ready(page, secondCanvas);
    const fits = (widthOnly = false) => page.evaluate(`(() => {
      const canvas = document.querySelector(${JSON.stringify(secondCanvas)});
      const region = document.querySelector("#scroll-region");
      const frame = region.getBoundingClientRect();
      const page = canvas?.getBoundingClientRect();
      return page && page.width <= region.clientWidth && (${widthOnly}
        ? page.width >= region.clientWidth - 50
        : page.top >= frame.top - 1 && page.bottom <= frame.bottom + 1);
    })()`);
    try {
      await waitFor(() => fits(), "fit page at the actual page size", 2000);
    } catch (error) {
      const detail = await page.evaluate(`(() => {
        const region = document.querySelector("#scroll-region");
        const canvas = document.querySelector('${secondCanvas}');
        return {
          frame: region.getBoundingClientRect().toJSON(),
          page: canvas.getBoundingClientRect().toJSON(),
          scrollTop: region.scrollTop,
          scrollHeight: region.scrollHeight,
          selected: document.querySelector("#page-number").value,
          scale: document.querySelector("#zoom-percentage").textContent,
          preset: document.querySelector("#zoom").value,
        };
      })()`);
      throw new Error(`${error.message}: ${JSON.stringify(detail)}`, { cause: error });
    }
    await menuAction(page, "#previous-page");
    await setValue(page, "#zoom", "page-width", "change");
    await setValue(page, "#page-number", "2", "change");
    await waitFor(() => fits(true), "fit width at the actual page size", 2000);
    await chrome.send("Target.closeTarget", { targetId });
  });

  await t.test("sidebar thumbnails, bookmarks, rotation and desktop fit controls", async () => {
    const { targetId, page } = await newPage(chrome, url);
    await page.command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
    const outlined = join(directory, "outlined.pdf");
    await writeFile(outlined, samplePdf(4, 0, [360, 480], true));
    await chooseFile(page, outlined);
    await ready(page, text);
    if (!await exists(page, '#invert[aria-pressed="true"]')) await click(page, "#invert");
    assert.equal(await exists(page, "#sidebar:not([hidden])"), false);
    assert.equal(await exists(page, "#thumbnail-list canvas"), false);

    await click(page, "#fit-width");
    assert.equal(await exists(page, '#fit-width[aria-pressed="true"]'), true);
    const regionWidth = () => page.evaluate('document.querySelector("#scroll-region").clientWidth');
    const zoom = () => page.evaluate('parseInt(document.querySelector("#zoom-percentage").textContent, 10)');
    const fullWidth = await regionWidth();
    const fullZoom = await zoom();
    await page.evaluate('globalThis.firstPageView = document.querySelector(".pdfViewer .page"); true');
    await click(page, "#toggle-sidebar");
    await ready(page, '.thumbnail[data-page="1"] canvas');
    assert.equal(await exists(page, '#toggle-sidebar[aria-expanded="true"]'), true);
    assert.equal(await page.evaluate('document.activeElement.id'), "show-thumbnails");
    assert.ok(await regionWidth() < fullWidth);
    await waitFor(async () => await zoom() < fullZoom, "fit width recalculated for the open sidebar");
    assert.equal(await page.evaluate('firstPageView === document.querySelector(".pdfViewer .page")'), true);
    assert.equal(await exists(page, `${selectedThumbnail}[data-page="1"]`), true);

    await click(page, '.thumbnail[data-page="2"]');
    await waitFor(() => currentPage(page, 2), "thumbnail navigation");
    await ready(page, `${selectedThumbnail}[data-page="2"]`);
    await page.evaluate(`(() => {
      const region = document.querySelector("#scroll-region");
      const page = document.querySelector('.pdfViewer [data-page-number="4"]');
      region.scrollTop += page.getBoundingClientRect().top - region.getBoundingClientRect().top;
      return true;
    })()`);
    await ready(page, `${selectedThumbnail}[data-page="4"]`);
    assert.equal(await currentPage(page, 4), true);
    await click(page, "#toggle-sidebar");
    await waitFor(async () => await zoom() === fullZoom, "fit width recalculated for the closed sidebar");
    assert.equal(await currentPage(page, 4), true);
    assert.equal(await regionWidth(), fullWidth);
    assert.equal(await exists(page, "#thumbnail-list canvas"), false);

    await click(page, "#toggle-sidebar");
    await click(page, "#show-outline");
    await ready(page, "#outline li li button");
    assert.equal(await page.evaluate('document.querySelector("#outline li li button").textContent'), "Section");
    await click(page, "#outline > ul > li > button");
    await waitFor(() => currentPage(page, 1), "explicit outline destination");
    await click(page, "#outline li li button");
    await waitFor(() => currentPage(page, 3), "named outline destination");
    await click(page, "#show-thumbnails");
    await ready(page, `${selectedThumbnail}[data-page="3"] canvas`);
    await click(page, "#fit-width");
    await page.evaluate(`(() => {
      const region = document.querySelector("#scroll-region");
      const current = document.querySelector('.pdfViewer .page[data-page-number="3"]');
      const frame = region.getBoundingClientRect();
      const bounds = current.getBoundingClientRect();
      region.scrollTop += Math.round(bounds.top - frame.top + bounds.height * 0.25);
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    await waitFor(() => page.evaluate('document.querySelector(\'.pdfViewer .page[data-page-number="3"]\').getBoundingClientRect().top < 0'), "scrolled inside page three");
    assert.equal(await currentPage(page, 3), true);
    await click(page, "#fit-page");
    await waitFor(() => page.evaluate(`(() => {
      const frame = document.querySelector("#scroll-region").getBoundingClientRect();
      const page = document.querySelector('.pdfViewer .page[data-page-number="3"]').getBoundingClientRect();
      return page.top >= frame.top - 1 && page.bottom <= frame.bottom + 1;
    })()`), "fit page reveals the whole current page", 2000);
    await click(page, "#rotate");
    const rotatedPage = '.pdfViewer .page[data-page-number="3"]';
    await waitFor(() => page.evaluate(`(() => {
      const { width, height } = document.querySelector('${rotatedPage}').getBoundingClientRect();
      const region = document.querySelector("#scroll-region");
      const thumbnail = document.querySelector('${selectedThumbnail} canvas');
      return width > height && width <= region.clientWidth && height <= region.clientHeight
        && thumbnail && thumbnail.width > thumbnail.height;
    })()`), "rotated page and thumbnail with fit page");
    assert.equal(await currentPage(page, 3), true);
    const rotatedInversion = `${rotatedPage} .pdf-inverted-canvas`;
    await ready(page, rotatedInversion);
    assert.deepEqual(await sample(page, rotatedInversion, 0.5, 0.5), [0, 0, 0, 255]);
    await click(page, "#zoom-in");
    await ready(page, rotatedInversion);
    assert.deepEqual(await sample(page, rotatedInversion, 0.5, 0.5), [0, 0, 0, 255]);
    const manualZoom = await zoom();
    await click(page, "#toggle-sidebar");
    assert.equal(await zoom(), manualZoom);
    assert.equal(await currentPage(page, 3), true);

    await click(page, "#toggle-sidebar");
    await chooseFile(page, path);
    await ready(page, '.thumbnail[aria-current="page"][data-page="1"] canvas');
    assert.equal(await exists(page, '.thumbnail[aria-current="page"][data-page="3"]'), false);
    assert.equal(await page.evaluate(`(() => {
      const {width, height} = document.querySelector(".pdfViewer .page").getBoundingClientRect();
      return height > width;
    })()`), true);
    await ready(page, invertedCanvas);
    assert.deepEqual(await sample(page, invertedCanvas, 0.1, 0.08), [102, 153, 204, 255]);
    await click(page, "#show-outline");
    await waitFor(() => page.evaluate('document.querySelector("#outline").textContent.includes("no document outline")'), "empty outline after replacement");
    await menuAction(page, "#close-file");
    assert.equal(await exists(page, "#sidebar:not([hidden]), #outline li, #pages canvas, #thumbnail-list canvas"), false);
    await chrome.send("Target.closeTarget", { targetId });
  });

  await t.test("narrow toolbar, keyboard access and bounded thumbnail rendering", async () => {
    const { targetId, page } = await newPage(chrome, url);
    await page.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 660, deviceScaleFactor: 2, mobile: true });
    await chooseFile(page, largePath);
    await ready(page, text);
    assert.equal(await page.evaluate(`(() => {
      const toolbar = document.querySelector(".reader-header");
      const end = document.querySelector(".toolbar-end");
      const controls = document.querySelector("#document-toolbar");
      return toolbar.offsetHeight === 56 && document.documentElement.scrollWidth === innerWidth
        && controls.getBoundingClientRect().right <= end.getBoundingClientRect().left
        && document.querySelector("#invert").getClientRects().length === 1;
    })()`), true);
    const regionWidth = await page.evaluate('document.querySelector("#scroll-region").clientWidth');
    await click(page, "#toggle-sidebar");
    await ready(page, '#sidebar-scrim:not([hidden])');
    await ready(page, '.thumbnail[data-page="1"] canvas');
    assert.equal(await page.evaluate('document.querySelector("#scroll-region").clientWidth'), regionWidth);
    assert.equal(await page.evaluate(`(() => {
      const region = document.querySelector("#scroll-region");
      region.focus();
      return document.activeElement.id;
    })()`), "show-thumbnails");
    await page.evaluate(`(() => {
      globalThis.lastPageResources = new Set();
      globalThis.cleanedLastPageResources = new Set();
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, ...args) {
        if (message.action === "GetOperatorList" && message.data.pageIndex === 239) {
          lastPageResources.add(message.data.pageProxyId);
        }
        if (message.action === "CleanupPage" && lastPageResources.has(message.data.pageProxyId)) {
          cleanedLastPageResources.add(message.data.pageProxyId);
        }
        return send.call(this, message, ...args);
      };
      const list = document.querySelector("#thumbnails");
      list.focus();
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      return true;
    })()`);
    await ready(page, '.thumbnail[data-page="240"] canvas');
    await waitFor(() => page.evaluate('cleanedLastPageResources.size > 0'), "release of thumbnail-only page resources", 2000);
    assert.equal(await page.evaluate('document.activeElement.dataset.page'), "240");
    assert.equal(await exists(page, '.thumbnail[data-page="1"]'), false);
    assert.ok(await page.evaluate('document.querySelectorAll("#thumbnail-list canvas").length <= 8'));
    await click(page, '.thumbnail[data-page="240"]');
    await waitFor(() => currentPage(page, 240), "mobile thumbnail navigation");
    assert.equal(await exists(page, "#sidebar:not([hidden]), #sidebar-scrim:not([hidden]), #thumbnail-list canvas"), false);
    assert.equal(await page.evaluate('document.activeElement.id'), "scroll-region");

    await menuAction(page, '[data-action="fit-width"]');
    assert.equal(await exists(page, '[data-action="fit-width"][aria-pressed="true"]'), true);
    await menuAction(page, '[data-action="rotate"]');
    await waitFor(() => page.evaluate(`(() => {
      const {width, height} = document.querySelector('.pdfViewer [data-page-number="240"]').getBoundingClientRect();
      return width > height;
    })()`), "rotation from the narrow menu");
    await menuAction(page, '[data-action="show-search"]');
    assert.equal(await page.evaluate('document.activeElement.id'), "search-query");
    await click(page, "#close-search");
    assert.equal(await page.evaluate('document.activeElement.id'), "overflow-toggle");

    await click(page, "#overflow-toggle");
    assert.equal(await page.evaluate('document.activeElement.id'), "open-file");
    await page.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
    assert.equal(await exists(page, "#overflow-panel:not([hidden])"), false);
    assert.equal(await page.evaluate('document.activeElement.id'), "overflow-toggle");
    await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true })); true');
    assert.equal(await page.evaluate('document.activeElement.id'), "search-query");
    await page.evaluate(`(() => {
      const picker = document.querySelector("#file-picker");
      const click = picker.click;
      const calls = [];
      picker.click = () => calls.push(true);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "o", metaKey: true, cancelable: true }));
      picker.click = click;
      return calls.length;
    })()`).then(count => assert.equal(count, 1));
    await chrome.send("Target.closeTarget", { targetId });
  });

  await t.test("touchscreen and trackpad pinch zoom the PDF and preserve scrolling and tapping", async () => {
    const { targetId, page } = await newPage(chrome, url);
    await page.command("Emulation.setDeviceMetricsOverride", { width: 900, height: 650, deviceScaleFactor: 2, mobile: true });
    await page.command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await chooseFile(page, path);
    await ready(page, text);

    const link = await waitFor(() => page.evaluate(`new Promise(resolve => requestAnimationFrame(() => {
      const link = document.querySelector('.annotationLayer a[href^="#"]');
      if (!link) return resolve(null);
      const { left, top, width, height } = link.getBoundingClientRect();
      const x = Math.round(left + width / 2);
      const y = Math.round(top + height / 2);
      resolve(document.elementFromPoint(x, y) === link ? { x, y } : null);
    }))`), "visible PDF link", 2000);
    await page.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...link, id: 1 }] });
    await page.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await waitFor(() => currentPage(page, 3), "single tap on an internal PDF link", 2000);
    await setValue(page, "#page-number", "1", "change");
    await waitFor(() => currentPage(page, 1), "page one for pinch gestures");
    await click(page, "#toggle-sidebar");
    await setValue(page, "#zoom", "page-width", "change");

    const initial = await zoomState(page);
    await touchPair(page, initial, 30, "touchStart");
    for (const radius of [56, 74, 96]) await touchPair(page, initial, radius, "touchMove");
    await touchPair(page, initial, 0, "touchEnd");
    const touchIn = await zoomState(page);
    assertZoom(initial, touchIn, 1);
    const shiftedMidpoint = { x: touchIn.x - 28, y: touchIn.y - 24 };
    await touchPair(page, touchIn, 96, "touchStart");
    await touchPair(page, touchIn, 70, "touchMove");
    await touchPair(page, shiftedMidpoint, 61, "touchMove");
    await touchPair(page, shiftedMidpoint, 0, "touchEnd");
    const touchOut = await zoomState(page);
    assertZoom(touchIn, touchOut, -1);
    const shifted = await zoomState(page, shiftedMidpoint);
    assert.ok(Math.abs(shifted.pageX - touchIn.pageX) < 0.015, "PDF point follows the moving midpoint horizontally");
    assert.ok(Math.abs(shifted.pageY - touchIn.pageY) < 0.015, "PDF point follows the moving midpoint vertically");

    await pinch(page, touchOut, 1.35, "mouse");
    const trackpadIn = await zoomState(page);
    assertZoom(touchOut, trackpadIn, 1);
    assert.ok(Math.abs(trackpadIn.pageX - touchOut.pageX) < 0.02, "anchor x with the sidebar open");
    assert.ok(Math.abs(trackpadIn.pageY - touchOut.pageY) < 0.02, "anchor y below the toolbar");
    await pinch(page, trackpadIn, 0.85, "mouse");
    const trackpadOut = await zoomState(page);
    assertZoom(trackpadIn, trackpadOut, -1);

    const scrollPosition = () => page.evaluate(`(() => {
      const region = document.querySelector("#scroll-region");
      return { left: region.scrollLeft, top: region.scrollTop };
    })()`);
    assert.ok(await page.evaluate(`(() => {
      const region = document.querySelector("#scroll-region");
      region.scrollTo(0, 0);
      return region.scrollWidth > region.clientWidth;
    })()`), "zoomed PDF has room to scroll horizontally");
    const beforeScroll = await scrollPosition();
    const { x, y } = trackpadOut;
    for (const [coordinate, axis] of [["x", "left"], ["y", "top"]]) {
      const point = { x, y, id: 1 };
      await page.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      for (const offset of [20, 50, 100]) {
        await page.command("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, [coordinate]: point[coordinate] - offset }] });
      }
      await page.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await waitFor(async () => (await scrollPosition())[axis] > beforeScroll[axis], `single-finger ${axis} scrolling`, 2000);
    }
    const beforeWheel = await scrollPosition();
    await page.command("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: 60 });
    await waitFor(async () => (await scrollPosition()).top > beforeWheel.top, "ordinary wheel scrolling");
    assert.equal((await zoomState(page)).percent, trackpadOut.percent);

    const unhandledWheel = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -150 }))`);
    assert.equal(await unhandledWheel(".reader-header"), true);
    assert.equal(await unhandledWheel("#sidebar"), true);
    assert.equal((await zoomState(page)).percent, trackpadOut.percent);

    await menuAction(page, "#close-file");
    assert.equal(await unhandledWheel("#scroll-region"), true);
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#scroll-region")).touchAction'), "auto");
    await chooseFile(page, path);
    await ready(page, text);
    const reopened = await zoomState(page);
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#scroll-region")).touchAction'), "pan-x pan-y");
    await page.command("Input.dispatchMouseEvent", { type: "mouseWheel", x: reopened.x, y: reopened.y, deltaX: 0, deltaY: -150, modifiers: 2 });
    const ctrlWheel = await waitFor(async () => {
      const state = await zoomState(page);
      if (state.percent > reopened.percent) return state;
    }, "Ctrl+wheel zoom after reopening");
    assertZoom(reopened, ctrlWheel, 1);
    assert.ok(Math.abs(ctrlWheel.percent - reopened.percent * 1.1) <= 1, "one wheel event capped at about 10%");

    await chrome.send("Target.closeTarget", { targetId });
  });

  await t.test("Safari cumulative gesture events zoom once when they overlap touch input", async () => {
    const { targetId, page } = await newPage(chrome, url);
    await page.command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await chooseFile(page, path);
    await ready(page, text);
    const initial = await zoomState(page);
    const gesture = (type, scale) => safariGesture(page, "#scroll-region", type, scale, initial);
    const change = async scale => {
      assert.equal(await gesture("gesturechange", scale), false, "browser gesture canceled inside the PDF");
      return zoomState(page);
    };

    await page.evaluate(`globalThis.beforeGestureCanvas = document.querySelector(${JSON.stringify(sourceCanvas)})`);
    assert.equal(await gesture("gesturestart", 1), false);
    const larger = await change(1.08);
    assertZoom(initial, larger, 1);
    assert.ok(Math.abs(larger.percent - initial.percent * 1.08) <= 1);
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(sourceCanvas)}) === beforeGestureCanvas`), true);
    await waitFor(() => page.evaluate(`(() => {
      const canvas = document.querySelector(${JSON.stringify(sourceCanvas)});
      return canvas && canvas !== beforeGestureCanvas;
    })()`), "new canvas after pinch redraw", 2000);
    const smaller = await change(1.03);
    assertZoom(larger, smaller, -1);
    assert.ok(Math.abs(smaller.percent - initial.percent * 1.03) <= 1);
    assert.deepEqual(await change(1.03), smaller);
    await gesture("gestureend", 1.03);

    // On iOS, gesturestart may precede the second touchstart.
    await gesture("gesturestart", 1);
    await touchPair(page, smaller, 30, "touchStart");
    assert.deepEqual(await change(1.05), smaller);
    await touchPair(page, smaller, 55, "touchMove");
    await touchPair(page, smaller, 69, "touchMove");
    const touchOnly = await zoomState(page);
    assertZoom(smaller, touchOnly, 1);
    assert.deepEqual(await change(1.12), touchOnly);
    await touchPair(page, smaller, 0, "touchEnd");
    assert.deepEqual(await change(1.2), touchOnly);
    await gesture("gestureend", 1.2);
    await gesture("gesturestart", 1);
    assertZoom(touchOnly, await change(0.95), -1);
    await gesture("gestureend", 0.95);

    const wheel = await page.evaluate(`(() => {
      const region = document.querySelector("#scroll-region");
      const zoom = document.querySelector("#zoom-percentage");
      const percent = () => parseInt(zoom.textContent, 10);
      const smallWheel = () => region.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY: -0.2, clientX: ${initial.x}, clientY: ${initial.y},
      }));
      const before = percent();
      smallWheel();
      const first = percent();
      for (let index = 0; index < 8; index++) smallWheel();
      return { before, first, after: percent() };
    })()`);
    assert.equal(wheel.first, wheel.before, "one small wheel delta rounds away");
    assert.ok(wheel.after > wheel.before, "small wheel deltas accumulate into a visible change");
    assert.equal(await safariGesture(page, ".reader-header", "gesturestart", 1, { x: 400, y: 30 }), true);
    assert.equal(await safariGesture(page, ".reader-header", "gesturechange", 1.1, { x: 400, y: 30 }), true);
    await chrome.send("Target.closeTarget", { targetId });
  });

  await t.test("zoom preserves the cursor crossing into overflow and redraws after the last input", async () => {
    const { targetId, page } = await newPage(chrome, url);
    await page.command("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
    await chooseFile(page, path);
    await ready(page, text);
    await setValue(page, "#zoom", "page-width", "change");
    await waitFor(() => page.evaluate(`(() => {
      const canvas = document.querySelector(${JSON.stringify(sourceCanvas)});
      return canvas && Math.abs(canvas.width - canvas.offsetWidth) <= 1;
    })()`), "page-width canvas");

    const result = await page.evaluate(`(async () => {
      const region = document.querySelector("#scroll-region");
      const pdfPage = document.querySelector("#pages .page");
      const canvas = () => document.querySelector(${JSON.stringify(sourceCanvas)});
      const before = region.getBoundingClientRect();
      const x = before.left + region.clientWidth / 2;
      const y = before.top + region.clientHeight / 2;
      const wheel = deltaY => region.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY, clientX: x, clientY: y,
      }));
      const anchor = rect => (x - rect.left) / rect.width;
      const originalCanvas = canvas();
      const initial = pdfPage.getBoundingClientRect();
      const wasCentered = region.scrollWidth === region.clientWidth;
      wheel(-150);
      const enlarged = pdfPage.getBoundingClientRect();
      const overflowed = region.scrollWidth > region.clientWidth;
      const immediate = canvas() === originalCanvas;
      await new Promise(resolve => setTimeout(resolve, 120));
      const lastInput = performance.now();
      wheel(-0.01);
      const unchanged = pdfPage.getBoundingClientRect().width === enlarged.width;
      const redrawTime = await new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (canvas() && canvas() !== originalCanvas) finish(performance.now() - lastInput);
        });
        const timeout = setTimeout(() => finish(null), 2000);
        function finish(value) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve(value);
        }
        observer.observe(pdfPage, { childList: true, subtree: true });
        if (canvas() && canvas() !== originalCanvas) finish(0);
      });
      const percent = () => parseInt(document.querySelector("#zoom-percentage").textContent, 10);
      for (let step = 0; step < 80; step++) wheel(-150);
      const max = percent();
      wheel(150);
      const belowMax = percent();
      for (let step = 0; step < 80; step++) wheel(150);
      const min = percent();
      wheel(-150);
      return {
        wasCentered, overflowed, immediate, unchanged, redrawTime, max, belowMax, min, aboveMin: percent(),
        anchorError: Math.abs(anchor(enlarged) - anchor(initial)) * enlarged.width,
      };
    })()`);
    assert.ok(result.wasCentered && result.overflowed, "the first zoom step introduces horizontal overflow");
    assert.ok(result.anchorError <= 2, `cursor remains anchored within two pixels, got ${result.anchorError}`);
    assert.ok(result.immediate && result.unchanged, "size updates immediately and a small delta rounds away");
    assert.ok(result.redrawTime >= 190, `redraw waits approximately 200 ms from the last input, got ${result.redrawTime}`);
    assert.equal(result.max, 2500);
    assert.ok(result.belowMax < result.max, "zooming out immediately leaves the upper limit");
    assert.equal(result.min, 10);
    assert.ok(result.aboveMin > result.min, "zooming in immediately leaves the lower limit");
    await chrome.send("Target.closeTarget", { targetId });
  });

  await t.test("replacing a PDF aborts its outstanding download", async () => {
    const { targetId, page } = await newPage(chrome, url);
    await openUrl(page, `${server.origin}/slow-download.pdf`);
    await ready(page, "#document-toolbar:not([hidden])");
    await click(page, "#download");
    assert.equal(await exists(page, "#download:disabled"), true);
    await waitFor(() => server.blockedRanges > 0, "pending PDF download");
    await chooseFile(page, path);
    await waitFor(() => page.evaluate('document.querySelector("#filename").textContent === "sample.pdf"'), "replacement PDF");
    await ready(page, "#download:enabled");
    await waitFor(() => server.blockedRanges === 0, "closed HTTP range request");
    await chrome.send("Target.closeTarget", { targetId });
  });

  const { id } = await chrome.send("Extensions.loadUnpacked", { path: extension });
  const extensionUrl = `chrome-extension://${id}/extension.html`;

  await t.test("unpacked MV3 toolbar action, local PDF, URL and persisted preferences", async () => {
    const workerUrl = `chrome-extension://${id}/background.js`;
    const { tab, worker, viewer } = await waitFor(async () => {
      const { targetInfos } = await chrome.send("Target.getTargets", { filter: [{ type: "tab" }, { type: "service_worker" }, { type: "page" }] });
      const tab = targetInfos.find(info => info.type === "tab" && info.url === url);
      const viewer = targetInfos.find(info => info.type === "page" && info.url === url);
      const worker = targetInfos.find(info => info.url === workerUrl);
      if (tab && viewer && worker) return { tab, viewer, worker };
    }, "registered extension worker and toolbar tab");
    const background = await chrome.attach(worker.targetId);
    await waitFor(() => background.evaluate("globalThis.chrome?.action?.onClicked.hasListeners()"), "extension action listener");
    await chrome.send("Target.activateTarget", { targetId: viewer.targetId });
    await chrome.send("Extensions.triggerAction", { id, targetId: tab.targetId });
    const target = await waitFor(async () => {
      const { targetInfos } = await chrome.send("Target.getTargets");
      return targetInfos.find(info => info.url === extensionUrl);
    }, "extension viewer tab");
    const page = await chrome.attach(target.targetId);
    await ready(page, "#file-picker");
    await page.evaluate(`(() => {
      globalThis.localWorkers = [];
      globalThis.Worker = class extends Worker {
        constructor(url, options) {
          super(url, options);
          this.addEventListener("message", () => localWorkers.push(String(url)), { once: true });
        }
      };
    })()`);
    await chooseFile(page, path);
    await ready(page, text);
    const workers = await page.evaluate("localWorkers");
    for (const file of ["pdf.worker.min", "pdf.renderer.min"]) {
      assert.ok(workers.some(url => url.startsWith(`chrome-extension://${id}/`) && url.includes(file)), JSON.stringify(workers));
    }
    const beforePinch = await zoomState(page);
    await pinch(page, beforePinch, 1.25, "mouse");
    assertZoom(beforePinch, await zoomState(page), 1);
    await setValue(page, "#zoom", "page-fit", "change");
    await selectTheme(page, "dark");
    await click(page, "#invert");
    await ready(page, invertedCanvas);
    assert.deepEqual(await sample(page, invertedCanvas, 0.1, 0.08), [102, 153, 204, 255]);
    await click(page, "#toggle-sidebar");
    await ready(page, '.thumbnail[data-page="1"] canvas');
    await click(page, '.thumbnail[data-page="2"]');
    await ready(page, `${selectedThumbnail}[data-page="2"]`);
    await click(page, "#toggle-sidebar");
    await openUrl(page, `${server.origin}/without-cors.pdf`);
    await waitFor(() => page.evaluate('!document.querySelector("#file-error").hidden'), "cross-origin refusal");
    await openUrl(page, `${server.origin}/sample.pdf`);
    await ready(page, text);
    await page.command("Page.reload");
    await waitFor(() => page.evaluate('document.querySelector("#theme")?.value === "dark" && document.querySelector("#invert")?.getAttribute("aria-pressed") === "true"'), "saved extension preferences");
  });

  await t.test("extension URL opens local PDFs at startup and switches PDFs in the same tab", async () => {
    const name = "資料 & #1+%.pdf";
    const localPath = join(directory, name);
    await writeFile(localPath, samplePdf(2));
    const fragment = value => `#?file=${encodeURIComponent(value)}`;
    const initialUrl = extensionUrl + fragment(localPath);

    const settings = await chrome.send("Target.createTarget", { url: `chrome://extensions/?id=${id}` });
    const settingsPage = await chrome.attach(settings.targetId);
    await waitFor(() => settingsPage.evaluate("!!globalThis.chrome?.developerPrivate?.updateExtensionConfiguration"), "extension settings");
    // Chrome reloads the unpacked extension after a file access change.
    await settingsPage.evaluate("chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })");
    const setFileAccess = async fileAccess => {
      await settingsPage.evaluate(
        `chrome.developerPrivate.updateExtensionConfiguration(${JSON.stringify({ extensionId: id, fileAccess })})`,
      );
      await waitFor(() => settingsPage.evaluate(`chrome.developerPrivate.getExtensionInfo(${JSON.stringify(id)})
        .then(info => info.state === "ENABLED" && info.fileAccess.isActive === ${fileAccess})`), "extension reload after permission change");
    };

    await setFileAccess(false);
    const denied = await newPage(chrome, initialUrl);
    assert.equal(await denied.page.evaluate("chrome.extension.isAllowedFileSchemeAccess()"), false);
    await ready(denied.page, "#file-error:not([hidden])");
    assert.match(await denied.page.evaluate('document.querySelector("#error-message").textContent'), /Allow access to file URLs/);
    await chrome.send("Target.closeTarget", { targetId: denied.targetId });

    await setFileAccess(true);
    await chrome.send("Target.closeTarget", { targetId: settings.targetId });

    const { targetId, page } = await newPage(chrome, initialUrl);
    await ready(page, text);
    assert.equal(await page.evaluate("chrome.extension.isAllowedFileSchemeAccess()"), true);
    const filename = () => page.evaluate('document.querySelector("#filename").textContent');
    assert.equal(await filename(), name);
    await page.evaluate("globalThis.sameViewer = true");

    const setFragment = hash => page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    await setFragment(fragment(pathToFileURL(largePath).href));
    await waitFor(async () => await filename() === "large.pdf", "replacement local PDF");
    await ready(page, text);
    assert.equal(await page.evaluate("globalThis.sameViewer"), true);

    await setFragment(fragment(`${server.origin}/sample.pdf?name=a%26b&version=2`));
    await waitFor(async () => await filename() === "sample.pdf", "replacement HTTP PDF");
    await ready(page, text);

    await setFragment(fragment(join(directory, "missing.pdf")));
    await ready(page, "#file-error:not([hidden])");
    assert.match(await page.evaluate('document.querySelector("#error-message").textContent'), /Check the file path/);

    await setFragment(fragment("./relative.pdf"));
    await waitFor(() => page.evaluate('document.querySelector("#error-message").textContent.includes("absolute local path")'), "invalid fragment guidance");
    await chrome.send("Target.closeTarget", { targetId });
  });

  assert.deepEqual(chrome.issues.filter(issue => !issue.includes("CORS policy")), []);
});
