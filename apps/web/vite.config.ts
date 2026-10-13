import react from "@vitejs/plugin-react";
import { backendPort } from "@herdr-remote/shared";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  define: {
    __HERDR_PWA_BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // Registration is explicit in main.tsx so an installed app checks for a
      // new worker whenever it returns to the foreground.
      injectRegister: null,
      /**
       * `autoUpdate` et non `prompt`.
       *
       * Avec `prompt`, le nouveau service worker **attend** une confirmation
       * d'installation qui n'est jamais demandée explicitement : le navigateur
       * sert indéfiniment l'ancien bundle. Vérifié à l'écran — deux captures
       * identiques octet pour octet avant et après un correctif, alors que le
       * serveur envoyait bien la nouvelle version.
       *
       * Le risque annoncé de `autoUpdate` (rechargement pendant une session) est
       * traité par `skipWaiting` + `clientsClaim` : la mise à jour s'applique à
       * la prochaine navigation, pas au milieu d'une frappe.
       */
      registerType: "autoUpdate",
      workbox: {
        clientsClaim: true,
        importScripts: ["/push-sw.js"],
        skipWaiting: true,
      },
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
      // Le backend écoute sur `DEFAULT_BACKEND_PORT` (8791), source partagée avec
      // `apps/server/src/config.ts`. Avant ce partage, la cible était figée sur
      // 8765 — le service `print-cost-report` de l'utilisateur : en développement,
      // `/api/*` répondait depuis un serveur sans rapport.
      "/api": {
        target: `http://127.0.0.1:${backendPort(process.env)}`,
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
