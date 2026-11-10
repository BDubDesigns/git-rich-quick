import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite"; // <-- Import tailwindcss plugin

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Local dev mirrors the Vercel rewrite in vercel.json: /api/* goes
      // to the local backend, so the browser stays same-origin here too
      // (same first-party session cookie as production). The backend
      // listens on PORT (default 3000); point it elsewhere by changing
      // the target, or bypass the proxy with VITE_SAVE_API_URL.
      "/api": "http://localhost:3000",
    },
  },
});
