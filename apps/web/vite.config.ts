import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // `prompt` plutôt que `autoUpdate` : sur iPhone, une mise à jour
      // silencieuse pendant une session active est déroutante.
      registerType: "prompt",
      manifest: {
        background_color: "#0b1220",
        description: "Piloter Herdr et ses agents depuis l'iPhone",
        display: "standalone",
        name: "Herdr Remote",
        short_name: "Herdr",
        start_url: "/",
        theme_color: "#0b1220",
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // En développement, l'API est servie par le backend Bun. `changeOrigin`
      // n'est pas nécessaire : tout est local.
      "/api": {
        target: "http://127.0.0.1:8765",
        ws: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "esnext",
  },
});
