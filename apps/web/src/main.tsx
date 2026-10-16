import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import { appliquerTheme, lireTheme, rafraichirCouleurDeBarre } from "./theme.ts";
import "./styles.css";

/*
  Le theme est pose **avant le premier rendu**.

  ⚠️ Appliqué après coup, l'interface s'afficherait en bleu puis basculerait : un
  clignotement a chaque ouverture, d'autant plus visible qu'un theme sombre
  change la totalite de l'ecran. L'attribut est ce qui decide de l'apparence ;
  la couleur de la barre systeme, elle, se lit dans le CSS et ne peut etre
  reprise qu'une fois la feuille appliquee — d'ou le second appel.
*/
appliquerTheme(lireTheme());
window.addEventListener("load", rafraichirCouleurDeBarre, { once: true });

const avaitDejaUnWorker = navigator.serviceWorker.controller !== null;
let rechargementApresMiseAJour = false;

if (avaitDejaUnWorker) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (rechargementApresMiseAJour) return;
    rechargementApresMiseAJour = true;
    window.location.reload();
  });
}

registerSW({
  immediate: true,
  onRegisteredSW: (_serviceWorkerUrl, registration) => {
    if (!registration) return;

    const checkForUpdate = async () => {
      if (document.visibilityState === "visible") {
        try {
          await registration.update();
        } catch (cause: unknown) {
          console.error("[pwa] service worker update check failed:", cause);
        }
      }
    };

    void checkForUpdate();
    const checkForUpdateOnEvent = () => void checkForUpdate();
    window.addEventListener("focus", checkForUpdateOnEvent);
    window.addEventListener("pageshow", checkForUpdateOnEvent);
    document.addEventListener("visibilitychange", checkForUpdateOnEvent);
    window.setInterval(checkForUpdateOnEvent, 5 * 60_000);
  },
});

const container = document.getElementById("root");
if (container === null) {
  throw new Error("élément #root introuvable");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
