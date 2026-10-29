import react from "@vitejs/plugin-react";
import { backendPort } from "@herdr-remote/shared";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

/*
  ⚠️ **Plus de vite-plugin-pwa, plus d'identifiant de build dans index.html.**
  La pile précédente cumulait un worker Workbox qui ne précachait rien
  (`globPatterns: []`), un bandeau de mise à jour pour ce cache vide, et un
  script inline qui **désinscrivait tous les workers** à chaque nouveau build —
  ce qui détruisait l'abonnement push à chaque déploiement.

  Une seule stratégie désormais : le serveur sert `index.html` en no-cache et
  les fichiers hachés en immutable ; `public/sw.js` ne fait que le push ;
  `public/manifest.webmanifest` est statique.
*/
export default defineConfig({
  define: {
    // Affiché dans les réglages pour le diagnostic — n'influe sur aucun cache.
    __HERDR_PWA_BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), visualizer({ filename: "dist/stats.html", open: false })],
  server: {
    port: Number(process.env["HERDR_DEV_PORT"] ?? 5173),
    /*
      ⚠️ **L'hôte autorisé est EXPLICITE, et vient de l'environnement.** Vite
      refuse par défaut un `Host` qu'il ne connaît pas (403), ce qui rendait le
      serveur de développement inaccessible derrière `tailscale serve`.
    */
    allowedHosts: process.env["HERDR_DEV_ALLOWED_HOST"]
      ? [process.env["HERDR_DEV_ALLOWED_HOST"]]
      : undefined,
    proxy: {
      /*
        Le backend écoute sur `DEFAULT_BACKEND_PORT` (8791), source partagée
        avec le serveur ; `HERDR_DEV_API` permet de viser un autre démon (un
        démon de lecture, par exemple) sans toucher au code.
      */
      "/api": {
        target: process.env["HERDR_DEV_API"] ?? `http://127.0.0.1:${backendPort(process.env)}`,
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
