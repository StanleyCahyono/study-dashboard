import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server is for development only, bound to loopback, and talks to the
// DEMO profile. Never expose it through Tailscale; production is `studyctl serve`.
const DEMO_API = "http://127.0.0.1:8766";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    proxy: {
      "/api": {
        target: DEMO_API,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            if (req.getHeader("origin")) req.setHeader("origin", DEMO_API);
          });
        },
      },
    },
  },
});
