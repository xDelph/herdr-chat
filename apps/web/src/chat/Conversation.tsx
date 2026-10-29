/**
 * Une conversation — montée **par pane** (`key={paneId}` chez l'appelant).
 *
 * ⚠️ **Isolation par pane (revue 2026-10-17, P0).** Tout ce qui est local à une
 * conversation — suivi de session, transcription, défilement, brouillon,
 * feuilles ouvertes — meurt avec elle quand on change de pane. Ce qui doit
 * survivre à la navigation (envois en attente, issues d'actions) vit dans des
 * magasins de l'application, **rangé sous sa cible**.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentView, ConversationSummary } from "@herdr-remote/shared";
import { cleAction } from "../actions-locales.ts";
import { envoisApparus } from "../apparition-envois.ts";
import { touchedFilesOf, type Block } from "../blocks.ts";
import { arreter, montrerSurMac } from "../app/gestes.ts";
import { useAction, useEnvois } from "../app/hooks.ts";
import { envois } from "../app/services.ts";
import { creeTranscripteur, tourEnCours } from "../transcript.ts";
import { marqueAgent, premierNonVide, titrePropre } from "../libelles.ts";
import { presenceDuPane, raisonSansEnvoi } from "../pane-ouvert.ts";
import { Avis } from "../ui/atomes.tsx";
import { BandeauConnexion } from "./BandeauConnexion.tsx";
import { Fichiers } from "../feuilles/Fichiers.tsx";
import { Modele } from "../feuilles/Modele.tsx";
import { Visionneuse } from "../feuilles/Visionneuse.tsx";
import { Taches } from "../feuilles/Taches.tsx";
import { infosDesTaches, type RapportDeTache } from "../taches.ts";
import { InfosTaches } from "./CarteRapport.tsx";
import { useListeTaches } from "./useTaches.ts";
import { Composeur, type PoigneeComposeur } from "./Composeur.tsx";
import { EnTete, Voisins } from "./EnTete.tsx";
import { Envois } from "./Envois.tsx";
import { Fil } from "./Fil.tsx";
import { LigneTravail } from "./LigneTravail.tsx";
import { Question } from "./Question.tsx";
import { useSuiviSession } from "./useSuiviSession.ts";
import { demandesEnFile } from "../file-attente.ts";
import { FileAttente } from "./FileAttente.tsx";

type Feuille =
  | { readonly genre: "modele" }
  | { readonly genre: "taches" }
  | { readonly genre: "fichiers" }
  | { readonly genre: "fichier"; readonly chemin: string; readonly depuisFichiers: boolean };

/** Le modèle et la réflexion déclarés par la session elle-même (Pi). */
const reglagesDeSession = (
  entries: ReadonlyArray<{ readonly raw: string; readonly type: string }>,
): { readonly modele?: string; readonly fournisseur?: string; readonly reflexion?: string } => {
  let modele: string | undefined;
  let fournisseur: string | undefined;
  let reflexion: string | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entree = entries[index];
    if (entree === undefined) continue;
    const cherche =
      (modele === undefined && entree.type === "model_change") ||
      (reflexion === undefined && entree.type === "thinking_level_change");
    if (!cherche) continue;
    try {
      const brut: unknown = JSON.parse(entree.raw);
      if (typeof brut !== "object" || brut === null) continue;
      const id: unknown = Reflect.get(brut, "modelId");
      const fourni: unknown = Reflect.get(brut, "provider");
      const niveau: unknown = Reflect.get(brut, "thinkingLevel");
      if (modele === undefined && typeof id === "string") {
        modele = id;
        if (typeof fourni === "string") fournisseur = fourni;
      }
      if (reflexion === undefined && typeof niveau === "string") reflexion = niveau;
    } catch {
      // Une ligne illisible n'apprend rien : on continue plus haut.
    }
    if (modele !== undefined && reflexion !== undefined) break;
  }
  return {
    ...(modele === undefined ? {} : { modele }),
    ...(fournisseur === undefined ? {} : { fournisseur }),
    ...(reflexion === undefined ? {} : { reflexion }),
  };
};

/** Ce que l'agent attend et que l'écran montre au-dessus du composeur. */
const attenteAffichee = (
  conversation: ConversationSummary | null,
): "question" | "confiance" | null => {
  if (conversation === null) return null;
  if (conversation.trust !== undefined) return "confiance";
  return conversation.question === undefined ? null : "question";
};

/** La ligne sous le composeur : pourquoi l'envoi est fermé, sinon où le texte ira. */
const aideDuComposeur = (sansEnvoi: string | null, saisieBrute: boolean): string | null => {
  if (sansEnvoi !== null) return sansEnvoi;
  return saisieBrute ? "The agent is waiting: your message is typed into its prompt." : null;
};

export const Conversation = ({
  paneId,
  agent,
  souvenir,
  overviewLu,
  vuAvant,
  conversation,
  projet,
  voisins,
  debutObserve,
  lueA,
  onRetour,
  onVue,
}: {
  readonly paneId: string;
  /** L'agent dans la DERNIÈRE lecture d'Herdr — `null` s'il n'y est pas. */
  readonly agent: AgentView | null;
  /** Son dernier état connu : pour les libellés seulement, jamais pour l'état. */
  readonly souvenir: AgentView | undefined;
  /** Une lecture de l'overview a déjà réussi. */
  readonly overviewLu: boolean;
  /** Le pane a été vu dans une lecture précédente. */
  readonly vuAvant: boolean;
  readonly conversation: ConversationSummary | null;
  readonly projet: string;
  readonly voisins: ReadonlyArray<AgentView>;
  readonly debutObserve: number | undefined;
  readonly lueA: number | null;
  readonly onRetour: () => void;
  /** Note la lecture locale (point « non lu » de la liste). */
  readonly onVue: (paneId: string, instant: number) => void;
}) => {
  const [ouvertA] = useState(Date.now);
  const presence = presenceDuPane({
    lueA,
    ouvertA,
    overviewLu,
    present: agent !== null,
    vuAvant,
  });
  const disparu = presence === "disparu";
  // Les libellés peuvent venir du souvenir ; l'état, jamais.
  const connu = agent ?? souvenir ?? null;
  const status = disparu ? "unknown" : (conversation?.status ?? agent?.status ?? "unknown");
  const kind = conversation?.agent ?? connu?.agent ?? null;
  const agentNom = marqueAgent(kind).nom;
  const cwd = connu?.cwd ?? null;
  const aUneSession = connu === null ? true : connu.sessionPath !== null;

  const { vue, suivi } = useSuiviSession(paneId, aUneSession);
  const [transcrire] = useState(creeTranscripteur);
  const { messages, items } = useMemo(() => transcrire(vue.entries), [transcrire, vue.entries]);
  /*
    ⚠️ **Un seul chronomètre.** Le début du tour vient du démon (`tourDebut`,
    tâches de fond comprises), comme la liste ; le calcul local n'est qu'un
    repli. Retour du 2026-10-29 : le chrono repartait alors que le travail
    n'était pas fini.
  */
  const tour = useMemo(() => {
    const local = tourEnCours(messages);
    const serveur = conversation?.tourDebut;
    return serveur === undefined ? local : { ...local, debutMs: serveur };
  }, [messages, conversation?.tourDebut]);
  const enFile = useMemo(() => demandesEnFile(vue.entries), [vue.entries]);
  const reglages = useMemo(() => reglagesDeSession(vue.entries), [vue.entries]);
  // Les cartes du harnais se titrent avec ce que le fil ET le démon savent.
  const listeTaches = useListeTaches(paneId, conversation?.tachesDeFond);
  const infosTaches = useMemo(
    () =>
      infosDesTaches(
        messages.flatMap((message) =>
          message.blocks.filter(
            (block: Block): block is RapportDeTache => block.kind === "rapportTache",
          ),
        ),
        listeTaches,
      ),
    [messages, listeTaches],
  );
  const liste = useEnvois(paneId);
  const composeur = useRef<PoigneeComposeur | null>(null);
  const [feuille, setFeuille] = useState<Feuille | null>(null);
  const arret = useAction(cleAction(paneId, "arret"));

  // La lecture est notée ici, sur le téléphone — jamais par un focus sur le Mac.
  const derniereActivite = conversation?.timestamp;
  useEffect(() => {
    onVue(paneId, Math.max(Date.now(), derniereActivite ?? 0));
  }, [derniereActivite, onVue, paneId]);

  // Une bulle locale disparaît quand la session porte CE message : c'est la
  // preuve. Seul ce qui est arrivé après l'envoi compte (`apparition-envois.ts`).
  useEffect(() => {
    for (const id of envoisApparus(messages, envois.liste(paneId))) envois.oublie(id);
  }, [messages, paneId]);

  const messagesRef = useRef(messages);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  });
  const envoie = useCallback(
    (texte: string) => {
      // ⚠️ La cible est capturée ICI : elle ne changera plus (envois.ts).
      envois.ajoute({
        apres: messagesRef.current.at(-1)?.id ?? null,
        creeA: Date.now(),
        pane: paneId,
        text: texte,
      });
    },
    [paneId],
  );
  const arrete = useCallback(() => void arreter(paneId), [paneId]);
  const remettre = useCallback((texte: string) => composeur.current?.remettre(texte), []);
  const ouvrirFichier = useCallback(
    (chemin: string) => setFeuille({ chemin, depuisFichiers: false, genre: "fichier" }),
    // `setFeuille` est stable ; le nommer garde la mémoïsation lisible au compilateur.
    [setFeuille],
  );
  const fichiers = useMemo(
    () =>
      feuille?.genre === "fichiers" || feuille?.genre === "fichier"
        ? touchedFilesOf(messages)
        : null,
    [feuille, messages],
  );

  // ⚠️ Mémoïsé : un `children` neuf à chaque rendu défaisait le `memo` du fil.
  const travaille = status === "working";
  const basDuFil = useMemo(
    () => (
      <>
        <Envois liste={liste} onRemettre={remettre} travaille={travaille} />
        <FileAttente
          demandes={enFile}
          dejaAffichees={new Set(liste.map((envoi) => envoi.text.trim()))}
        />
        {travaille ? <LigneTravail tour={tour} debutObserve={debutObserve} cwd={cwd} /> : null}
      </>
    ),
    [cwd, debutObserve, enFile, liste, remettre, tour, travaille],
  );
  // Le compte des fichiers modifiés n'est calculé qu'à l'ouverture du menu.
  const compteFichiers = useCallback(() => touchedFilesOf(messages).length, [messages]);

  const titre = premierNonVide(titrePropre(conversation?.title ?? connu?.title), projet);
  const bloque = status === "blocked";
  const attente = bloque ? attenteAffichee(conversation) : null;
  const sansEnvoi = raisonSansEnvoi({ attente, phase: vue.phase, presence });
  // L'issue de l'arrêt part en notification en haut de l'écran (`gestes.ts`).
  const aide = aideDuComposeur(sansEnvoi, bloque && attente === null);

  return (
    <section className="conversation" aria-label={`Conversation ${titre}`}>
      <EnTete
        titre={titre}
        projet={projet}
        kind={kind}
        modele={conversation?.model ?? reglages.modele}
        reflexion={conversation?.thinking ?? reglages.reflexion}
        status={status}
        transport={vue.transport}
        causeRepli={vue.causeRepli}
        inactif={disparu}
        compteFichiers={compteFichiers}
        tachesDeFond={conversation?.tachesDeFond}
        onTaches={() => setFeuille({ genre: "taches" })}
        onRetour={onRetour}
        onMac={() => void montrerSurMac(paneId)}
        onModele={() => setFeuille({ genre: "modele" })}
        onFichiers={() => setFeuille({ genre: "fichiers" })}
      />
      <BandeauConnexion />
      <Voisins agents={voisins} courant={paneId} />
      {disparu ? (
        <Avis ton="attention" annonce="statut">
          Herdr no longer knows this pane — it was closed. Showing the last items read; nothing can
          be sent to it anymore.
        </Avis>
      ) : null}
      {vue.fin === null ? null : (
        <Avis ton="attention" annonce="statut">
          The session stream stopped: {vue.fin}
        </Avis>
      )}
      {vue.erreur !== null && vue.entries.length > 0 ? (
        <Avis ton="erreur" annonce="alerte">
          {vue.avertissement ?? vue.erreur}
        </Avis>
      ) : vue.avertissement === null ? null : (
        <Avis ton="attention" annonce="statut">
          {vue.avertissement}
        </Avis>
      )}

      <InfosTaches.Provider value={infosTaches}>
        <Fil
          paneId={paneId}
          items={items}
          vue={vue}
          suivi={suivi}
          status={status}
          cwd={cwd}
          onOuvrirFichier={ouvrirFichier}
          aUneSession={aUneSession}
          envoisEnAttente={liste.length}
        >
          {basDuFil}
        </Fil>
        {feuille?.genre === "taches" ? (
          <Taches
            paneId={paneId}
            cwd={cwd}
            onClose={() => setFeuille(null)}
            onOuvrirFichier={ouvrirFichier}
          />
        ) : null}
      </InfosTaches.Provider>

      {bloque && conversation !== null ? (
        <Question conversation={conversation} agentNom={agentNom} lueA={lueA} />
      ) : null}
      <Composeur
        ref={composeur}
        paneId={paneId}
        agentNom={agentNom}
        travaille={status === "working"}
        arretEnCours={arret?.phase === "en-cours"}
        aide={aide}
        envoiImpossible={sansEnvoi !== null}
        inactif={disparu}
        onEnvoie={envoie}
        onArrete={arrete}
      />

      {feuille?.genre === "modele" ? (
        <Modele
          paneId={paneId}
          kind={kind ?? "pi"}
          agentNom={agentNom}
          modeleActuel={conversation?.model ?? reglages.modele}
          fournisseurActuel={conversation?.provider ?? reglages.fournisseur}
          reflexionActuelle={conversation?.thinking ?? reglages.reflexion}
          onClose={() => setFeuille(null)}
        />
      ) : null}
      {feuille?.genre === "fichiers" ? (
        <Fichiers
          fichiers={fichiers ?? []}
          cwd={cwd}
          onClose={() => setFeuille(null)}
          onOuvrir={(chemin) => setFeuille({ chemin, depuisFichiers: true, genre: "fichier" })}
        />
      ) : null}
      {feuille?.genre === "fichier" ? (
        <Visionneuse
          chemin={feuille.chemin}
          onClose={() => setFeuille(null)}
          onRetour={feuille.depuisFichiers ? () => setFeuille({ genre: "fichiers" }) : undefined}
        />
      ) : null}
    </section>
  );
};
