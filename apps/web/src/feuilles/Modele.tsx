/**
 * Changer le modèle et la réflexion d'un agent — par une commande tapée.
 *
 * La feuille envoie `/model <id>` puis `/thinking <niveau>` **par le même
 * chemin qu'un prompt** (`POST /prompt`) : confirmation par Herdr, doublons
 * évités. Vérifié par exécution sur Pi (pane jetable) : la barre d'état de
 * l'agent change. La confirmation affichée est celle de la **transmission** —
 * l'agent exécute la commande chez lui.
 *
 * Rien ne part avant « Appliquer ».
 *
 * ⚠️ **`/thinking` n'est envoyé qu'à Pi** : c'est la seule commande de
 * réflexion en cours de session vérifiée par exécution. Les niveaux que le
 * catalogue déclare pour les autres (`--effort` de Claude, niveaux de codex)
 * sont des **arguments de lancement** : taper `/thinking` dans Claude Code
 * enverrait une commande inconnue. La feuille le dit au lieu de l'offrir.
 *
 * ⚠️ **Changer la seule réflexion ne dépend pas du catalogue.** Un modèle
 * courant absent du catalogue (alias, modèle local) bloquait aussi la
 * réflexion ; les niveaux viennent alors de ceux que le catalogue déclare pour
 * le type.
 */
import { useEffect, useState } from "react";
import type { ModelCatalogResponse } from "@herdr-remote/shared";
import { fetchModelCatalog, reportError, sendPrompt, type SendResult } from "../api.ts";
import { expliquerEchec, expliquerEnvoi, expliquerSuppression } from "../etats-envoi.ts";
import { libelleReflexion } from "../libelles.ts";
import { Avis } from "../ui/atomes.tsx";
import { Feuille } from "../ui/Feuille.tsx";

export const decrisEnvoi = (resultat: SendResult): string => {
  if (resultat.kind === "sent") return expliquerEnvoi(resultat.confirmation).texte;
  if (resultat.kind === "suppressed") return expliquerSuppression(resultat.reason).texte;
  return expliquerEchec(resultat.state, resultat.message).texte;
};

const fournisseurDe = (id: string): string | null => {
  const separateur = id.indexOf("/");
  return separateur < 0 ? null : id.slice(0, separateur);
};

/**
 * Les niveaux de réflexion proposables : ceux du modèle choisi ; sans modèle
 * reconnu, ceux que le catalogue déclare pour le type (sinon l'union de ceux
 * de ses modèles). Rien d'inventé.
 */
export const niveauxProposes = (
  catalogue: ModelCatalogResponse | null,
  modele: { readonly thinkingLevels: ReadonlyArray<string> } | null,
): ReadonlyArray<string> => {
  if (modele !== null) return modele.thinkingLevels;
  if (catalogue === null) return [];
  if (catalogue.thinkingLevels.length > 0) return catalogue.thinkingLevels;
  return [...new Set(catalogue.models.flatMap((candidat) => candidat.thinkingLevels))];
};

/** Le seul type dont la commande `/thinking` en session est vérifiée. */
export const reflexionEnSession = (kind: string): boolean => kind === "pi";

/** Le modèle courant tel que le catalogue l'écrit — `null` s'il n'y figure pas. */
const modeleDuCatalogue = (
  catalogue: ModelCatalogResponse,
  kind: string,
  modele: string | undefined,
  fournisseur: string | undefined,
): string | null => {
  if (modele === undefined) return null;
  if (catalogue.models.some((candidat) => candidat.id === modele)) return modele;
  if (kind !== "pi") return null;
  if (fournisseur !== undefined) {
    const qualifie = `${fournisseur}/${modele}`;
    if (catalogue.models.some((candidat) => candidat.id === qualifie)) return qualifie;
  }
  const suffixes = catalogue.models.filter((candidat) => candidat.id.endsWith(`/${modele}`));
  return suffixes.length === 1 ? (suffixes[0]?.id ?? null) : null;
};

export const Modele = ({
  paneId,
  kind,
  agentNom,
  modeleActuel,
  fournisseurActuel,
  reflexionActuelle,
  onClose,
}: {
  readonly paneId: string;
  readonly kind: string;
  readonly agentNom: string;
  readonly modeleActuel: string | undefined;
  readonly fournisseurActuel: string | undefined;
  readonly reflexionActuelle: string | undefined;
  readonly onClose: () => void;
}) => {
  const [catalogue, setCatalogue] = useState<ModelCatalogResponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fournisseur, setFournisseur] = useState<string | null | undefined>(undefined);
  const [choix, setChoix] = useState<string | null | undefined>(undefined);
  const [reflexion, setReflexion] = useState<string | null | undefined>(undefined);
  const [filtre, setFiltre] = useState("");
  const [resultats, setResultats] = useState<
    ReadonlyArray<{ readonly commande: string; readonly resultat: SendResult }>
  >([]);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const lu = await fetchModelCatalog(kind);
        if (vivant) setCatalogue(lu);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (vivant) setErreur(message);
        reportError("failed to read the model catalog", { kind, message });
      }
    })();
    return () => {
      vivant = false;
    };
  }, [kind]);

  const actuel =
    catalogue === null ? null : modeleDuCatalogue(catalogue, kind, modeleActuel, fournisseurActuel);
  const modeleId = choix === undefined ? actuel : choix;
  const modele = catalogue?.models.find((candidat) => candidat.id === modeleId) ?? null;
  const fournisseurCourant =
    fournisseur === undefined
      ? (fournisseurActuel ?? (actuel === null ? null : fournisseurDe(actuel)))
      : fournisseur;
  const fournisseurs =
    kind === "pi" && catalogue !== null
      ? [
          ...new Set(
            catalogue.models
              .map((candidat) => fournisseurDe(candidat.id))
              .filter((f) => f !== null),
          ),
        ]
      : [];
  const visibles =
    catalogue?.models.filter(
      (candidat) =>
        (kind !== "pi" ||
          fournisseurCourant === null ||
          fournisseurDe(candidat.id) === fournisseurCourant) &&
        `${candidat.id} ${candidat.label ?? ""}`
          .toLowerCase()
          .includes(filtre.trim().toLowerCase()),
    ) ?? [];
  const niveau = reflexion === undefined ? (reflexionActuelle ?? null) : reflexion;
  const enSession = reflexionEnSession(kind);
  const niveaux = niveauxProposes(catalogue, modele);
  const changeModele = modele !== null && modele.id !== actuel;
  const changeReflexion =
    enSession &&
    niveau !== null &&
    niveau !== (reflexionActuelle ?? null) &&
    niveaux.includes(niveau);

  const appliquer = async () => {
    if (occupe) return;
    const commandes: string[] = [];
    if (changeModele) commandes.push(`/model ${modele.id}`);
    if (changeReflexion) commandes.push(`/thinking ${niveau}`);
    if (commandes.length === 0) return;
    setOccupe(true);
    const faits: Array<{ readonly commande: string; readonly resultat: SendResult }> = [];
    try {
      for (const commande of commandes) {
        // Séquentiel : un modèle refusé arrête la commande de réflexion.
        // oxlint-disable-next-line no-await-in-loop
        const resultat = await sendPrompt(paneId, commande);
        faits.push({ commande, resultat });
        setResultats([...faits]);
        if (resultat.kind !== "sent") break;
      }
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Feuille titre={`Model · ${agentNom}`} onClose={onClose}>
      {resultats.length > 0 ? (
        <output className="feuille__resultats">
          {resultats.map(({ commande, resultat }) => (
            <p key={commande}>
              <code className="mono">{commande}</code> — {decrisEnvoi(resultat)}
            </p>
          ))}
        </output>
      ) : null}
      {erreur !== null ? (
        <Avis ton="erreur">
          Unreadable {kind} catalog: {erreur}
        </Avis>
      ) : catalogue === null ? (
        <output className="discret">Loading the catalog…</output>
      ) : catalogue.models.length === 0 ? (
        <Avis ton="attention">{catalogue.error ?? `No verified catalog for ${kind}.`}</Avis>
      ) : (
        <>
          {kind === "pi" ? (
            <fieldset className="champ">
              <legend>Provider</legend>
              <select
                className="choix-liste"
                value={fournisseurCourant ?? ""}
                disabled={occupe}
                onChange={(evenement) => {
                  setFournisseur(evenement.target.value || null);
                  setChoix(null);
                  setReflexion(null);
                  setFiltre("");
                }}
              >
                <option value="">Choose…</option>
                {fournisseurs.map((candidat) => (
                  <option key={candidat} value={candidat}>
                    {candidat}
                  </option>
                ))}
              </select>
            </fieldset>
          ) : null}
          <fieldset className="champ">
            <legend>Model</legend>
            {visibles.length > 8 || filtre.length > 0 ? (
              <input
                type="search"
                className="champ__filtre"
                value={filtre}
                placeholder={`Filter ${String(visibles.length)} models`}
                aria-label="Filter models"
                onChange={(evenement) => setFiltre(evenement.target.value)}
              />
            ) : null}
            <div className="modeles">
              {visibles.slice(0, 200).map((candidat) => (
                <label key={candidat.id} className="modele">
                  <input
                    type="radio"
                    name="modele"
                    checked={candidat.id === modeleId}
                    disabled={occupe}
                    onChange={() => {
                      setChoix(candidat.id);
                      setReflexion((precedente) => {
                        const garde = precedente === undefined ? reflexionActuelle : precedente;
                        return garde !== undefined &&
                          garde !== null &&
                          candidat.thinkingLevels.includes(garde)
                          ? garde
                          : null;
                      });
                    }}
                  />
                  <span>{candidat.label ?? candidat.id}</span>
                  <span className="modele__id">
                    {candidat.id === actuel ? "current" : candidat.id}
                  </span>
                </label>
              ))}
              {visibles.length === 0 ? <p className="discret modele">No model matches.</p> : null}
            </div>
            <p className="discret">
              {actuel === null
                ? "The current model is not declared in the session."
                : `Current: ${actuel}`}
            </p>
          </fieldset>
        </>
      )}
      {!enSession ? (
        <p className="discret">
          {agentNom}'s thinking level cannot be changed mid-session from here: only Pi's “/thinking”
          command is verified.
          {catalogue !== null && catalogue.thinkingLevels.length > 0
            ? ` Levels offered at launch: ${catalogue.thinkingLevels.map(libelleReflexion).join(", ")}.`
            : ""}
        </p>
      ) : niveaux.length > 0 ? (
        <fieldset className="champ">
          <legend>Thinking</legend>
          <fieldset className="seg seg--plein" aria-label="Thinking level">
            {niveaux.map((candidat) => (
              <button
                key={candidat}
                type="button"
                aria-pressed={niveau === candidat}
                disabled={occupe}
                onClick={() => setReflexion(candidat)}
              >
                {libelleReflexion(candidat)}
              </button>
            ))}
          </fieldset>
          <p className="discret">
            {reflexionActuelle === undefined
              ? "Current level unknown."
              : `Current: ${libelleReflexion(reflexionActuelle)}`}
            {modele === null && catalogue !== null
              ? " — levels declared for the agent type, since the current model is not in the catalog."
              : ""}
          </p>
        </fieldset>
      ) : modele !== null ? (
        <p className="discret">This model declares no thinking level.</p>
      ) : catalogue !== null ? (
        <p className="discret">The catalog declares no thinking level.</p>
      ) : null}
      <button
        type="button"
        className="bouton bouton--principal bouton--plein"
        disabled={occupe || (!changeModele && !changeReflexion)}
        onClick={() => void appliquer()}
      >
        {occupe ? "Sending…" : "Apply"}
      </button>
      <p className="discret">
        A confirmation means the command reached the agent, not that the setting was applied.
      </p>
    </Feuille>
  );
};
