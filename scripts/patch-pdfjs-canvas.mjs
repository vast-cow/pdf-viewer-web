import { readFile, writeFile } from "node:fs/promises";

const pdfjs = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", pdfjs), "utf8"));
if (version !== "6.5.438") {
  throw new Error(`PDF.js alpha patch expects pdfjs-dist@6.5.438, found ${version}. Review both canvas factories before upgrading.`);
}

// PDF.js fills the page background itself. An alpha-enabled backing store
// avoids LCD text antialiasing in Chromium while preserving that background.
const implementations = [
  ["pdf.mjs", `getNoAlphaContext(canvas) {
    return canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: !this.#enableHWA
    });
  }`, "alpha: false", "alpha: true"],
  ["pdf.renderer.min.mjs", 'getNoAlphaContext(t){return t.getContext("2d",{alpha:!1,willReadFrequently:!this.#It})}', "alpha:!1", "alpha:!0"],
];

// Validate both entry points before changing either file.
const updates = await Promise.all(implementations.map(async ([file, before, opaque, alpha]) => {
  const path = new URL(`legacy/build/${file}`, pdfjs);
  const source = await readFile(path, "utf8");
  const after = before.replace(opaque, alpha);
  const originalCount = source.split(before).length - 1;
  const patchedCount = source.split(after).length - 1;
  if (originalCount + patchedCount !== 1) {
    throw new Error(`PDF.js alpha patch expected exactly one known getNoAlphaContext implementation in ${file}. Review the installed build.`);
  }
  return { path, source, patched: source.replace(before, after) };
}));

await Promise.all(updates.filter(({ source, patched }) => source !== patched).map(
  ({ path, patched }) => writeFile(path, patched),
));
