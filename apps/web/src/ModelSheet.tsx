/**
 * Changement du modèle et du niveau de pensée d'un agent, depuis le téléphone.
 *
 * **Pourquoi.** Pi règle son modèle et sa pensée par des commandes
 * `/model …` et `/thinking …` tapées dans son éditeur. Depuis l'iPhone, les
 * taper à la main dans le composeur marche, mais personne ne les connaît
 * par cœur — et une faute de frappe part dans la conversation comme un
 * message ordinaire.
 *
 * **Mécanisme.**
 *
 * La feuille envoie la commande exacte **par le même chemin qu'un prompt**
 * (`POST /api/agents/:paneId/prompt`) : confirmation par Herdr, suppression
 * des doubles envois, événement de journal. Aucune capacité Herdr nouvelle
 * n'est invoquée.
 *
 * **Vérifié par exécution** (pane jetable, `scripts/test-agent.sh`) :
 *   - `/thinking low` envoyé via `agent.prompt` → la barre d'état de Pi passe
 *     de `high` à `low` ;
 *   - `/model openrouter/deepseek/deepseek-v4-flash` → le modèle affiché
 *     change dans la barre d'état de Pi.
 *
 * La confirmation affichée ici est celle de **la transmission** : l'agent
 * exécute la commande chez lui, on ne prétend pas contrôler son résultat.
 */
import { useEffect, useState } from "react";
import { fetchModelCatalog, reportError, sendPrompt } from "./api.ts";
import type { SendResult } from "./api.ts";
import type { ModelCatalogResponse } from "@herdr-remote/shared";
import type { AgentModel } from "@herdr-remote/shared";
import { Feuille } from "./Feuille.tsx";
import { Notice } from "./Notice.tsx";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Libellé lisible d'un niveau de pensée. */
export const thinkingLabel = (level: string): string => {
  switch (level) {
    case "off":
      return "désactivée";
    case "minimal":
      return "minimale";
    case "low":
      return "faible";
    case "medium":
      return "moyenne";
    case "high":
      return "élevée";
    case "xhigh":
      return "très élevée";
    case "max":
      return "maximale";
    default:
      return level;
  }
};

/**
 * Libellé d'un état d'envoi — utilisé par le composeur **et** par la feuille
 * modèle, pour qu'il n'existe qu'une seule formulation.
 */
export const describeSend = (result: SendResult): string => {
  if (result.kind === "sent") {
    return result.confirmation === "confirmed"
      ? "envoyé (confirmé par Herdr)"
      : "envoi effectué, confirmation incertaine — état inconnu";
  }
  if (result.kind === "suppressed") {
    return `double envoi supprimé — ${result.reason}`;
  }
  return `échec : ${result.message}`;
};

interface Props {
  readonly agentName: string;
  /** Type d'agent (`pi`, `claude`…) : c'est lui qui décide du catalogue. */
  readonly kind: string;
  readonly paneId: string;
  readonly onClose: () => void;
}

export const ModelSheet = ({ agentName, kind, paneId, onClose }: Props) => {
  /** Catalogue mesuré de cet agent, son absence comprise. */
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  /** Modèle choisi : il **pilote** les niveaux de pensée proposés. */
  const [chosen, setChosen] = useState<AgentModel | null>(null);
  /** Saisie libre : seulement quand le catalogue n'a rien donné. */
  const [modelPattern, setModelPattern] = useState("");
  /** Filtre sur la liste : les identifiants sont longs et innombrables. */
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchModelCatalog(kind);
        if (!cancelled) setCatalog(result);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (!cancelled) {
          setCatalogError(message);
          reportError("échec de lecture du catalogue de modèles", { kind, message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);
  /** Dernier envoi, commande comprise : on montre **ce qui** a été transmis. */
  const [lastSend, setLastSend] = useState<{
    readonly command: string;
    readonly result: SendResult;
  } | null>(null);
  /** Commande en vol : on désactive la feuille pendant l'envoi. */
  const [busy, setBusy] = useState(false);

  const apply = async (command: string) => {
    if (busy) return;
    setBusy(true);
    try {
      setLastSend({ command, result: await sendPrompt(paneId, command) });
    } catch (cause) {
      /*
        ⚠️ `sendPrompt` ne capture que les **réponses** illisibles : un `fetch`
        qui ne part pas (réseau coupé, serveur arrêté) lève, et rien ne
        s'afficherait. On montre la cause réelle plutôt que de laisser un
        bouton qui semble ne rien faire.
      */
      setLastSend({
        command,
        result: {
          kind: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
          state: "inconnu",
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Feuille
      ariaLabel={`Modèle et pensée de ${agentName}`}
      onClose={onClose}
      titre={
        <>
          Modèle et pensée
          <span className="muted small">{agentName}</span>
        </>
      }
    >
      {lastSend !== null ? (
        <p className="sendState">
          {busy ? (
            "envoi…"
          ) : (
            <>
              <code>{lastSend.command}</code> — {describeSend(lastSend.result)}
            </>
          )}
        </p>
      ) : null}

      <p className="muted small">
        Chaque réglage est envoyé à l'agent comme une commande qu'il exécute dans sa session.
      </p>

      {/*
        Modèle **d'abord**.

        Les identifiants sont longs et innombrables : `pi --list-models`
        renvoie `opencode-go/deepseek-v4.1-flash`, personne ne le retient. La
        saisie libre demandait de connaître le nom exact, et une faute de
        frappe partait dans la conversation comme un message ordinaire.
      */}
      <h3 className="model__title">Modèle</h3>

      {catalogError !== null ? (
        <Notice ton="erreur">
          Catalogue illisible pour <code>{kind}</code> — {catalogError}
        </Notice>
      ) : catalog === null ? (
        <p className="muted small">Lecture du catalogue…</p>
      ) : catalog.models.length === 0 ? (
        /*
          Aucune liste, et on ne la comble pas : la raison vient du serveur et
          est affichée telle quelle (AGENTS.md — « ne pas exposer un état qu'on
          ne peut pas vérifier »).
        */
        <Notice ton="avertissement">
          {catalog.error ?? "Ce type d'agent ne déclare pas ses modèles."} Source :{" "}
          <code>{catalog.source}</code>
        </Notice>
      ) : (
        <>
          <input
            type="search"
            className="model__search"
            value={filter}
            placeholder={`filtrer ${String(catalog.models.length)} modèles`}
            aria-label="Filtrer les modèles"
            onChange={(event) => setFilter(event.target.value)}
          />
          <ul className="model__list">
            {catalog.models
              .filter((model) => model.id.toLowerCase().includes(filter.trim().toLowerCase()))
              .map((model) => (
                <li key={model.id}>
                  <button
                    type="button"
                    className={
                      chosen?.id === model.id ? "model__pick model__pick--on" : "model__pick"
                    }
                    disabled={busy}
                    onClick={() => {
                      setChosen(model);
                      void apply(`/model ${model.id}`);
                    }}
                  >
                    <span className="model__pick-id">{model.id}</span>
                    {model.label !== undefined ? (
                      <span className="muted small">{model.label}</span>
                    ) : null}
                  </button>
                </li>
              ))}
          </ul>
          <p className="muted small">
            Liste venue de <code>{catalog.source}</code> — mesurée, pas écrite en dur.
          </p>
        </>
      )}

      {/*
        Saisie libre : seulement si le catalogue n'a rien fourni. Sinon elle
        ferait doublon avec une liste déjà présente.
      */}
      {catalog !== null && catalog.models.length === 0 ? (
        <div className="model__field">
          <input
            type="text"
            value={modelPattern}
            placeholder="identifiant du modèle"
            aria-label="Modèle à saisir"
            enterKeyHint="send"
            disabled={busy}
            onChange={(event) => setModelPattern(event.target.value)}
            onKeyDown={(event) => {
              const value = modelPattern.trim();
              if (event.key === "Enter" && value.length > 0) {
                event.preventDefault();
                void apply(`/model ${value}`);
              }
            }}
          />
          <button
            type="button"
            className="row__action row__action--primary"
            disabled={busy || modelPattern.trim().length === 0}
            onClick={() => void apply(`/model ${modelPattern.trim()}`)}
          >
            Changer
          </button>
        </div>
      ) : null}

      {/*
        Pensée **après** le modèle, et **filtrée par** lui.

        Le niveau supporté dépend du modèle : `AgentModel` expose
        `thinkingLevels` par modèle précisément pour cela. Proposer « max » à un
        modèle qui ne l'a pas, c'est envoyer une commande que l'agent refuse.
      */}
      <h3 className="model__title">Niveau de pensée</h3>
      {chosen === null ? (
        <p className="muted small">
          Choisissez d'abord un modèle : les niveaux proposés dépendent de celui-ci.
        </p>
      ) : (
        <>
          <p className="muted small">
            Pour <code>{chosen.id}</code>. Commande : <code>/thinking &lt;niveau&gt;</code>.
          </p>
          <div className="model__chips">
            {chosen.thinkingLevels.map((level) => (
              <button
                key={level}
                type="button"
                className="model__chip"
                disabled={busy}
                onClick={() => void apply(`/thinking ${level}`)}
              >
                {thinkingLabel(level)}
              </button>
            ))}
          </div>
        </>
      )}
    </Feuille>
  );
};
