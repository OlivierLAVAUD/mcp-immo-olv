import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * In development the React app runs on Vite (5173) and forwards /api to the
 * bridge (8787), which is what actually talks to the MCP server over stdio.
 * In production `npm run build && npm start` serves everything from the bridge
 * on a single port, so no proxy is involved.
 */
const bridge = process.env.IMMO_BRIDGE_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: bridge, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
