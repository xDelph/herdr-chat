/**
 * La boîte de réception : ce qui attend une décision passe devant, avec ses
 * réponses à portée de pouce ; le reste se lit d'un coup d'œil.
 *
 * ```
 * Attend une décision   cartes répondables (question, confiance, saisie)
 * En cours              qui travaille, depuis quand
 * Récents               dernier message, temps écoulé, non lu
 * ```
 */
import { memo, useDeferredValue, useMemo, useState } from "react";
import type { ConversationSummary } from "@herdr-remote/shared";
import { useEnLigne, useMaintenant } from "../app/hooks.ts";
import { etatConnexion, LIBELLE_CONNEXION } from "../connexion.ts";
import type { EtatDonnees } from "../donnees.ts";
import { etatLecture, FENETRE_DEMARRAGE_MS, heureLue } from "../etats.ts";
import { estNonLue, type Lectures } from "../lectures.ts";
import { dossierDe, marqueAgent, premierNonVide, titrePropre } from "../libelles.ts";
import { GROUPEMENT_LABEL, GROUPEMENTS, type Groupement, type OrdreListe } from "../preferences.ts";
import { routeToHash } from "../routing.ts";
import { groupesDe, ORDRE_LABEL, SECTIONS, type Groupe } from "../sections.ts";
import { Avis } from "../ui/atomes.tsx";
import { Icone } from "../ui/Icone.tsx";
import { CarteAttention } from "./CarteAttention.tsx";
import { EnTeteProjet } from "./EnTeteProjet.tsx";
import { LigneAgent } from "./LigneAgent.tsx";

const OUVERTURE = Date.now();

/** Le texte où chercher : ce que la ligne affiche déjà, rien de plus. */
const botteDe = (conversation: ConversationSummary, projet: string): string =>
  [
    projet,
    conversation.title,
    marqueAgent(conversation.agent).nom,
    conversation.lastPrompt,
    conversation.preview,
    conversation.model,
    conversation.branch,
  ]
    .filter((morceau) => morceau !== undefined && morceau !== null)
    .join(" ")
    .toLowerCase();

const Direct = memo(
  ({
    donnees,
    maintenant,
    enLigne,
  }: {
    readonly donnees: EtatDonnees;
    readonly maintenant: number;
    readonly enLigne: boolean;
  }) => {
    const etat = etatConnexion({
      dernierSucces: donnees.dernierSucces,
      depuisOuverture: maintenant - OUVERTURE,
      direct: donnees.direct,
      enLigne,
      erreur: donnees.erreurs.conversations,
    });
    if (etat.phase === "direct") {
      return (
        <span className="direct">
          <span className="point" aria-hidden="true" />
          {LIBELLE_CONNEXION.direct}
        </span>
      );
    }
    return (
      <span
        className={etat.phase === "hors-ligne" ? "direct direct--coupe" : "direct direct--attente"}
      >
        {LIBELLE_CONNEXION[etat.phase]}
      </span>
    );
  },
);
Direct.displayName = "Direct";

export const Boite = ({
  donnees,
  lectures,
  groupement,
  onGroupement,
  ordre,
  onOrdre,
  projet = null,
  onLancer,
  onReglages,
  onReessayer,
  paneCourant,
  cachee = false,
}: {
  readonly donnees: EtatDonnees;
  readonly lectures: Lectures;
  readonly groupement: Groupement;
  readonly onGroupement: (suivant: Groupement) => void;
  readonly ordre: OrdreListe;
  readonly onOrdre: (suivant: OrdreListe) => void;
  /** `#/projet/<id>` : la liste filtrée sur ce projet, avec « Nouvel agent ». */
  readonly projet?: string | null;
  readonly onLancer: () => void;
  readonly onReglages: () => void;
  /** Relire tout de suite (liste en erreur ou hors ligne). */
  readonly onReessayer: () => void;
  readonly paneCourant: string | null;
  /**
   * La liste est cachée (téléphone, conversation ouverte) : ses horloges se
   * taisent. Elle se redessinait chaque seconde derrière le chat.
   */
  readonly cachee?: boolean;
}) => {
  const [recherche, setRecherche] = useState("");
  const rechercheDifferee = useDeferredValue(recherche);
  const { conversations, overview, debutsTravail } = donnees;

  // L'horloge bat à la seconde seulement si un chronomètre est visible.
  const chronometres = (conversations ?? []).some(
    (conversation) => conversation.status === "working" && debutsTravail.has(conversation.paneId),
  );
  const maintenant = useMaintenant(cachee ? null : chronometres ? 1_000 : 30_000);
  const enLigne = useEnLigne();
  // Les temps relatifs (« 25 min ») n'ont pas besoin de la seconde : les lignes
  // qui ne portent pas de chronomètre ne se redessinent qu'à la demi-minute.
  const demiMinute = Math.floor(maintenant / 30_000) * 30_000;

  const projets = useMemo(() => {
    const noms = new Map<string, string>();
    for (const espace of overview?.workspaces ?? []) {
      noms.set(
        espace.workspaceId,
        premierNonVide(espace.label, dossierDe(espace.checkoutPath), espace.workspaceId),
      );
    }
    return noms;
  }, [overview]);
  const nomDuProjet = useMemo(
    () => (workspaceId: string) => projets.get(workspaceId) ?? workspaceId,
    [projets],
  );

  const duProjet = useMemo(
    () =>
      projet === null
        ? (conversations ?? [])
        : (conversations ?? []).filter((conversation) => conversation.workspaceId === projet),
    [conversations, projet],
  );

  const filtrees = useMemo(() => {
    const motif = rechercheDifferee.trim().toLowerCase();
    if (motif.length === 0) return duProjet;
    return duProjet.filter((conversation) =>
      botteDe(conversation, nomDuProjet(conversation.workspaceId)).includes(motif),
    );
  }, [duProjet, nomDuProjet, rechercheDifferee]);

  // Dans un projet, regrouper par projet n'aurait qu'un groupe : par état.
  const groupes: ReadonlyArray<Groupe> = useMemo(
    () => groupesDe(filtrees, ordre, projet === null ? groupement : "statut", nomDuProjet),
    [filtrees, groupement, nomDuProjet, ordre, projet],
  );

  const etat = etatLecture({
    chargement: donnees.chargement,
    depuisOuverture: maintenant - OUVERTURE,
    dernierSucces: donnees.dernierSucces,
    erreur: donnees.erreurs.conversations,
    live: donnees.direct === "live",
    total: conversations?.length ?? 0,
  });
  const total = duProjet.length;

  return (
    <section className="boite" aria-label="Agents">
      <header className="boite__haut">
        <h1>Agents</h1>
        <Direct donnees={donnees} maintenant={maintenant} enLigne={enLigne} />
        <button
          type="button"
          className="bouton-icone"
          aria-label="Lancer un agent"
          onClick={onLancer}
        >
          <Icone nom="plus" />
        </button>
        <button type="button" className="bouton-icone" aria-label="Réglages" onClick={onReglages}>
          <Icone nom="gear" />
        </button>
      </header>
      {projet === null ? null : (
        <EnTeteProjet
          nom={nomDuProjet(projet)}
          existe={projets.has(projet)}
          lu={overview !== null}
          onLancer={onLancer}
        />
      )}
      <label className="recherche">
        <Icone nom="search" petite />
        <span className="sr">Rechercher</span>
        <input
          type="search"
          value={recherche}
          placeholder="Projet, agent, message…"
          onChange={(evenement) => setRecherche(evenement.target.value)}
        />
      </label>
      <div className="boite__outils">
        {projet === null ? (
          <fieldset className="seg" aria-label="Regrouper">
            {GROUPEMENTS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={groupement === option}
                onClick={() => onGroupement(option)}
              >
                {GROUPEMENT_LABEL[option]}
              </button>
            ))}
          </fieldset>
        ) : (
          <span />
        )}
        <span className="boite__tri">
          <button
            type="button"
            className="bouton-tri"
            aria-pressed={ordre === "nom"}
            aria-label={
              ordre === "nom" ? "Trié par nom — trier par date" : "Trié par date — trier par nom"
            }
            onClick={() => onOrdre(ordre === "nom" ? "recent" : "nom")}
          >
            {ORDRE_LABEL[ordre]}
          </button>
          <span className="discret num">
            {recherche.trim().length > 0
              ? `${String(filtrees.length)} sur ${String(total)}`
              : `${String(total)} agent${total > 1 ? "s" : ""}`}
          </span>
        </span>
      </div>

      <div className="boite__liste">
        {etat.phase === "hors-ligne" ? (
          <Avis ton="attention" annonce="statut">
            Hors ligne — dernière lecture à {heureLue(etat.dernierSucces) ?? "?"} ·{" "}
            {donnees.erreurs.conversations}{" "}
            <button
              type="button"
              className="lien lien--avis"
              disabled={donnees.chargement}
              onClick={onReessayer}
            >
              {donnees.chargement ? "Lecture…" : "Réessayer"}
            </button>
          </Avis>
        ) : null}
        {etat.phase === "erreur" ? (
          <Avis ton="erreur" annonce="alerte">
            Liste illisible : {etat.cause}{" "}
            <button
              type="button"
              className="lien lien--avis"
              disabled={donnees.chargement}
              onClick={onReessayer}
            >
              {donnees.chargement ? "Lecture…" : "Réessayer"}
            </button>
          </Avis>
        ) : null}
        {donnees.erreurs.overview !== null && etat.phase !== "erreur" ? (
          <Avis ton="attention">Projets illisibles : {donnees.erreurs.overview}</Avis>
        ) : null}
        {etat.phase === "chargement" ? (
          <output className="boite__vide">
            {maintenant - OUVERTURE < FENETRE_DEMARRAGE_MS
              ? "Connexion au démon…"
              : "Lecture des agents…"}
          </output>
        ) : null}
        {etat.phase === "vide" ? (
          <p className="boite__vide">Aucun agent ouvert dans Herdr. Lancez-en un avec +.</p>
        ) : null}
        {projet !== null && etat.phase !== "vide" && total === 0 && conversations !== null ? (
          <p className="boite__vide">
            Aucun agent dans ce projet. Lancez-en un avec « Nouvel agent ».
          </p>
        ) : null}
        {total > 0 && filtrees.length === 0 ? (
          <p className="boite__vide">Rien ne correspond à « {recherche.trim()} ».</p>
        ) : null}

        {groupes.map((groupe) => (
          <section
            key={groupe.cle}
            className={groupe.cle === "a-traiter" ? "groupe groupe--attn" : "groupe"}
            aria-labelledby={`groupe-${groupe.cle}`}
          >
            <div className="groupe__tete">
              <h2 id={`groupe-${groupe.cle}`}>
                {/* Un groupe de projet mène au détail du projet. */}
                {groupement === "projet" &&
                projet === null &&
                !(SECTIONS as ReadonlyArray<string>).includes(groupe.cle) ? (
                  <a href={routeToHash({ kind: "projet", workspaceId: groupe.cle })}>
                    {groupe.titre}
                  </a>
                ) : (
                  groupe.titre
                )}
              </h2>
              <span className="num">{groupe.conversations.length}</span>
            </div>
            {groupe.cle === "a-traiter" ? (
              groupe.conversations.map((conversation) => (
                <CarteAttention
                  key={conversation.paneId}
                  conversation={conversation}
                  projet={nomDuProjet(conversation.workspaceId)}
                  titre={titrePropre(conversation.title)}
                  maintenant={demiMinute}
                />
              ))
            ) : (
              <div className="lignes">
                {groupe.conversations.map((conversation) => (
                  <LigneAgent
                    key={conversation.paneId}
                    conversation={conversation}
                    projet={nomDuProjet(conversation.workspaceId)}
                    titre={titrePropre(conversation.title)}
                    maintenant={conversation.status === "working" ? maintenant : demiMinute}
                    nonLue={estNonLue(conversation, lectures)}
                    debutTravail={debutsTravail.get(conversation.paneId)}
                    courante={conversation.paneId === paneCourant}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
        <div className="boite__fin" />
      </div>
    </section>
  );
};
