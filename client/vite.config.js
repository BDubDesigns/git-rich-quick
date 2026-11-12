/* global process */
// vite.config.js runs in Node during the build, so `process.env` is
// how it reads the commit Vercel / CI set (see below).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite"; // <-- Import tailwindcss plugin

// Build-time version info, shown in Settings so a player can confirm
// which code they are running (e.g. whether a fix has reached them).
// Vercel sets VERCEL_GIT_COMMIT_SHA during the build; GitHub Actions
// sets GITHUB_SHA; local dev has neither and reads "dev". The short
// hash (7 chars) is enough to tell one deployed build from another.
const commitSha =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
const shortCommit = commitSha ? commitSha.slice(0, 7) : "dev";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_COMMIT__: JSON.stringify(shortCommit),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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
