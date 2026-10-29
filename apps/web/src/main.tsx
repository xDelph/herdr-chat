/**
 * Point d'entrée.
 *
 * ⚠️ **Le thème est posé avant le premier rendu** : posé après, l'écran
 * s'afficherait clair puis basculerait.
 *
 * ⚠️ **Le service worker ne sert qu'aux notifications push** (`public/sw.js`) :
 * il ne met rien en cache et ne se désinscrit jamais — se désinscrire détruirait
 * l'abonnement push. La fraîcheur de l'app vient du serveur : `index.html` en
 * `no-cache`, les fichiers hachés en `immutable`. Aucun identifiant de build,
 * aucun bandeau de mise à jour : un rechargement charge la dernière version.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { reportError } from "./api.ts";
import { lireTheme, poserTheme, rafraichirCouleurDeBarre } from "./preferences.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/boite.css";
import "./styles/conversation.css";
import "./styles/feuilles.css";
import "./styles/taches.css";

poserTheme(lireTheme());
window.addEventListener("load", rafraichirCouleurDeBarre, { once: true });
// Le thème « Auto » suit l'appareil : la barre système suit aussi.
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", rafraichirCouleurDeBarre);

if ("serviceWorker" in navigator) {
  void (async () => {
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch (cause) {
      // Sans worker, pas de push — on le dit au journal, l'app reste utilisable.
      reportError("service worker registration failed", {
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  })();
}

const racine = document.getElementById("root");
if (racine === null) throw new Error("élément #root introuvable");

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
