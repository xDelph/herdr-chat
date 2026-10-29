/**
 * Les atomes : la marque d'un agent, la forme d'un état, la pastille, l'avis.
 *
 * ⚠️ **Forme ET couleur, toujours ensemble.** Losange orange = à toi ; spirale
 * bleue = travaille ; coche verte = terminé ; anneau = au repos ; tirets =
 * inconnu. La forme seule suffit à qui ne distingue pas les couleurs, et le mot
 * accompagne chaque forme pour un lecteur d'écran.
 */
import { memo, type ReactNode } from "react";
import type { AgentStatus } from "@herdr-remote/shared";
import { LIBELLE_STATUT, marqueAgent } from "../libelles.ts";
import { LOGOS } from "../logos.tsx";
import { Icone } from "./Icone.tsx";

/**
 * La marque d'un agent : son **vrai logo** (`logos.tsx`, provenance documentée),
 * sur une tuile sombre dans les deux thèmes — trois marques publient une
 * variante blanche pour fond sombre, qui disparaîtrait sur le thème clair. Un
 * agent sans logo connu garde ses lettres.
 *
 * ⚠️ Régression corrigée : la réécriture avait remplacé les logos (rétablis le
 * 2026-10-16, e37235c) par des carrés à lettres.
 */
export const Marque = memo(
  ({ kind, petite = false }: { readonly kind: string | null; readonly petite?: boolean }) => {
    const marque = marqueAgent(kind);
    const logo = kind === null ? undefined : LOGOS[kind];
    return (
      <span
        className={`marque marque--${marque.famille}${logo === undefined ? "" : " marque--logo"}${
          petite ? " marque--petite" : ""
        }`}
        title={marque.nom}
        aria-hidden="true"
      >
        {logo === undefined ? (
          marque.lettres
        ) : (
          <svg viewBox="0 0 24 24" focusable="false">
            {logo}
          </svg>
        )}
      </span>
    );
  },
);
Marque.displayName = "Marque";

const TON: Record<AgentStatus, string> = {
  blocked: "attn",
  done: "ok",
  idle: "idle",
  unknown: "unknown",
  working: "work",
};

/** La forme seule, sans mot. */
export const FormeEtat = ({ status }: { readonly status: AgentStatus }) => {
  switch (status) {
    case "working":
      return <span className="spin" aria-hidden="true" />;
    case "blocked":
      return <span className="losange" aria-hidden="true" />;
    case "done":
      return <Icone nom="check" petite />;
    case "idle":
      return <span className="anneau" aria-hidden="true" />;
    default:
      return <span className="tirets" aria-hidden="true" />;
  }
};

/** Forme + mot (ou un autre texte, comme un chronomètre). */
export const Etat = memo(
  ({ status, children }: { readonly status: AgentStatus; readonly children?: ReactNode }) => (
    <span className={`etat etat--${TON[status]}`}>
      <FormeEtat status={status} />
      {children ?? LIBELLE_STATUT[status]}
    </span>
  ),
);
Etat.displayName = "Etat";

export const Pastille = memo(({ status }: { readonly status: AgentStatus }) => (
  <span className={`pastille pastille--${TON[status]}`}>
    <FormeEtat status={status} />
    {LIBELLE_STATUT[status]}
  </span>
));
Pastille.displayName = "Pastille";

export type TonAvis = "neutre" | "erreur" | "attention" | "ok";

/**
 * Un avis. `annonce` le fait lire par un lecteur d'écran : `statut` (poli,
 * `<output>`) ou `alerte` (immédiat, `role="alert"`).
 */
export const Avis = ({
  ton = "neutre",
  children,
  annonce,
}: {
  readonly ton?: TonAvis;
  readonly children: ReactNode;
  readonly annonce?: "alerte" | "statut";
}) => {
  const classe = ton === "neutre" ? "avis" : `avis avis--${ton}`;
  if (annonce === "statut") return <output className={classe}>{children}</output>;
  return (
    <div className={classe} role={annonce === "alerte" ? "alert" : undefined}>
      {children}
    </div>
  );
};
