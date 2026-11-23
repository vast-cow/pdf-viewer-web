# PDF Reader

A client-side PDF.js reader for the web and Chrome. Open a local file or PDF URL, then navigate, zoom, search, and download the original. The UI theme and hue-preserving PDF inversion have independent controls.

## Setup and development

Requires Node.js 22.13 or later and npm.

```sh
npm ci
npm run dev
npm test
npm run check
```

## Build and deploy

- `npm run build:web` builds `dist/web/`. Publish that directory on a static HTTP(S) host.
- `npm run build:extension` builds `dist/extension/`. In `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select that directory. Click the extension’s toolbar icon to open the reader.
- `npm run build` builds both targets. After building, run `npm run test:browser` with an installed Chrome.

For GitHub Pages, select **GitHub Actions** as the source under **Settings → Pages**. The **Deploy GitHub Pages** workflow builds and publishes `dist/web/` when web build inputs change on `main`. You can also run it manually from the **Actions** tab.

See [architecture, color inversion, and browser testing](docs/viewer.md) for details.
