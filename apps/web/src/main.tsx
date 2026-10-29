/**
 * Point d'entrée.
 *
 * ⚠️ **Le thème est posé avant le premier rendu** : posé après, l'écran
 * s'afficherait clair puis basculerait.
 *
 * ⚠️ **Le service worker ne sert qu'aux notifications push** (`public/sw.js`) :
 * il ne met rien en cache et ne se désinscrit jamais — se désinscrire détruirait
 * l'abonnement push. La fraîcheur de l'app vient du serveur : `index.html` en
 * `no-cache`, les fichiers hachés en `immutable`. Au retour au premier plan,
 * `nouvelle-version.ts` compare le script d'entrée servi à celui de la page et
 * offre de recharger — jamais pendant une saisie.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { reportError } from "./api.ts";
import { ecouteNavigationWorker } from "./navigation-worker.ts";
import {
  lireStyleMarque,
  lireTheme,
  poserStyleMarque,
  poserTheme,
  rafraichirCouleurDeBarre,
} from "./preferences.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/boite.css";
import "./styles/conversation.css";
import "./styles/feuilles.css";
import "./styles/fiabilite.css";
import "./styles/taches.css";

poserTheme(lireTheme());
poserStyleMarque(lireStyleMarque());
window.addEventListener("load", rafraichirCouleurDeBarre, { once: true });
// Le thème « Auto » suit l'appareil : la barre système suit aussi.
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", rafraichirCouleurDeBarre);

if ("serviceWorker" in navigator) {
  // Après un appui sur une notification, le worker peut demander d'ouvrir une
  // conversation : le fragment change, le routage suit (`hashchange`).
  ecouteNavigationWorker(navigator.serviceWorker, (hash) => {
    if (window.location.hash !== hash) window.location.hash = hash;
  });
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
