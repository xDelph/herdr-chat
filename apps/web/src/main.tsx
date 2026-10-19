import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { doitRecharger, signaleMiseAJour } from "./mise-a-jour.ts";
import { App } from "./App.tsx";
import {
  appliquerStyleMarque,
  appliquerTheme,
  lireStyleMarque,
  lireTheme,
  rafraichirCouleurDeBarre,
} from "./preferences.ts";
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
appliquerStyleMarque(lireStyleMarque());
window.addEventListener("load", rafraichirCouleurDeBarre, { once: true });

/*
  ⚠️ **Aucun rechargement SUBI (C21).** Un `controllerchange` peut venir d'un
  worker qui prend la main sans qu'on ait rien demandé — recharger alors
  effacerait un brouillon en cours ou un envoi incertain. On ne recharge donc
  que si l'utilisateur a appliqué la mise à jour explicitement
  (`mise-a-jour.ts`), et c'est `doitRecharger()` qui répond.
*/
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (!doitRecharger()) return;
  window.location.reload();
});

registerSW({
  immediate: true,
  /*
    ⚠️ `onNeedRefresh` : un nouveau worker ATTEND. On le signale à l'interface
    (`mise-a-jour.ts`), qui propose l'action ; rien n'est appliqué ici.
  */
  onNeedRefresh: () => {
    // `await` plutôt que `.then` : même effet, une seule ligne, et l'échec de
    // `getRegistration` ne fabrique pas une promesse non attendue.
    void (async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) signaleMiseAJour(registration);
    })();
  },
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

/*
  ⚠️ **La sortie de secours : `?reset=1`.** Un worker coincé peut servir une
  version périmée sans jamais proposer de mise à jour — c'est arrivé, et il n'y
  avait aucun moyen de s'en sortir depuis l'interface. Ici on désinscrit les
  workers, on efface les caches, puis on recharge sans le paramètre. C'est la
  seule action destructive, et elle est explicite.
*/
const reinitialiser = async (): Promise<void> => {
  try {
    const enregistrements = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(enregistrements.map((enregistrement) => enregistrement.unregister()));
    const caches = (await globalThis.caches?.keys()) ?? [];
    await Promise.all(caches.map((cle) => globalThis.caches.delete(cle)));
  } catch {
    // Un échec de nettoyage ne doit pas empêcher le rechargement.
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("reset");
  window.location.replace(url.toString());
};

if (new URL(window.location.href).searchParams.get("reset") === "1") {
  void reinitialiser();
} else {
  const container = document.getElementById("root");
  if (container === null) {
    throw new Error("#root element not found");
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
