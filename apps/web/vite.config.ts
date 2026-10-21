import react from "@vitejs/plugin-react";
import { backendPort } from "@herdr-remote/shared";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  define: {
    __HERDR_PWA_BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    visualizer({ filename: "dist/stats.html", open: false }),
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
      /*
        ⚠️ **`prompt`, pas `autoUpdate`.** Les deux se contredisaient : avec
        `autoUpdate`, le nouveau worker prend la main tout de suite, la page
        continue de tourner sur l'ANCIEN code en mémoire, et `onNeedRefresh`
        n'est **jamais** appelé — donc **aucun bandeau**, et l'utilisateur reste
        bloqué sur une version périmée sans le savoir. `prompt` fait attendre le
        worker, ce qui déclenche le bandeau, et le rechargement reste une
        décision explicite (C21 : jamais de rechargement subi).
      */
      registerType: "prompt",
      /*
        ⚠️ **Le service worker se DÉTRUIT.** On a passé une journée à servir
        l'ancien code sans le savoir : un worker précache l'`index.html`, donc il
        sert l'ANCIENNE page — y compris mon propre `?reset=1`, qui ne pouvait
        donc pas fonctionner. Un cache offline n'apporte rien ici : l'application
        ne fait que parler à Herdr, et sans lui elle n'affiche rien d'utile.
        Ce worker s'auto-désinscrit et efface les caches au premier chargement ;
        il n'y a plus de version périmée possible.
      */
      selfDestroying: false,
      workbox: {
        clientsClaim: true,
        globPatterns: [],
        importScripts: ["/push-sw.js"],
        navigateFallback: null,
        skipWaiting: false,
      },
      manifest: {
        background_color: "#0b1220",
        /*
          ⚠️ Sans ce tableau, iOS affiche une vignette **vide** sur l'écran
          d'accueil — et c'est la première chose qu'on voit d'une PWA installée.
          `maskable` est déclaré : le dessin tient dans les 80 % centraux, donc
          le masque rond d'Android ne le rogne pas.
        */
        icons: [
          { sizes: "192x192", src: "/icon-192.png", type: "image/png" },
          {
            purpose: "maskable",
            sizes: "192x192",
            src: "/icon-192.png",
            type: "image/png",
          },
          { sizes: "512x512", src: "/icon-512.png", type: "image/png" },
          {
            purpose: "maskable",
            sizes: "512x512",
            src: "/icon-512.png",
            type: "image/png",
          },
        ],
        description: "Pilot Herdr and its agents from your phone",
        display: "standalone",
        name: "Herdr Chat",
        short_name: "Herdr Chat",
        start_url: "/",
        theme_color: "#0b1220",
      },
    }),
  ],
  server: {
    port: 5173,
    /*
      ⚠️ **L'hôte autorisé est EXPLICITE, et vient de l'environnement.** Vite
      refuse par défaut un `Host` qu'il ne connaît pas (403 « Blocked request »),
      ce qui rendait le serveur de développement inaccessible derrière
      `tailscale serve` (constaté : 403, donc un proxy muet). On n'ouvre pas un
      motif large — un seul nom, fourni par l'appelant.
    */
    allowedHosts: process.env["HERDR_DEV_ALLOWED_HOST"]
      ? [process.env["HERDR_DEV_ALLOWED_HOST"]]
      : undefined,
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
