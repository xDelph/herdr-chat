/**
 * Lancer un agent : projet, type, modèle, réflexion.
 *
 * ⚠️ **Rien ne part sans être vérifié** (`launch.ts`) : le bouton reste éteint
 * tant que le choix n'est pas confirmé par le catalogue, et la raison est
 * écrite. Un catalogue absent est dit absent — l'agent démarre alors avec ses
 * propres valeurs, c'est un choix proposé.
 *
 * ⚠️ **La confiance demandée au lancement n'est pas un échec** (409
 * `trust-required`) : elle s'affiche ici, et se tranche ici.
 */
import { useEffect, useState } from "react";
import type { InstalledKind, WorkspaceView } from "@herdr-remote/shared";
import {
  fetchModelCatalog,
  launchAgent,
  reportError,
  TrustRequiredError,
  type ModelCatalog,
  type TrustRequired,
} from "../api.ts";
import { faireConfiance } from "../app/gestes.ts";
import { useAction } from "../app/hooks.ts";
import { magasin } from "../app/services.ts";
import { cleAction } from "../actions-locales.ts";
import { libelleRefus } from "../etats-envoi.ts";
import {
  filtreUtile,
  MAX_MODELES_AFFICHES,
  modelesVisibles,
  verifierLancement,
} from "../launch.ts";
import { dossierDe, libelleReflexion, marqueAgent, premierNonVide } from "../libelles.ts";
import { Avis, Marque } from "../ui/atomes.tsx";
import { Feuille } from "../ui/Feuille.tsx";
import { IssueAction } from "../ui/IssueAction.tsx";

const nomDuProjet = (espace: WorkspaceView): string =>
  premierNonVide(espace.label, dossierDe(espace.checkoutPath), espace.workspaceId);

const Confiance = ({ demande }: { readonly demande: TrustRequired }) => {
  const issue = useAction(cleAction(demande.paneId, "confiance", demande.folder));
  const occupe = issue?.phase === "en-cours";
  return (
    <div className="carte">
      <p className="carte__q">
        {marqueAgent(demande.kind).nom} requests access to the folder{" "}
        <span className="mono">{demande.folder}</span>
      </p>
      <p className="discret">
        It will be able to read, write and run code there without asking again. The choice is saved
        on the Mac.
      </p>
      <div className="carte__options">
        <button
          type="button"
          className="bouton bouton--principal"
          disabled={occupe}
          onClick={() => void faireConfiance(demande.paneId, demande.folder, true)}
        >
          Trust
        </button>
        <button
          type="button"
          className="bouton"
          disabled={occupe}
          onClick={() => void faireConfiance(demande.paneId, demande.folder, false)}
        >
          {libelleRefus(demande.kind)}
        </button>
      </div>
      <IssueAction issue={issue} enCours="Sending the decision…" />
    </div>
  );
};

export const Lancement = ({
  espaces,
  kinds,
  erreurKinds,
  espaceInitial,
  onClose,
  onLance,
}: {
  readonly espaces: ReadonlyArray<WorkspaceView>;
  readonly kinds: ReadonlyArray<InstalledKind> | null;
  readonly erreurKinds: string | null;
  readonly espaceInitial: string | null;
  readonly onClose: () => void;
  /** Le pane est lancé : l'appelant l'ouvre. */
  readonly onLance: (paneId: string) => void;
}) => {
  const [espace, setEspace] = useState(
    espaceInitial ??
      espaces.find((candidat) => candidat.focused)?.workspaceId ??
      espaces[0]?.workspaceId ??
      "",
  );
  const [kind, setKind] = useState(
    kinds?.find((candidat) => candidat.kind === "pi")?.kind ?? kinds?.[0]?.kind ?? "",
  );
  const [fournisseur, setFournisseur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState("");
  const [modele, setModele] = useState("");
  const [reflexion, setReflexion] = useState("");
  const [catalogue, setCatalogue] = useState<ModelCatalog | null>(null);
  const [lecture, setLecture] = useState<"en-cours" | "faite">("en-cours");
  const [erreurCatalogue, setErreurCatalogue] = useState<string | null>(null);
  const [lancement, setLancement] = useState<"repos" | "en-cours">("repos");
  const [echec, setEchec] = useState<string | null>(null);
  const [confiance, setConfiance] = useState<TrustRequired | null>(null);

  useEffect(() => {
    if (kind === "" && kinds !== null && kinds.length > 0) {
      setKind(kinds.find((candidat) => candidat.kind === "pi")?.kind ?? kinds[0]?.kind ?? "");
    }
  }, [kind, kinds]);

  useEffect(() => {
    if (kind === "") return undefined;
    let vivant = true;
    setCatalogue(null);
    setErreurCatalogue(null);
    setLecture("en-cours");
    void (async () => {
      try {
        const lu = await fetchModelCatalog(kind);
        if (vivant) setCatalogue(lu);
      } catch (cause) {
        if (vivant) setErreurCatalogue(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (vivant) setLecture("faite");
      }
    })();
    return () => {
      vivant = false;
    };
  }, [kind]);

  const choisirKind = (suivant: string) => {
    setKind(suivant);
    setFournisseur(null);
    setFiltre("");
    setModele("");
    setReflexion("");
  };

  const verdict = verifierLancement({
    catalog: erreurCatalogue !== null ? null : catalogue,
    kind,
    model: modele,
    thinking: reflexion,
  });
  const choisi = catalogue?.models.find((candidat) => candidat.id === modele);
  const fournisseurs =
    kind === "pi" && catalogue !== null
      ? [
          ...new Set(
            catalogue.models
              .map((candidat) => candidat.id.split("/", 1)[0])
              .filter((valeur): valeur is string => valeur !== undefined && valeur.length > 0),
          ),
        ]
      : [];
  const visibles =
    catalogue === null
      ? []
      : modelesVisibles(catalogue, filtre).filter(
          (candidat) =>
            kind !== "pi" || (fournisseur !== null && candidat.id.startsWith(`${fournisseur}/`)),
        );

  const lancer = async () => {
    if (!verdict.envoyable || lancement === "en-cours" || espace === "") return;
    setLancement("en-cours");
    setEchec(null);
    setConfiance(null);
    try {
      const lance = await launchAgent(espace, kind, verdict.choix);
      void magasin.rafraichit();
      onLance(lance.paneId);
    } catch (cause) {
      if (cause instanceof TrustRequiredError) {
        setConfiance(cause.request);
      } else {
        const message = cause instanceof Error ? cause.message : String(cause);
        setEchec(message);
        reportError("failed to launch an agent", { kind, message, workspaceId: espace });
      }
    } finally {
      setLancement("repos");
    }
  };

  return (
    <Feuille titre="New agent" onClose={onClose}>
      <fieldset className="champ">
        <legend>Project</legend>
        {espaces.length === 0 ? (
          <Avis ton="attention">No project open in Herdr.</Avis>
        ) : (
          <select
            className="choix-liste"
            value={espace}
            aria-label="Project"
            onChange={(evenement) => setEspace(evenement.target.value)}
          >
            {espaces.map((candidat) => (
              <option key={candidat.workspaceId} value={candidat.workspaceId}>
                {nomDuProjet(candidat)}
                {candidat.checkoutPath === null ? "" : ` — ${candidat.checkoutPath}`}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      <fieldset className="champ">
        <legend>Agent</legend>
        {kinds === null ? (
          erreurKinds === null ? (
            <p className="discret">Loading installed agents…</p>
          ) : (
            <Avis ton="erreur">
              Unreadable installed agents: {erreurKinds}
              <button type="button" className="lien" onClick={() => void magasin.lectureDesKinds()}>
                Retry
              </button>
            </Avis>
          )
        ) : kinds.length === 0 ? (
          <Avis ton="attention">Herdr reports no installed agent.</Avis>
        ) : (
          <div className="types">
            {kinds.map((candidat) => (
              <button
                key={candidat.kind}
                type="button"
                className="type"
                aria-pressed={kind === candidat.kind}
                onClick={() => choisirKind(candidat.kind)}
                title={candidat.state === "current" ? undefined : `state: ${candidat.state}`}
              >
                <Marque kind={candidat.kind} />
                {marqueAgent(candidat.kind).nom}
                {candidat.state === "current" ? null : <small>{candidat.state}</small>}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      {kind === "" ? null : (
        <fieldset className="champ">
          <legend>Model</legend>
          {lecture === "en-cours" ? (
            <output className="discret">Loading the {kind} catalog…</output>
          ) : erreurCatalogue !== null ? (
            <Avis ton="erreur">
              Unreadable {kind} catalog: {erreurCatalogue}
            </Avis>
          ) : catalogue === null || catalogue.models.length === 0 ? (
            <p className="discret">
              {catalogue?.error ?? `No verified catalog for ${kind}`} — the agent will start with
              its own defaults.
            </p>
          ) : (
            <>
              {kind === "pi" ? (
                <select
                  className="choix-liste"
                  aria-label="Provider"
                  value={fournisseur ?? ""}
                  onChange={(evenement) => {
                    setFournisseur(evenement.target.value || null);
                    setModele("");
                    setReflexion("");
                    setFiltre("");
                  }}
                >
                  <option value="">Pi's default model</option>
                  {fournisseurs.map((candidat) => (
                    <option key={candidat} value={candidat}>
                      {candidat}
                    </option>
                  ))}
                </select>
              ) : null}
              {filtreUtile(catalogue) && (kind !== "pi" || fournisseur !== null) ? (
                <input
                  type="search"
                  className="champ__filtre"
                  placeholder={`Filter ${String(catalogue.models.length)} models…`}
                  aria-label="Filter models"
                  value={filtre}
                  onChange={(evenement) => setFiltre(evenement.target.value)}
                />
              ) : null}
              {kind !== "pi" || fournisseur !== null ? (
                <div className="modeles">
                  <label className="modele">
                    <input
                      type="radio"
                      name="lancement-modele"
                      checked={modele === ""}
                      onChange={() => {
                        setModele("");
                        setReflexion("");
                      }}
                    />
                    <span>Agent default</span>
                  </label>
                  {visibles.slice(0, MAX_MODELES_AFFICHES).map((candidat) => (
                    <label key={candidat.id} className="modele">
                      <input
                        type="radio"
                        name="lancement-modele"
                        checked={modele === candidat.id}
                        onChange={() => setModele(candidat.id)}
                      />
                      <span>
                        {kind === "pi" && fournisseur !== null
                          ? candidat.id.slice(fournisseur.length + 1)
                          : (candidat.label ?? candidat.id)}
                      </span>
                      <span className="modele__id">{candidat.id}</span>
                    </label>
                  ))}
                  {filtre.length > 0 && visibles.length === 0 ? (
                    <p className="discret modele">No model contains “{filtre}”.</p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </fieldset>
      )}

      {choisi === undefined || choisi.thinkingLevels.length === 0 ? null : (
        <fieldset className="champ">
          <legend>Thinking</legend>
          <fieldset className="seg seg--plein" aria-label="Thinking level">
            <button type="button" aria-pressed={reflexion === ""} onClick={() => setReflexion("")}>
              Default
            </button>
            {choisi.thinkingLevels.map((niveau) => (
              <button
                key={niveau}
                type="button"
                aria-pressed={reflexion === niveau}
                onClick={() => setReflexion(niveau)}
              >
                {libelleReflexion(niveau)}
              </button>
            ))}
          </fieldset>
        </fieldset>
      )}

      {verdict.envoyable ? null : <Avis ton="erreur">{verdict.raison}</Avis>}
      {echec === null ? null : (
        <Avis ton="erreur" annonce="alerte">
          Launch failed: {echec}
        </Avis>
      )}
      {confiance === null ? null : <Confiance demande={confiance} />}
      {confiance !== null ? (
        <button
          type="button"
          className="bouton bouton--plein"
          onClick={() => onLance(confiance.paneId)}
        >
          Open the agent
        </button>
      ) : (
        <button
          type="button"
          className="bouton bouton--principal bouton--plein"
          disabled={!verdict.envoyable || lancement === "en-cours" || espace === "" || kind === ""}
          onClick={() => void lancer()}
        >
          {lancement === "en-cours" ? "Launching…" : "Launch in a new tab"}
        </button>
      )}
      <p className="discret">
        Herdr does not change the model of an agent already running; after launch, use the “Model
        and thinking” menu.
      </p>
    </Feuille>
  );
};
