/**
 * Le composeur — isolé du fil.
 *
 * ⚠️ **Taper ne redessine pas la conversation.** Le brouillon vit ici, et ici
 * seulement : l'écran parent ne reçoit le texte qu'à l'envoi. Avant, chaque
 * frappe repassait par l'écran entier (trente états), donc par le fil.
 *
 * ⚠️ **Arrêter reste visible tant que l'agent travaille** — champ vide ou non,
 * focus ou non. L'ancien composeur cachait le bouton dès qu'on tapait : on ne
 * pouvait plus arrêter un agent pendant qu'on lui écrivait la correction.
 *
 * ⚠️ Un brouillon par pane, en mémoire (`brouillons.ts`) : jamais écrit sur le
 * disque, jamais partagé entre deux agents.
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { ecrireBrouillon, lireBrouillon } from "../brouillons.ts";
import { Icone } from "../ui/Icone.tsx";

export interface PoigneeComposeur {
  readonly remettre: (texte: string) => void;
}

const HAUTEUR_LIGNE = 21;
const LIGNES_MAX = 6;

export const Composeur = memo(
  ({
    paneId,
    agentNom,
    travaille,
    arretEnCours,
    aide,
    onEnvoie,
    onArrete,
    ref,
  }: {
    readonly paneId: string;
    readonly agentNom: string;
    readonly travaille: boolean;
    readonly arretEnCours: boolean;
    readonly aide: string | null;
    readonly onEnvoie: (texte: string) => void;
    readonly onArrete: () => void;
    readonly ref?: Ref<PoigneeComposeur>;
  }) => {
    const [brouillon, setBrouillon] = useState(() => lireBrouillon(paneId));
    const champ = useRef<HTMLTextAreaElement | null>(null);
    const id = useId();

    const ajuste = useCallback(() => {
      const element = champ.current;
      if (element === null) return;
      element.style.height = "auto";
      const maximum = HAUTEUR_LIGNE * LIGNES_MAX + 24;
      element.style.height = `${String(Math.min(element.scrollHeight, maximum))}px`;
      element.style.overflowY = element.scrollHeight > maximum ? "auto" : "hidden";
    }, []);

    useEffect(ajuste, [ajuste, brouillon]);

    const change = useCallback(
      (texte: string) => {
        setBrouillon(texte);
        ecrireBrouillon(paneId, texte);
      },
      [paneId],
    );

    useImperativeHandle(
      ref,
      () => ({
        remettre: (texte: string) => {
          change(texte);
          champ.current?.focus();
        },
      }),
      [change],
    );

    const envoie = useCallback(() => {
      const texte = brouillon.trim();
      if (texte.length === 0) return;
      onEnvoie(texte);
      change("");
    }, [brouillon, change, onEnvoie]);

    const vide = brouillon.trim().length === 0;

    return (
      <form
        className="composeur"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          envoie();
        }}
      >
        <div className="composeur__champ">
          <label className="sr" htmlFor={id}>
            Message à {agentNom}
          </label>
          <textarea
            ref={champ}
            id={id}
            rows={1}
            value={brouillon}
            placeholder={`Message à ${agentNom}…`}
            enterKeyHint="send"
            onChange={(evenement) => change(evenement.target.value)}
            onKeyDown={(evenement) => {
              // Entrée seule fait un retour à la ligne (un téléphone n'a pas
              // d'autre touche pour ça) ; ⌘/Ctrl + Entrée envoie.
              if (evenement.key === "Enter" && (evenement.metaKey || evenement.ctrlKey)) {
                evenement.preventDefault();
                envoie();
              }
            }}
          />
          {travaille ? (
            <button
              type="button"
              className="rond rond--stop"
              aria-label="Arrêter l'agent"
              disabled={arretEnCours}
              onClick={onArrete}
            >
              <span className="carre" aria-hidden="true" />
            </button>
          ) : null}
          {!travaille || !vide ? (
            <button type="submit" className="rond rond--envoi" aria-label="Envoyer" disabled={vide}>
              <Icone nom="up" />
            </button>
          ) : null}
        </div>
        <div className="composeur__aide">
          <span>{aide}</span>
          <span className="mono">{paneId}</span>
        </div>
      </form>
    );
  },
);
Composeur.displayName = "Composeur";
