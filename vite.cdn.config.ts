import { defineConfig } from "vite";

// The <script> tag build: one minified file that registers <sakura-tree> and sets window.Sakura.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "lib",
    emptyOutDir: false, // keep the ES build next to it
    target: "es2020",
    lib: { entry: "src/cdn.ts", name: "Sakura", formats: ["iife"], fileName: () => "sakura-tree.iife.js" },
  },
});
