/**
 * L'application : la boîte de réception, la conversation ouverte, les feuilles.
 *
 * Téléphone : un écran à la fois. Large (≥ 900 px) : la liste à gauche, la
 * conversation à droite.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { AgentView } from "@herdr-remote/shared";
import { Lancement } from "../feuilles/Lancement.tsx";
import { Reglages } from "../feuilles/Reglages.tsx";
import { Boite } from "../inbox/Boite.tsx";
import { ecritLectures, litLectures, noteLecture, type Lectures } from "../lectures.ts";
import { dossierDe, premierNonVide } from "../libelles.ts";
import { purgeAnciennesPositions, stockageNavigateur } from "../memoire-defilement.ts";
import { lireGroupement, retenirGroupement, type Groupement } from "../preferences.ts";
import { retiens } from "../pane-ouvert.ts";
import { estAdresseDOnglet, HOME } from "../routing.ts";
import { useDonnees, useEtroit, useHauteurVisible, useRoute } from "./hooks.ts";
import { Notifications } from "../ui/Notifications.tsx";
import { PleinEcran } from "../ui/PleinEcran.tsx";
import { envois, magasin } from "./services.ts";

/**
 * La conversation est chargée **à la demande** : le fil, le Markdown et
 * l'analyse des sessions ne pèsent pas sur la première peinture de la liste,
 * qui est l'écran qu'on ouvre le plus souvent depuis une notification.
 */
const Conversation = lazy(async () => {
  const module = await import("../chat/Conversation.tsx");
  return { default: module.Conversation };
});

const ATTENTE_CONVERSATION = (
  <section className="conversation" aria-busy="true">
    <output className="fil__info conversation__attente">Ouverture de la conversation…</output>
  </section>
);

type FeuilleApp = { readonly genre: "lancement" } | { readonly genre: "reglages" } | null;

const paneDe = (donnees: unknown): string | undefined => {
  if (typeof donnees !== "object" || donnees === null) return undefined;
  const valeur: unknown = Reflect.get(donnees, "paneId");
  return typeof valeur === "string" ? valeur : undefined;
};

export const App = () => {
  useHauteurVisible();
  const donnees = useDonnees();
  const [route, navigue] = useRoute();
  const etroit = useEtroit();
  const [groupement, setGroupement] = useState<Groupement>(lireGroupement);
  const [lectures, setLectures] = useState<Lectures>(() => litLectures(stockageNavigateur()));
  const [feuille, setFeuille] = useState<FeuilleApp>(null);
  /**
   * Le dernier état connu de chaque pane ouvert — pour les **libellés**
   * seulement (titre, projet, agent). ⚠️ Jamais pour l'état : un pane fermé
   * restait « Travaille » avec Arrêter actif (`pane-ouvert.ts`). Bornée.
   */
  const [memoire, setMemoire] = useState<ReadonlyMap<string, AgentView>>(new Map());

  useEffect(() => {
    // Une ancienne adresse d'onglet (#/reglages…) retombe sur la liste.
    if (estAdresseDOnglet(window.location.hash)) window.location.replace(HOME);
    // L'ancienne mémoire de défilement (ratios gardés pour toujours) part.
    purgeAnciennesPositions(globalThis.localStorage);
    magasin.demarre();
    // ⚠️ La remise d'un envoi est prouvée par l'ÉVÉNEMENT `prompt` du démon,
    // pas par l'absence d'erreur — pour le pane qu'il nomme, et lui seul.
    const arrete = magasin.ecoute((evenement) => {
      if (evenement.genre !== "prompt") return;
      const pane = paneDe(evenement.donnees);
      if (pane !== undefined) envois.resoutParEvenement(pane);
    });
    return () => {
      arrete();
      magasin.arrete();
    };
  }, []);

  useEffect(() => {
    const surVisibilite = () => {
      if (document.visibilityState === "visible") void magasin.rafraichit();
    };
    document.addEventListener("visibilitychange", surVisibilite);
    return () => document.removeEventListener("visibilitychange", surVisibilite);
  }, []);

  const agents = useMemo(() => donnees.overview?.agents ?? [], [donnees.overview]);
  const paneOuvert = route.kind === "agent" ? route.paneId : null;
  const agentLu =
    paneOuvert === null ? undefined : agents.find((agent) => agent.paneId === paneOuvert);

  useEffect(() => {
    if (agentLu === undefined) return;
    setMemoire((precedente) => retiens(precedente, agentLu.paneId, agentLu));
  }, [agentLu]);

  const changeGroupement = useCallback((suivant: Groupement) => {
    retenirGroupement(suivant);
    setGroupement(suivant);
  }, []);

  const noteVue = useCallback((paneId: string, instant: number) => {
    setLectures((precedentes) => {
      const suivantes = noteLecture(precedentes, paneId, instant);
      if (suivantes !== precedentes) ecritLectures(stockageNavigateur(), suivantes);
      return suivantes;
    });
  }, []);

  const retour = useCallback(() => navigue({ kind: "liste" }), [navigue]);

  // Les libellés et les voisins lisent le vivant, sinon le souvenir ; l'état et
  // les gestes de la conversation ne lisent que le vivant (`agentLu`).
  const souvenir = paneOuvert === null ? undefined : memoire.get(paneOuvert);
  const agent = agentLu ?? souvenir ?? null;
  const conversation =
    paneOuvert === null
      ? null
      : (donnees.conversations?.find((ligne) => ligne.paneId === paneOuvert) ?? null);
  const espace = donnees.overview?.workspaces.find(
    (candidat) => candidat.workspaceId === (agent?.workspaceId ?? conversation?.workspaceId),
  );
  const projet = premierNonVide(
    espace?.label,
    dossierDe(espace?.checkoutPath),
    agent?.workspaceLabel,
    dossierDe(agent?.cwd),
    agent?.workspaceId ?? conversation?.workspaceId,
  );
  /*
    Les panes du même onglet, **dans l'ordre de la disposition** (`paneRank`)
    — celui où ils apparaissent sur le Mac, comme dans l'ancienne app. L'ordre
    de l'overview n'est pas une disposition.
  */
  const voisins = useMemo(
    () =>
      agent === null
        ? []
        : agents
            .filter((candidat) => candidat.tabId === agent.tabId)
            .toSorted(
              (a, b) =>
                (a.paneRank ?? Number.MAX_SAFE_INTEGER) - (b.paneRank ?? Number.MAX_SAFE_INTEGER) ||
                a.paneId.localeCompare(b.paneId),
            ),
    [agent, agents],
  );

  return (
    <div className="app" data-vue={route.kind === "agent" ? "agent" : "liste"}>
      <div className="barre-etat" aria-hidden="true" />
      <Notifications />
      <PleinEcran />
      <Boite
        donnees={donnees}
        lectures={lectures}
        groupement={groupement}
        onGroupement={changeGroupement}
        onLancer={() => setFeuille({ genre: "lancement" })}
        onReglages={() => setFeuille({ genre: "reglages" })}
        onReessayer={() => void magasin.rafraichit()}
        paneCourant={paneOuvert}
        cachee={etroit && paneOuvert !== null}
      />
      {paneOuvert === null ? (
        <div className="vide-large">
          <p>Choisissez une conversation, ou lancez un agent avec +.</p>
        </div>
      ) : (
        <Suspense fallback={ATTENTE_CONVERSATION}>
          <Conversation
            key={paneOuvert}
            paneId={paneOuvert}
            agent={agentLu ?? null}
            souvenir={souvenir}
            overviewLu={donnees.overview !== null}
            vuAvant={souvenir !== undefined}
            conversation={conversation}
            projet={projet}
            voisins={voisins}
            debutObserve={donnees.debutsTravail.get(paneOuvert)}
            lueA={donnees.dernierSucces}
            onRetour={retour}
            onVue={noteVue}
          />
        </Suspense>
      )}
      {feuille?.genre === "lancement" ? (
        <Lancement
          espaces={donnees.overview?.workspaces ?? []}
          kinds={donnees.kinds}
          erreurKinds={donnees.erreurKinds}
          espaceInitial={route.kind === "projet" ? route.workspaceId : (agent?.workspaceId ?? null)}
          onClose={() => setFeuille(null)}
          onLance={(paneId) => {
            setFeuille(null);
            navigue({ kind: "agent", paneId });
          }}
        />
      ) : null}
      {feuille?.genre === "reglages" ? (
        <Reglages
          health={donnees.health}
          erreurHealth={donnees.erreurs.health}
          overview={donnees.overview}
          groupement={groupement}
          onGroupement={changeGroupement}
          onClose={() => setFeuille(null)}
        />
      ) : null}
    </div>
  );
};
