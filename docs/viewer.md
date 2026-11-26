# Viewer and deployment

## How the targets share code

The web and extension entry points both mount the viewer in `src/viewer/`. Web preferences use per-origin local storage. Extension preferences use Chrome’s local extension storage. Chrome’s background service worker opens the viewer in a new tab when the toolbar action fires. The extension requests `storage` and `debugger`, and declares the `file:///*` host permission for opening local PDF URLs.

Both builds include the PDF.js parser and rendering workers, annotation images, character maps, standard fonts, color profiles, and image decoders. The extension allows local WebAssembly for the decoders. PDF document scripting is disabled. A static host must serve JavaScript modules with a JavaScript MIME type and should serve WebAssembly as `application/wasm`. Both builds use relative asset paths. The web build also works when hosted under a subdirectory.

## Reading PDFs

- Open a file with the picker, drag it onto the viewer, or choose **Open URL** in **More actions** and enter an absolute HTTP(S) URL.
- Use the page field or choose **Previous page** or **Next page** in **More actions**. The toolbar provides **Fit width**, **Fit page**, zoom, and clockwise rotation. On narrow screens, the menu also holds fit, rotation, find, and download actions.
- Open the sidebar to browse page thumbnails or follow bookmarks in the document outline. In the thumbnail list, use the arrow keys to move between previews and Enter to open the focused page.
- Use **Find** or Ctrl/Command+F to search. Enter moves to the next match and Shift+Enter moves to the previous one. Text selection, links, and supported annotations stay available in either PDF color mode.
- **Download** retrieves the original PDF bytes. The viewer also supports password entry and retries for encrypted PDFs supported by PDF.js.
- **Theme** in **More actions** controls the interface. **Invert PDF** in the toolbar controls the pixel colors on rendered pages. Both preferences persist independently.

URL loading follows the browser’s access rules, including CORS and mixed-content restrictions. Cross-origin URLs generally need a suitable `Access-Control-Allow-Origin` header. For incremental loading, the server must also support and expose the relevant byte-range headers. Scans without a text layer need OCR before their text can be selected or searched. XFA forms and PDF scripts are outside the viewer’s supported features.

### Open a PDF from the extension URL

Open `chrome-extension://<extensionID>/extension.html#?file=/home/user/a.pdf` to load a PDF at startup. Change the `#?file=...` fragment to switch PDFs in the same tab. The `file` value accepts absolute paths such as `/home/user/a.pdf` and `C:\Users\user\a.pdf`, local file URLs such as `file:///home/user/a.pdf`, and HTTP(S) URLs without embedded credentials.

For a local path or `file:///` URL, enable **Allow access to file URLs** on the extension’s details page in `chrome://extensions`. See [Chrome’s extension permissions guide](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions#allow-access).

If the `file` value contains spaces, `&`, or other URL delimiters, encode the entire value with `encodeURIComponent` before adding it to the fragment:

```js
const viewer = "chrome-extension://<extensionID>/extension.html";
const file = "/home/user/Notes & plans.pdf";
const viewerUrl = `${viewer}#?file=${encodeURIComponent(file)}`;
```

### Reopen a PDF selected with Open File

In the Chrome extension, **Open File** starts loading the selected PDF immediately. With **Allow access to file URLs** enabled, the viewer adds the encoded absolute path to the current tab’s address bar. Reload the tab to reopen that PDF. Selecting another file replaces the path. Dragging in a file, using **Open URL**, or closing the PDF clears the picker path. If Chrome can’t retrieve the path or file access is disabled, the viewer still opens the selected PDF and shows a notice explaining why the address bar could not be updated.

Chrome lists two warnings for the required `debugger` permission, “Access the page debugger backend” and “Read and change all your data on all websites.” The extension checks the file access setting and attaches only to the viewer tab to read the selected file’s path. Chrome can display the banner `"PDF Reader" started debugging this browser`. The extension disconnects after the lookup. [Chrome’s permission warnings](https://developer.chrome.com/docs/extensions/reference/permissions-list) · [Chromium’s debugger banner text](https://chromium.googlesource.com/chromium/src/+/main/chrome/app/generated_resources.grd)

## How PDF lightness inversion works

For normalized RGB, let `low` and `high` be the minimum and maximum channels. HSL lightness is `(low + high) / 2`. If lightness is reflected around 0.5, the term `1 - |2L - 1|` stays the same, so a fixed saturation produces the same chroma. Hue depends on channel differences, which also stay the same when the same offset is added to each channel. This gives the exact HSL result with one RGB offset:

```text
RGB′ = RGB + (1 − high − low)
A′   = A
```

The Canvas implementation uses `255 - high - low` for 8-bit channels. Applying it twice restores the original bytes. The WebGL2 fragment shader uses the normalized form. Browser canvas compositing can introduce minor rounding for partially transparent pixels.

## Rendering and memory

PDF.js schedules visible pages first, limits the page bitmap dimensions, and cancels obsolete renders as the zoom or document changes. High-DPI rendering uses the device pixel ratio within the bitmap budget. At high zoom the viewer also renders a detail canvas for the visible area. Local files are read in slices when needed, and URL loading can use HTTP range requests.

Both builds rasterize PDF pages, high-zoom details, and thumbnails with alpha-enabled Canvas 2D contexts, including when inversion is off. In Chromium this suppresses LCD subpixel antialiasing, whose colored text fringes would otherwise survive hue-preserving inversion. The change leaves grayscale antialiasing, subpixel positioning, font hinting, and document colors to the normal rasterizer. PDF.js still fills the page background with opaque white. The HTML standard defines `alpha: true` as a transparency capability, so grayscale-only antialiasing remains browser-dependent. [HTML Canvas 2D context settings](https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-alpha)

The `npm ci` postinstall script patches `BaseCanvasFactory.getNoAlphaContext()` in the pinned PDF.js 6.5.438 legacy main module and minified renderer worker. The script checks both implementations before writing either file and fails if the version or expected code changes. Review both sites when upgrading PDF.js. Optimized partial rendering and canvas size limits continue to use PDF.js's existing paths.

The sidebar renders thumbnails one at a time around its visible area. It releases preview canvases when they scroll out of range, when the sidebar closes, and when the document changes. PDF.js releases thumbnail rendering data for pages outside its main viewer cache.

Inversion uses one reusable WebGL2 context and one pass per canvas. If WebGL2 is unavailable or a canvas exceeds GPU limits, it uses a Canvas 2D pixel pass. Only visible pages get an extra bitmap. Toggling inversion reuses rendered PDF pixels, and removing a document releases its canvases, worker resources, and fetch requests. Search can read text across the PDF, including unrendered pages. PDF.js may switch to page-at-a-time scrolling for exceptionally long documents.

## Verification

- `npm test` checks color edge cases, alpha, the HSL reference result, numerical round trips, and extension fragment parsing.
- `npm run check` checks the TypeScript source.
- `npm run build` builds the production web and unpacked extension targets.
- `npm run test:browser` exercises both builds with an installed Chrome that supports the DevTools Protocol extension commands. The tests check the raster context on the main thread and inside the renderer worker, grayscale text edges, original and inverted colors, detail and thumbnail rendering, and bitmap reuse. Use `CHROME_BIN` if the executable is named differently. Browser tests start a local static server and use a disposable Chrome profile.
