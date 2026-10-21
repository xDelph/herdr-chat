import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell as App } from "./v2/AppShell.tsx";
import {
  appliquerStyleMarque,
  appliquerTheme,
  lireStyleMarque,
  lireTheme,
  rafraichirCouleurDeBarre,
} from "./preferences.ts";
import "./styles.css";

appliquerTheme(lireTheme());
appliquerStyleMarque(lireStyleMarque());
window.addEventListener("load", rafraichirCouleurDeBarre, { once: true });

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root element not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
