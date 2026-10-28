import { defineConfig } from "vite";

// Relative asset paths, so the built site works from any folder: Vercel at the
// root, or GitHub Pages under /<repo>/.
export default defineConfig({ base: "./" });
