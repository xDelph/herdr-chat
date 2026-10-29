/**
 * Les pictogrammes — au trait, dans la couleur du texte.
 *
 * ⚠️ Plus de glyphes texte (`‹`, `■`, `🖥`) : leur rendu changeait d'une police
 * à l'autre, et un émoji en couleur criait plus fort que la réponse de l'agent.
 * Toujours décoratifs (`aria-hidden`) : le bouton qui les porte a son libellé.
 */
import { memo, type ReactNode } from "react";
import type { IconeAction } from "../actions.ts";

export type NomIcone =
  | IconeAction
  | "search"
  | "plus"
  | "gear"
  | "back"
  | "chev"
  | "more"
  | "up"
  | "down"
  | "check"
  | "folder"
  | "x"
  | "mac"
  | "sliders";

const TRACES: Record<NomIcone, ReactNode> = {
  back: <path d="m15 18-6-6 6-6" />,
  brain: (
    <>
      <path d="M12 5a3 3 0 1 0-5.9.8A3 3 0 0 0 4 11a3 3 0 0 0 2 5.6A3 3 0 0 0 12 18z" />
      <path d="M12 5a3 3 0 1 1 5.9.8A3 3 0 0 1 20 11a3 3 0 0 1-2 5.6A3 3 0 0 1 12 18" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  chev: <path d="m9 18 6-6-6-6" />,
  delete: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="2" />,
  down: <path d="M12 5v14M5 12l7 7 7-7" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </>
  ),
  find: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5M8 11h6" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  mac: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  result: <path d="M5 7h14M5 12h14M5 17h9" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  sliders: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" />,
  term: <path d="m4 17 6-5-6-5M12 19h8" />,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
};

export const Icone = memo(
  ({ nom, petite = false }: { readonly nom: NomIcone; readonly petite?: boolean }) => (
    <svg className={petite ? "i s" : "i"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {TRACES[nom]}
    </svg>
  ),
);
Icone.displayName = "Icone";
