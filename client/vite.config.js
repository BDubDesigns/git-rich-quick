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
const buildTime = new Date().toISOString();

// Stale-client guard: one id per build, the full commit sha when the
// build has one, else the build time. The bundle carries it as
// __BUILD_ID__ (sent with every save as clientBuild) and the build
// writes it to version.json; a tab whose id differs from the deployed
// version.json stops saving and asks the player to reload (see
// src/save/versionCheck.js).
const BUILD_ID = commitSha || buildTime;

// Writes dist/version.json with the build id. Build only: under
// `vite dev` the file does not exist, the version fetch gets
// index.html back, and the client saves normally.
function versionJsonPlugin(buildId) {
  return {
    name: "grq-version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildId }) + "\n",
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionJsonPlugin(BUILD_ID)],
  define: {
    __APP_COMMIT__: JSON.stringify(shortCommit),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
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
