import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "mac/build/editor",
    lib: {
      entry: resolve(__dirname, "src/macEditor.ts"),
      name: "JesSeeStoryEditor",
      formats: ["iife"],
      fileName: () => "mac-editor.js",
      cssFileName: "mac-editor"
    }
  }
});
