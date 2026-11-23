import { mergeConfig } from "vite";
import { sharedConfig } from "./vite.shared.ts";

export default mergeConfig(sharedConfig, {
  server: { watch: { ignored: ["**/dist/**"] } },
  build: { outDir: "dist/web" },
});
