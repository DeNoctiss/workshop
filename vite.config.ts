import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  server: { allowedHosts: ["terminal.local"] },
  preview: { allowedHosts: ["terminal.local"] },
  build: { target: "es2022" },
});
