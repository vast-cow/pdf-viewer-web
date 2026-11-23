import { mergeConfig } from "vite";
import { sharedConfig } from "./vite.shared.ts";

export default mergeConfig(sharedConfig, {
  build: { outDir: "dist/web" },
});
