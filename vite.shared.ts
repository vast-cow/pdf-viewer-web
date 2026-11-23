import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const pdfjs = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));

function copyPdfAssets(): Plugin {
  return {
    name: "copy-pdfjs-assets",
    async writeBundle({ dir }) {
      if (!dir) return;
      const target = join(dir, "pdfjs");
      await mkdir(target, { recursive: true });
      await Promise.all([
        ...["cmaps", "iccs", "standard_fonts", "LICENSE"].map(name =>
          cp(join(pdfjs, name), join(target, name), { recursive: true }),
        ),
        cp(join(pdfjs, "web/images"), join(target, "images"), { recursive: true }),
        copyImageDecoders(target),
      ]);
    },
  };
}

async function copyImageDecoders(target: string) {
  const destination = join(target, "wasm");
  await mkdir(destination, { recursive: true });
  const files = await readdir(join(pdfjs, "wasm"));
  await Promise.all(files.filter(name => !/quickjs/i.test(name)).map(name =>
    cp(join(pdfjs, "wasm", name), join(destination, name)),
  ));
}

export const sharedConfig = defineConfig({
  base: "./",
  plugins: [copyPdfAssets()],
  optimizeDeps: { exclude: ["pdfjs-dist"] },
  build: { target: "es2024" },
});
