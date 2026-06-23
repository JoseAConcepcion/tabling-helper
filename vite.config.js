import { defineConfig } from "vite";

export default defineConfig({
  root: "src", // tu frontend vive en src/
  build: { outDir: "../dist", emptyOutDir: true },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
