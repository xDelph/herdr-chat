/**
 * Le journal d'activité, rendu lisible (A02).
 *
 * **Déplacement seul.** Ces deux fonctions vivaient au milieu de `App.tsx`, dans
 * un fichier de neuf cents lignes, et n'étaient testées nulle part : leur
 * comportement — « ne jamais montrer un identifiant de pane », « ne jamais
 * montrer du JSON brut » — était donc garanti par la relecture, pas par une
 * exécution. Elles sortent ici pour être testées.
 *
 * ⚠️ La règle du nom est une règle de **confidentialité autant que de
 * lisibilité** : `w8:p1` ne dit rien, et un identifiant brut à l'écran apprend
 * quelque chose de la topologie de la machine à quiconque regarde par-dessus
 * l'épaule.
 */
import { Option, Schema } from "effect";
import type { AgentView } from "./api.ts";
import { AgentStatus } from "@herdr-remote/shared";
import { agentName, statusLabel } from "./labels.tsx";

/**
 * Table `paneId → nom lisible`.
 *
 * Sert partout où un identifiant de pane apparaît — y compris dans le journal
 * d'activité, qui affichait `w8:p1` au lieu du nom du projet.
 */
export const nameByPane = (agents: ReadonlyArray<AgentView>): ReadonlyMap<string, string> =>
  new Map(agents.map((agent) => [agent.paneId, agentName(agent)]));

/** Rend un événement du flux lisible, sans JSON brut à l'écran. */
export const describeEvent = (
  kind: string,
  data: unknown,
  names: ReadonlyMap<string, string>,
): string => {
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      Schema.Struct({
        from: Schema.optional(Schema.NullOr(AgentStatus)),
        kind: Schema.optional(Schema.String),
        paneId: Schema.optional(Schema.String),
        reason: Schema.optional(Schema.String),
        status: Schema.optional(Schema.String),
        text: Schema.optional(Schema.String),
        to: Schema.optional(Schema.NullOr(AgentStatus)),
      }),
    )(data),
  );

  // Une charge utile qu'on ne sait pas lire ne s'invente pas : on rend le nom de
  // l'événement, qui est déjà exploitable. Recharger le JSON serait pire.
  if (decoded === undefined) return kind;

  // Un identifiant de pane n'apprend rien : on affiche le nom du projet quand
  // on le connaît, et un libellé neutre sinon — **jamais** l'identifiant.
  const raw = decoded.paneId ?? "";
  const label = raw.length > 0 ? (names.get(raw) ?? "un agent") : "un agent";

  if (kind === "agent_status") {
    switch (decoded.kind) {
      case "appeared":
        return `${label} — agent lancé`;
      case "disappeared":
        return `${label} — agent arrêté`;
      default:
        return `${label} — ${statusLabel(decoded.from ?? "unknown")} → ${statusLabel(decoded.to ?? "unknown")}`;
    }
  }

  if (kind === "prompt") return `message envoyé à ${label}`;
  if (kind === "prompt-suppressed") return `double envoi supprimé pour ${label}`;
  if (kind === "agent-launched") return `${label} — agent lancé (${decoded.kind ?? ""})`;
  if (kind === "resync") return "journal tronqué — rechargement complet";
  return kind;
};
