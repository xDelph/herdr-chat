/**
 * Ce que le lecteur d'écran annonce d'une conversation — **une phrase par
 * événement**, pas chaque jeton.
 *
 * ⚠️ **Le défaut (P2).** Tout le fil était une région `aria-live="polite"` :
 * pendant qu'un agent écrivait, VoiceOver relisait chaque morceau de réponse
 * en continu, et l'écran devenait inutilisable au lecteur d'écran. Le fil
 * garde `role="log"` (on le parcourt) mais se tait ; cette région-ci, présente
 * **dès le montage** (une région insérée avec son texte n'est pas annoncée),
 * dit les changements d'état et la réponse terminée.
 */
import { memo, useEffect, useRef, useState } from "react";
import type { AgentStatus } from "@herdr-remote/shared";
import type { Item } from "../blocks.ts";
import { apercuTexte } from "../libelles.ts";

/** Le texte de la dernière réponse de l'agent, abrégé pour être écouté. */
const derniereReponse = (items: ReadonlyArray<Item>): string | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined || item.kind === "tools") continue;
    if (item.message.role === "user") return null;
    const texte = apercuTexte(item.message.text);
    if (texte.length > 0) return texte.length > 240 ? `${texte.slice(0, 240)}…` : texte;
  }
  return null;
};

/** La phrase à annoncer pour un changement d'état, ou `null`. */
export const annonceDeStatut = (
  avant: AgentStatus | null,
  apres: AgentStatus,
  items: ReadonlyArray<Item>,
): string | null => {
  if (avant === null || avant === apres) return null;
  switch (apres) {
    case "working":
      return "The agent is working.";
    case "blocked":
      return "The agent needs a decision.";
    case "done":
    case "idle": {
      if (avant !== "working") return null;
      const reponse = derniereReponse(items);
      return reponse === null ? "Response finished." : `Response finished: ${reponse}`;
    }
    default:
      return null;
  }
};

export const Annonces = memo(
  ({ status, items }: { readonly status: AgentStatus; readonly items: ReadonlyArray<Item> }) => {
    const [texte, setTexte] = useState("");
    const vu = useRef<AgentStatus | null>(null);
    const itemsVus = useRef(items);
    useEffect(() => {
      itemsVus.current = items;
    });
    useEffect(() => {
      const avant = vu.current;
      vu.current = status;
      const phrase = annonceDeStatut(avant, status, itemsVus.current);
      if (phrase !== null) setTexte(phrase);
    }, [status]);
    return (
      <output className="sr" aria-live="polite" aria-atomic="true">
        {texte}
      </output>
    );
  },
);
Annonces.displayName = "Annonces";
