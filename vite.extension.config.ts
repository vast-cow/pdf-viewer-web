import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import { sharedConfig } from "./vite.shared.ts";

const projectFile = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const extensionFiles: Plugin = {
  name: "copy-extension-assets",
  async writeBundle({ dir }) {
    if (dir) await cp(projectFile("./extension"), dir, { recursive: true });
  },
};

export default mergeConfig(sharedConfig, defineConfig({
  plugins: [extensionFiles],
  build: {
    outDir: "dist/extension",
    rolldownOptions: {
      input: {
        viewer: projectFile("./extension.html"),
        background: projectFile("./src/platform/extension-background.ts"),
      },
      output: {
        entryFileNames: chunk => chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
}));
