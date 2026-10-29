/**
 * Le fil d'une conversation : défilement, historique, envois, travail en cours.
 *
 * Règles de défilement (`defilement.ts`, testées) :
 *
 * - à l'ouverture, la position mémorisée pour ce pane, sinon le bas — ou la
 *   dernière demande si la réponse n'a pas encore été vue (`done`) ;
 * - on suit le bas tant qu'on y est ; on ne tire jamais quelqu'un de sa
 *   lecture : du neuf pendant qu'on lit plus haut affiche « Nouveaux messages » ;
 * - l'historique se charge en approchant du haut, et la vue ne saute pas
 *   (`positionApresPrepend`) ;
 * - quand l'agent finit pendant qu'on suit le bas, la vue se pose sur la
 *   demande, pour lire la réponse avec sa question.
 *
 * ⚠️ **Défiler ne touche pas au Mac.** L'ancien fil posait le focus Herdr
 * (`POST /focus`) après un défilement : lire volait le clavier du bureau.
 *
 * ⚠️ **Fils longs.** Chaque élément porte `content-visibility: auto` : le
 * navigateur ne met en page que ce qui est à l'écran, et la mémoïsation par
 * élément fait qu'un delta ne redessine que le tour qui bouge.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentStatus } from "@herdr-remote/shared";
import type { Item } from "../blocks.ts";
import {
  ancrage,
  positionApresPrepend,
  SEUIL_PREMIERES_LIGNES_PX,
  suitLeBas,
} from "../defilement.ts";
import type { SuiviSession, VueSession } from "../flux-session.ts";
import {
  ecritPosition,
  hauteurDeReprise,
  litPosition,
  positionAffichee,
  stockageNavigateur,
} from "../memoire-defilement.ts";
import { Avis } from "../ui/atomes.tsx";
import { Icone } from "../ui/Icone.tsx";
import { ElementFil } from "./Elements.tsx";

const cleDe = (item: Item): string => (item.kind === "tools" ? item.id : `m:${item.message.id}`);

const debutDuJour = (): number => {
  const maintenant = new Date();
  return new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate()).getTime();
};

/** Pose la dernière demande en haut de la vue. */
const versDerniereDemande = (conteneur: HTMLElement): void => {
  const demandes = conteneur.querySelectorAll("[data-demande]");
  const derniere = demandes[demandes.length - 1];
  if (derniere === undefined) {
    conteneur.scrollTop = conteneur.scrollHeight;
    return;
  }
  const ecart = derniere.getBoundingClientRect().top - conteneur.getBoundingClientRect().top;
  conteneur.scrollTop += ecart - 36;
};

export const Fil = memo(
  ({
    paneId,
    items,
    vue,
    suivi,
    status,
    cwd,
    aUneSession,
    envoisEnAttente,
    onOuvrirFichier,
    children,
  }: {
    readonly paneId: string;
    readonly items: ReadonlyArray<Item>;
    readonly vue: VueSession;
    readonly suivi: SuiviSession | null;
    readonly status: AgentStatus;
    readonly cwd: string | null;
    readonly aUneSession: boolean;
    readonly envoisEnAttente: number;
    readonly onOuvrirFichier: (chemin: string) => void;
    /** Envois en attente et ligne de travail — toujours en bas du fil. */
    readonly children: ReactNode;
  }) => {
    const conteneur = useRef<HTMLDivElement | null>(null);
    const contenu = useRef<HTMLDivElement | null>(null);
    const sentinelle = useRef<HTMLSpanElement | null>(null);
    const suitBas = useRef(true);
    const poseFaite = useRef(false);
    const statutVu = useRef<AgentStatus | null>(null);
    const mesurePrepend = useRef<{ readonly hauteur: number; readonly scroll: number } | null>(
      null,
    );
    const enregistrement = useRef<number | undefined>(undefined);
    const [nouveaux, setNouveaux] = useState(false);
    const jour = debutDuJour();
    const dernier = items.at(-1);

    // 1. La première pose, une fois le contenu là.
    useLayoutEffect(() => {
      const element = conteneur.current;
      if (poseFaite.current || element === null || items.length === 0) return;
      poseFaite.current = true;
      statutVu.current = status;
      const memoire = litPosition(stockageNavigateur(), paneId);
      if (memoire !== null) {
        element.scrollTop = hauteurDeReprise(memoire, element);
        suitBas.current = memoire.bas;
        return;
      }
      if (status === "done") {
        versDerniereDemande(element);
        suitBas.current = suitLeBas(element);
        return;
      }
      element.scrollTop = element.scrollHeight;
      suitBas.current = true;
    }, [items.length, paneId, status]);

    // 2. Suivre le bas quand le contenu OU le conteneur change de taille
    //    (composeur qui grandit, clavier iOS qui monte).
    useEffect(() => {
      const element = conteneur.current;
      const interieur = contenu.current;
      if (element === null || interieur === null) return undefined;
      const observateur = new ResizeObserver(() => {
        if (poseFaite.current && suitBas.current) element.scrollTop = element.scrollHeight;
      });
      observateur.observe(interieur);
      observateur.observe(element);
      return () => observateur.disconnect();
    }, []);

    // 3. Du neuf pendant qu'on lit plus haut : on le signale, on ne bouge pas.
    useEffect(() => {
      if (poseFaite.current && !suitBas.current) setNouveaux(true);
    }, [dernier]);

    // 4. L'agent change d'état pendant qu'on suit le bas.
    useEffect(() => {
      const element = conteneur.current;
      if (!poseFaite.current || element === null) return;
      const avant = statutVu.current;
      statutVu.current = status;
      if (avant === status) return;
      const ou = ancrage({ apres: status, avant, suivaitLeBas: suitBas.current });
      if (ou === "bas") element.scrollTop = element.scrollHeight;
      if (ou === "demande") {
        versDerniereDemande(element);
        suitBas.current = suitLeBas(element);
      }
    }, [status]);

    // 5. L'historique ajouté en haut ne fait pas sauter la lecture.
    useLayoutEffect(() => {
      const element = conteneur.current;
      const mesure = mesurePrepend.current;
      if (element === null || mesure === null) return;
      mesurePrepend.current = null;
      element.scrollTop = positionApresPrepend({
        hauteurApres: element.scrollHeight,
        hauteurAvant: mesure.hauteur,
        scrollAvant: mesure.scroll,
      });
    }, [vue.ajoutsEnHaut]);
    useEffect(() => {
      if (!vue.chargementAncien) mesurePrepend.current = null;
    }, [vue.chargementAncien]);

    const chargeAncien = useCallback(() => {
      const element = conteneur.current;
      if (suivi === null || element === null) return;
      if (vue.precedent === null || vue.chargementAncien) return;
      mesurePrepend.current = { hauteur: element.scrollHeight, scroll: element.scrollTop };
      void suivi.chargePlusAncien();
    }, [suivi, vue.chargementAncien, vue.precedent]);

    // 6. Le repère du haut déclenche l'historique.
    useEffect(() => {
      const element = conteneur.current;
      const repere = sentinelle.current;
      if (element === null || repere === null || vue.precedent === null) return undefined;
      const observateur = new IntersectionObserver(
        (entrees) => {
          if (poseFaite.current && entrees.some((entree) => entree.isIntersecting)) chargeAncien();
        },
        { root: element, rootMargin: `${String(SEUIL_PREMIERES_LIGNES_PX)}px 0px 0px 0px` },
      );
      observateur.observe(repere);
      return () => observateur.disconnect();
    }, [chargeAncien, vue.precedent]);

    useEffect(
      () => () => {
        if (enregistrement.current !== undefined) window.clearTimeout(enregistrement.current);
      },
      [],
    );

    const surDefilement = useCallback(() => {
      const element = conteneur.current;
      if (element === null || !poseFaite.current) return;
      suitBas.current = suitLeBas(element);
      if (suitBas.current) setNouveaux(false);
      const position = positionAffichee({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        seuilBas: 48,
      });
      if (enregistrement.current !== undefined) window.clearTimeout(enregistrement.current);
      enregistrement.current = window.setTimeout(() => {
        enregistrement.current = undefined;
        ecritPosition(stockageNavigateur(), paneId, position);
      }, 400);
    }, [paneId]);

    const versLeBas = useCallback(() => {
      const element = conteneur.current;
      if (element === null) return;
      element.scrollTop = element.scrollHeight;
      suitBas.current = true;
      setNouveaux(false);
    }, []);

    return (
      <div className="fil-cadre">
        <div
          className="fil"
          ref={conteneur}
          onScroll={surDefilement}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          <div className="fil__contenu" ref={contenu}>
            <span className="fil__sentinelle" ref={sentinelle} aria-hidden="true" />
            {vue.chargementAncien ? (
              <output className="fil__info">Chargement de l'historique…</output>
            ) : vue.precedent === null && items.length > 0 ? (
              <p className="fil__info">Début de la conversation</p>
            ) : null}
            {vue.erreurAncien === null ? null : (
              <p className="fil__info fil__info--erreur" role="alert">
                Historique illisible : {vue.erreurAncien}{" "}
                <button type="button" className="lien" onClick={chargeAncien}>
                  Réessayer
                </button>
              </p>
            )}
            {items.length > 0 ? null : vue.phase === "chargement" ? (
              <output className="fil__info">Lecture de la conversation…</output>
            ) : vue.phase === "erreur" ? (
              <Avis ton="erreur" annonce="alerte">
                Conversation illisible : {vue.erreur}
              </Avis>
            ) : envoisEnAttente === 0 ? (
              <div className="fil__vide">
                <strong>Aucun message</strong>
                <p className="discret">
                  {aUneSession
                    ? "La session est vide pour l'instant."
                    : "Herdr n'expose pas encore de session pour cet agent : certains agents ne l'annoncent qu'après leur premier message."}
                </p>
              </div>
            ) : null}
            {items.map((item) => (
              <ElementFil
                key={cleDe(item)}
                item={item}
                enCours={status === "working" && item === dernier}
                cwd={cwd}
                maintenant={jour}
                onOuvrirFichier={onOuvrirFichier}
              />
            ))}
            {children}
          </div>
        </div>
        {nouveaux ? (
          <button type="button" className="fil__nouveaux" onClick={versLeBas}>
            Nouveaux messages
            <Icone nom="down" petite />
          </button>
        ) : null}
      </div>
    );
  },
);
Fil.displayName = "Fil";
