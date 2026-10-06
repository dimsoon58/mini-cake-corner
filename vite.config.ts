import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Identifiant de la version publiée : écrit dans dist/version.json et dans le
// code. L'admin compare les deux pour signaler une page ouverte avant une
// nouvelle publication (« Nouvelle version — recharger »).
const BUILD_ID = process.env.GITHUB_SHA || `local-${Date.now()}`;
const versionFile = (): Plugin => ({
  name: "bento-version-file",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), versionFile(), mode === "development" && componentTagger()].filter(Boolean),
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
