import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://<user>.github.io/<repo>/ so every path is relative to BASE.
const base = process.env.BASE_PATH ?? "/study-dashboard/";

export default defineConfig({
  base,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
