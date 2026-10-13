import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import "./styles.css";

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
