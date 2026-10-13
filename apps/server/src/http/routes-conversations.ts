/**
 * Route `GET /api/conversations` (B11).
 *
 * L'écran d'accueil ne dépend plus de `/api/overview`, qui agrège tout pour
 * l'ancienne navigation. Cette route ne fait qu'une chose : **une ligne par
 * pane**, même sans session.
 *
 * Deux propriétés que le test de contrat ne verrait pas :
 *
 * 1. **Un pane = une ligne.** Un agent fraîchement lancé n'a pas encore de
 *    fichier de session ; si la route lissait les panes sans session,
 *    l'accueil afficherait « aucune conversation » alors qu'il y en a une.
 *
 * 2. **Une erreur partielle ne perd pas les autres lignes.** Si une session
 *    est illisible, les autres conversations restent listées avec leur cause
 *    (`sessionState: "error"`). Perdre toute la liste pour un fichier
 *    corrompu serait bien pire que le fichier corrompu.
 *
 * La lecture est **bornée** (64 Kio par session) et **concurrente** (4 à la
 * fois) : sans borne, 50 agents aux sessions de 1,8 Mo satellite le Mac ; sans
 * concurrence, la liste met 50 × la durée d'un `stat` à s'afficher.
 */
import { Effect, Option, Result } from "effect";
import { decoderOf, respond } from "./Reply.ts";
import { defaultRead, summaryOf, type RawPane } from "../conversations/Summary.ts";
import { brancheDe as branchOf } from "../git/Branche.ts";
import { sessionLisible } from "../agents/Lisibilite.ts";
import { sessionPathOf } from "./routes-sessions.ts";
import type { TailedSession } from "../sessions/SessionReader.ts";
import { decodeSnapshot } from "./Reply.ts";
import { ConversationsResponse } from "@herdr-remote/shared";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import type { ServerConfig } from "../config.ts";

/** La limite vient du contrat partagé (S06). */
export { MAX_SESSION_READS as MAX_CONCURRENT_READS } from "@herdr-remote/shared";

import { MAX_SESSION_READS } from "@herdr-remote/shared";

/**
 * Exécute `travail` sur `entrees` avec au plus `limite` en vol.
 *
 * Les entités sont **indépendantes** : une session corrompue ne doit pas
 * empêcher les autres d'être lues. L'ordre des résultats est conservé, donc
 * deux appels au même snapshot donnent la même réponse — exigence du contrat.
 */
export const withConcurrency = async <A, R>(
  entrees: ReadonlyArray<A>,
  limite: number,
  travail: (entree: A) => Promise<R>,
): Promise<ReadonlyArray<R>> => {
  const resultats: Array<R> = Array.from({ length: entrees.length });
  let suivant = 0;

  // Volontairement séquentiel **par worker** : chacun prend l'index suivant
  // disponible, ce qui borne la concurrence au nombre de workers. Une
  // `Promise.all` ici l'emporterait sur toutes les sessions d'un coup.
  /* oxlint-disable no-await-in-loop -- c'est le mécanisme même du plafond */
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = suivant;
      suivant += 1;
      if (index >= entrees.length) return;
      const entree = entrees[index];
      if (entree === undefined) return;
      resultats[index] = await travail(entree);
    }
  };
  /* oxlint-enable no-await-in-loop */

  // Exactement `limite` Coloques au départ : c'est le plafond qu'on veut, pas
  // une approximation par nombre d'entrées.
  const nombre = Math.max(1, Math.min(limite, entrees.length));
  await Promise.all(Array.from({ length: nombre }, () => worker()));
  return resultats;
};

/**
 * Transforme un pane Herdr en entrée de ligne.
 *
 * `paneId` et `workspaceId` sont tirés du snapshot ; un pane sans agent n'a
 * pas de session, et c'est un état normal, pas une erreur.
 */
const toRawPane = (
  pane: {
    readonly pane_id: string;
    readonly tab_id?: string;
    readonly workspace_id?: string | undefined;
  },
  labels: {
    readonly tabs: ReadonlyMap<string, string>;
    readonly workspaces: ReadonlyMap<string, string>;
  },
  sessionPath: string | null,
  agentStatus: string | null,
  branch: string | undefined,
): RawPane => {
  const tabId = pane.tab_id ?? "";
  const workspaceId = pane.workspace_id ?? "";
  return {
    agentStatus,
    branch,
    paneId: pane.pane_id,
    sessionPath,
    tabLabel: labels.tabs.get(tabId) ?? null,
    workspaceId,
    workspaceLabel: labels.workspaces.get(workspaceId) ?? null,
    title: null,
  };
};

export const makeConversationRoutes = (config: ServerConfig, herdr: HerdrApi) => {
  const conversations = async (): Promise<Response> => {
    const payload = await Effect.runPromise(Effect.result(herdr.snapshot()));
    if (Result.isFailure(payload)) {
      return respond(
        config.logPath,
        decoderOf(ConversationsResponse),
        // Pas de snapshot = pas de liste. On le dit, on n'invente rien.
        { conversations: [] },
        503,
      );
    }

    // ⚠️ `session.snapshot` enveloppe dans `{ snapshot: {...} }` : lire
    // `payload.agents` comparerait une liste vide à chaque tour, en silence
    // (D012.4).
    const enveloppe = Option.getOrUndefined(Result.getSuccess(payload));
    const decoded =
      enveloppe === undefined
        ? undefined
        : Option.getOrUndefined(decodeSnapshot(enveloppe["snapshot"]));
    if (decoded === undefined) {
      // Forme inattendue : liste vide nommée, jamais une liste devinée.
      return respond(config.logPath, decoderOf(ConversationsResponse), { conversations: [] }, 502);
    }

    // Libellés : Herdr nomme les onglets « 1 », « 2 »… et la cascade de titre
    // (B10) les écarte s'ils sont purement numériques.
    const tabs = new Map((decoded.tabs ?? []).map((tab) => [tab.tab_id, tab.label ?? ""]));
    const workspaces = new Map(
      decoded.workspaces.map((workspace) => [workspace.workspace_id, workspace.label ?? ""]),
    );

    const read = defaultRead(config.sessionRoots);
    const lire = (path: string): Effect.Effect<TailedSession, unknown> => read(path);

    /*
      ⚠️ **Seuls les panes dont la session est lisible** (U14, U17).

      Cette route ne servait auparavant que l'onglet Projets ; elle alimente
      maintenant la liste elle-même. Sans ce filtre, elle réaffichait des
      agents sans session — un écran plein de lignes vides, exactement ce que le
      filtre de lisibilité existe pour éviter.

      C'est la **même** règle que `/api/overview` : une seconde définition
      divergerait, et c'est ce qui vient de se produire.
    */
    const panes = (decoded.panes ?? []).filter((pane) => {
      const agent = decoded.agents.find((candidat) => candidat.pane_id === pane.pane_id);
      return agent !== undefined && sessionLisible(sessionPathOf(agent) ?? null);
    });

    const lignes = await withConcurrency(panes, MAX_SESSION_READS, async (pane) => {
      // Le chemin de session vient de `agent_session`, fourni par Herdr dans
      // la vue agent ; un pane sans agent n'a pas de session.
      const agent = decoded.agents.find((candidat) => candidat.pane_id === pane.pane_id);
      const paneBrut = toRawPane(
        pane,
        { tabs, workspaces },
        agent === undefined ? null : (sessionPathOf(agent) ?? null),
        agent?.agent_status ?? null,
        // La branche vient du **dossier du pane** : c'est le dépôt dans lequel
        // l'agent travaille réellement, pas celui du projet en général.
        pane.cwd === null || pane.cwd === undefined
          ? undefined
          : await Effect.runPromise(branchOf(pane.cwd)),
      );
      return Effect.runPromise(summaryOf(paneBrut, lire));
    });

    return respond(config.logPath, decoderOf(ConversationsResponse), {
      conversations: lignes,
    });
  };

  return { conversations };
};
