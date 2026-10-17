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
 * La lecture est **par tranches de 64 Kio** et **concurrente** (4 à la fois).
 * Le premier passage remonte jusqu'au dernier prompt utilisateur, puis le cache
 * ne lit que les lignes ajoutées. Il ne charge jamais un gros JSONL entier.
 */
import { Effect, Option, Result } from "effect";
import { decoderOf, respond } from "./Reply.ts";
import { defaultRead, summaryOf, type RawPane } from "../conversations/Summary.ts";
import {
  estVisible,
  namingFrom,
  usefulLabel,
  type NamingContext,
} from "../agents/AgentRegistry.ts";
import type { TailedSession } from "../sessions/SessionReader.ts";
import { moteurOpencode } from "../sessions/OpencodeReader.ts";
import { moteurDevin } from "../sessions/DevinReader.ts";
import type { SourceSession } from "../agents/SessionLocator.ts";
import { isTrustPrompt } from "../agents/TrustPrompt.ts";
import { questionDeLEcran } from "@herdr-remote/shared";
import { brancheDe as branchOf } from "../git/Branche.ts";
import { sessionSourceOf } from "./routes-sessions.ts";
import { decodeSnapshot } from "./Reply.ts";
import { ConversationsResponse } from "@herdr-remote/shared";
import type { AgentStatus } from "@herdr-remote/shared";
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
  /*
    ⚠️ Le **contexte de nommage complet**, et pas deux tables rebaties ici : c'est
    lui qui porte le rang du pane dans son tab. Deux constructions du meme
    nommage auraient fini par ne plus dire la meme chose.
  */
  naming: NamingContext,
  sessionPath: string | null,
  /*
    ⚠️ Le **type** (`agent`) et l'état (`agent_status`) viennent du meme objet :
    les passer en deux arguments laissait croire qu'ils peuvent venir de deux
    sources, et un appelant pouvait fournir l'un sans l'autre.
  */
  agent:
    | {
        readonly agent?: string | null | undefined;
        readonly agent_status: string | null;
        readonly name?: string | null | undefined;
      }
    | undefined,
  branch: string | undefined,
): RawPane => {
  const tabId = pane.tab_id ?? "";
  const workspaceId = pane.workspace_id ?? "";
  const rang = naming.panes.get(pane.pane_id);
  return {
    agent: agent?.agent ?? null,
    agentStatus: agent?.agent_status ?? null,
    branch,
    // Meme ecart des libelles numeriques que l'accueil : une seule regle.
    name: agent?.name ?? null,
    paneId: pane.pane_id,
    paneRank: rang?.rank ?? null,
    sessionPath,
    tabId,
    tabLabel: usefulLabel(naming.tabs.get(tabId)?.label ?? null),
    tabPaneCount: rang?.tabPaneCount ?? 1,
    workspaceId,
    workspaceLabel: naming.workspaces.get(workspaceId) ?? null,
    title: null,
  };
};

/**
 * Faut-il lire l'écran de cette conversation ?
 *
 * ⚠️ **La règle a changé, et une mesure l'a imposée.** Elle était
 * `status === "blocked"`. Or Herdr peut déclarer **`idle`** un agent qui attend
 * une décision : mesuré sur un onglet à cinq panes, codex affichait « Hooks need
 * review » pendant que son statut était `idle`. Son écran n'était donc jamais lu,
 * aucune carte n'apparaissait, et le pane était **inutilisable depuis le
 * téléphone** — alors que l'analyseur aurait lu ses trois choix très bien.
 *
 * La règle est donc : on lit l'écran d'un agent **qui n'a rien à montrer** (ni
 * aperçu, ni dernière demande) ou qui est bloqué. C'est exactement l'agent neuf
 * qui attend une décision — et sur une installation où tous les agents ont déjà
 * parlé, cela ne coûte **aucune lecture supplémentaire**.
 *
 * ⚠️ Jamais pour un agent **au travail** : il ne peut pas attendre une réponse en
 * même temps, et lire son écran à chaque rafraîchissement serait une dépense sans
 * contrepartie.
 */
export const fautLireLEcran = (ligne: {
  readonly status: AgentStatus;
  readonly preview?: string | undefined;
  readonly lastPrompt?: string | undefined;
}): boolean =>
  ligne.status !== "working" &&
  (ligne.status === "blocked" || (ligne.preview === undefined && ligne.lastPrompt === undefined));

/**
 * Les dernières lignes non vides d'un écran — ce que l'agent attend, montré tel quel.
 *
 * ⚠️ **Borné et brut.** On ne reformule rien : ces lignes sont ce que le terminal
 * affiche. L'écran entier ferait remonter toute la conversation dans une carte ;
 * une douzaine de lignes suffit à voir l'état courant, et l'état courant est en
 * bas. On garde l'indentation de tête (elle porte la structure du TUI) et on
 * coupe seulement les espaces de fin.
 */
export const attenteDeLEcran = (ecran: string, lignes = 12): string | undefined => {
  const retenues = ecran
    .split("\n")
    .map((ligne) => ligne.trimEnd())
    .filter((ligne) => ligne.trim().length > 0)
    .slice(-lignes);
  return retenues.length === 0 ? undefined : retenues.join("\n");
};

/**
 * Ce qu'il faut montrer pour un agent donné, ou `undefined`.
 *
 * ⚠️ **Le `blocked` est la garde, pas une décoration.** La lecture d'écran est
 * déclenchée aussi pour un agent **muet** (`fautLireLEcran` couvre « pas d'aperçu
 * et pas de dernière demande ») : un agent qui n'a rien écrit montrerait donc son
 * panneau de démarrage comme s'il attendait une réponse. On ne l'attache que
 * quand Herdr dit `blocked` — le seul état qui veut dire « il attend ».
 */
export const attenteDeLigne = (
  ligne: { readonly status: AgentStatus },
  ecran: string,
): string | undefined => (ligne.status === "blocked" ? attenteDeLEcran(ecran) : undefined);

export const makeConversationRoutes = (config: ServerConfig, herdr: HerdrApi) => {
  // Gardé au niveau du routeur pour que le résumé réutilise son cache entre
  // deux rafraîchissements de la liste.
  /**
   * Combien de lignes on lit pour tirer un apercu de liste.
   *
   * ⚠️ Bien moins que la fenetre de la conversation : la liste n'a besoin que du
   * dernier message et de la date, pas de l'historique.
   */
  const LIGNES_APERCU = 200;

  /**
   * Lit une session opencode **sous la forme d'un fichier**.
   *
   * ⚠️ **Pourquoi une adaptation, et pas un second chemin de liste.** Tout l'aval
   * — apercu, horodatage, modele, reglages — lit un `TailedSession`. Lui apprendre
   * SQLite dupliquerait chaque decision d'affichage, exactement ce que
   * l'adaptateur d'entree existe pour eviter. On lui donne donc la meme forme.
   *
   * ⚠️ `identity` a zero : une base ne se remplace pas comme un fichier tourne,
   * et cette identite ne sert qu'a un curseur que la liste ne construit pas.
   */
  const lectureSqlite =
    (source: {
      readonly base: string;
      readonly sessionId: string;
      readonly magasin: "opencode" | "devin";
    }) =>
    (_chemin: string): Effect.Effect<TailedSession, unknown> =>
      Effect.try({
        catch: (cause) => cause,
        try: () => {
          // Même choix de magasin que la route de session : un seul endroit.
          const moteur = source.magasin === "devin" ? moteurDevin : moteurOpencode;
          const page = moteur.lireDerniere(source.base, source.sessionId, LIGNES_APERCU);
          return {
            entries: page.entries,
            hasMore: page.hasMore,
            identity: { dev: 0, ino: 0 },
            offset: page.dernierSeq,
            pending: "",
          };
        },
      });

  const read = defaultRead(config.sessionRoots);
  const lire = (path: string) => read(path);

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

    /*
      ⚠️ **Le contexte de nommage vient du meme constructeur que l'accueil.**

      Il etait rebati ici a la main — deux tables, deux regles pour les memes
      libelles. Depuis que le rang d'un pane vient de la disposition de son tab,
      cette seconde construction n'aurait pas pu le fournir : deux chemins pour
      une meme donnee, dont un seul correct. C'est exactement le motif que U14
      interdit.
    */
    const naming = namingFrom(decoded.workspaces, decoded.tabs ?? [], decoded.layouts ?? []);

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
      if (agent === undefined) return false;
      // La question posee est « y a-t-il une source de session ? », pas « y a-t-il
      // un chemin de fichier ? » — opencode lit une base.
      const source = sessionSourceOf(agent);
      return estVisible({
        kind: agent.agent ?? null,
        sessionPath: source?.base ?? null,
        status: agent.agent_status,
        tabPaneCount: naming.panes.get(pane.pane_id)?.tabPaneCount ?? 1,
      });
    });

    const lignes = await withConcurrency(panes, MAX_SESSION_READS, async (pane) => {
      // Le chemin de session vient de `agent_session`, fourni par Herdr dans
      // la vue agent ; un pane sans agent n'a pas de session.
      const agent = decoded.agents.find((candidat) => candidat.pane_id === pane.pane_id);
      const source: SourceSession | undefined =
        agent === undefined ? undefined : sessionSourceOf(agent);
      const paneBrut = toRawPane(
        pane,
        naming,
        source?.base ?? null,
        agent,
        // La branche vient du **dossier du pane** : c'est le dépôt dans lequel
        // l'agent travaille réellement, pas celui du projet en général.
        pane.cwd === null || pane.cwd === undefined
          ? undefined
          : await Effect.runPromise(branchOf(pane.cwd)),
      );
      return Effect.runPromise(
        summaryOf(paneBrut, source?.kind === "sqlite" ? lectureSqlite(source) : lire),
      );
    });

    /*
      Les invites posées à l'écran — **lues sur le terminal**, jamais dans la
      session.

      ⚠️ **Pourquoi ici, et pas dans la session.** Une invite n'est écrite nulle
      part dans le JSONL : elle n'existe que sur l'écran. `agent.read` la donne.

      ⚠️ **Quand on lit, et pourquoi ce n'est plus « quand c'est bloqué ».** La
      condition était `status === "blocked"`. Mesuré le 2026-10-16 sur un onglet
      à cinq panes : codex attendait une décision (« Hooks need review ») pendant
      que Herdr le déclarait **`idle`**. Son écran n'était donc jamais lu, aucune
      carte n'apparaissait, et le pane était **inutilisable depuis le
      téléphone** — alors que l'analyseur aurait lu ses trois choix très bien.

      La règle est donc : on lit l'écran d'un agent **qui n'a rien à montrer**
      (ni aperçu, ni dernière demande) ou qui est bloqué. C'est exactement l'agent
      neuf qui attend une décision — et, sur une installation où tous les agents
      ont déjà parlé, **aucune lecture supplémentaire**.
    */
    const dossiers = new Map(
      (decoded.agents ?? []).map((agent) => [agent.pane_id, agent.cwd ?? null]),
    );

    const avecInvites = await Promise.all(
      lignes.map(async (ligne) => {
        if (!fautLireLEcran(ligne)) return ligne;

        const lecture = // `visible` : un agent bloque est en ecran alternatif, ou l'historique
          // est illisible — seule la vue courante l'est.
          await Effect.runPromise(Effect.result(herdr.readAgent(ligne.paneId, 200, "visible")));
        if (Result.isFailure(lecture)) return ligne;
        const ecran = (Option.getOrUndefined(Result.getSuccess(lecture))?.text ?? "").trim();
        if (ecran.length === 0) return ligne;

        const question = questionDeLEcran(ecran);
        // Pas de `{ ...ligne, question }` : la recopie d'objet dans un `map` est
        // le motif que le lint refuse ici (no-map-spread).
        if (question !== undefined) return Object.assign({}, ligne, { question });

        /*
          ⚠️ **L'invite de confiance, et pas seulement les choix numérotés.**
          Claude présente une sélection sans numéro, que `questionDeLEcran` refuse
          à juste titre (ce n'est pas une question à choix numérotés). Sans ce
          second détecteur, son pane restait bloqué **sans rien à l'écran** pour
          le dire.
        */
        if (isTrustPrompt(ecran)) {
          const dossier = dossiers.get(ligne.paneId) ?? null;
          const lisible = dossier ?? ligne.title;
          return Object.assign({}, ligne, {
            trust: {
              folder: lisible,
              kind: ligne.agent ?? "agent",
              message: `${ligne.agent ?? "this agent"} is asking to trust “${lisible}”. It will be able to read, write and run code there — including without asking again. This answer is recorded permanently.`,
              paneId: ligne.paneId,
              status: "trust-required" as const,
            },
          });
        }

        /*
          ⚠️ **Un agent bloqué sans question lisible n'est pas un agent sans
          attente.** opencode pose ses questions en **formulaires à plusieurs
          champs**, puis affiche une étape **Review** dont l'écran n'a **aucun
          choix numéroté**. `questionDeLEcran` rend alors `undefined`, la carte
          disparaissait, et l'agent restait `blocked` **sans que rien ne dise sur
          quoi** — l'utilisateur n'avait plus rien à quoi répondre. Mesuré le
          2026-10-17 : « agent marqué comme bloqué, mais plus de question ».

          On montre donc l'écran, qui est un **fait**, et on n'invente aucun
          choix : les lignes sont brutes, jamais reformulées.
        */
        const attente = attenteDeLigne(ligne, ecran);
        return attente === undefined ? ligne : Object.assign({}, ligne, { waiting: attente });
      }),
    );

    return respond(config.logPath, decoderOf(ConversationsResponse), {
      conversations: avecInvites,
    });
  };

  return { conversations };
};
