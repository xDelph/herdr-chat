/**
 * Rendre un calque (feuille, plein écran) **sous `<body>`**, hors de la boîte
 * de l'application.
 *
 * ⚠️ **Pourquoi.** `#root` est fixe et rogné (`position: fixed; overflow:
 * hidden`, voir base.css) pour suivre le viewport visuel d'iOS. Un `<dialog>`
 * ouvert en modal passe dans la couche du dessus et devrait s'en affranchir ;
 * Safari iOS dessinait pourtant le voile SANS le contenu de la feuille (retour
 * du 2026-10-29 : « un léger calque noir, rien d'autre »). Sous `<body>`, plus
 * aucun ancêtre fixe ni rogné. Les événements et contextes React traversent le
 * portail comme avant.
 *
 * Hors navigateur (rendu serveur des tests), rendu sur place.
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export const SousLeCorps = ({ children }: { readonly children: ReactNode }) =>
  typeof document === "undefined" ? children : createPortal(children, document.body);
