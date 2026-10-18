// Généré par `cargo xtask contracts export` — ne pas éditer.
// Source : contracts.schema.json (61 définitions).
// Schemas Effect : le client décode avec EUX, comme le serveur sérialise avec le contrat.
import { Schema } from "effect";

/** Un focus appliqué (`AgentFocusedResponse`). */
export const AgentFocusedResponse = Schema.Struct({
  "focused": Schema.Boolean,
  "status": Schema.Literals(["agent-focused"]),
});
export type AgentFocusedResponse = typeof AgentFocusedResponse.Type;

/** Un agent lancé (`event: agent-launched`, mesuré — */
export const AgentLaunched = Schema.Struct({
  "kind": Schema.String,
  "paneId": Schema.String,
  "workspaceId": Schema.String,
});
export type AgentLaunched = typeof AgentLaunched.Type;

/** Un modèle d'agent (`AgentModel`). */
export const AgentModel = Schema.Struct({
  "id": Schema.String,
  "label": Schema.optional(Schema.String),
  "thinkingLevels": Schema.Array(Schema.String),
});
export type AgentModel = typeof AgentModel.Type;

/** État d'un agent : `idle | working | blocked | done | unknown`. */
export const AgentStatus = Schema.Literals(["idle", "working", "blocked", "done", "unknown"]);
export type AgentStatus = typeof AgentStatus.Type;

/** Un état d'agent a changé (`event: agent_status`, mesuré — */
export const AgentStatusChanged = Schema.Struct({
  "from": Schema.NullOr(Schema.String),
  "kind": Schema.Literals(["status", "appeared", "disappeared"]),
  "paneId": Schema.String,
  "to": Schema.String,
});
export type AgentStatusChanged = typeof AgentStatusChanged.Type;

/** Une ligne d'agent de l'overview (homologue exact de `AgentViewSchema`) : */
export const AgentView = Schema.Struct({
  "agent": Schema.NullOr(Schema.String),
  "cwd": Schema.NullOr(Schema.String),
  "focused": Schema.Boolean,
  "name": Schema.NullOr(Schema.String),
  "paneId": Schema.String,
  "paneRank": Schema.NullOr(Schema.Number),
  "parentSession": Schema.NullOr(Schema.String),
  "sessionCwd": Schema.NullOr(Schema.String),
  "sessionCwdMatches": Schema.NullOr(Schema.Boolean),
  "sessionId": Schema.NullOr(Schema.String),
  "sessionKind": Schema.NullOr(Schema.Literals(["id", "path"])),
  "sessionPath": Schema.NullOr(Schema.String),
  "status": Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
  "tabId": Schema.String,
  "tabLabel": Schema.NullOr(Schema.String),
  "tabNumber": Schema.NullOr(Schema.Number),
  "tabPaneCount": Schema.Number,
  "title": Schema.NullOr(Schema.String),
  "workspaceId": Schema.String,
  "workspaceLabel": Schema.NullOr(Schema.String),
});
export type AgentView = typeof AgentView.Type;

/** Le corps de réponse à une question (`AnswerBody`, mesuré) — `texte` est */
export const AnswerRequest = Schema.Struct({
  "numero": Schema.Number,
  "texte": Schema.optional(Schema.String),
});
export type AnswerRequest = typeof AnswerRequest.Type;

/** L'union fermée des états d'une réponse. */
export const AnswerState = Schema.Literals(["appliquee", "transmise", "refusee"]);
export type AnswerState = typeof AnswerState.Type;

/** `ApiErrorResponse` (api.ts) : le message réel, un indicateur optionnel, */
export const ApiErrorResponse = Schema.Struct({
  "cause": Schema.optional(Schema.Literals(["absente", "vide", "invalide", "io"])),
  "error": Schema.String,
  "hint": Schema.optional(Schema.String),
});
export type ApiErrorResponse = typeof ApiErrorResponse.Type;

/** Le genre de changement d'état, union fermée mesurée d'AgentWatcher */
export const ChangeKind = Schema.Literals(["status", "appeared", "disappeared"]);
export type ChangeKind = typeof ChangeKind.Type;

/** Un choix proposé (`Choix` de api.ts/question.ts) — les noms du fil */
export const Choice = Schema.Struct({
  "detail": Schema.optional(Schema.String),
  "libelle": Schema.String,
  "numero": Schema.Number,
  "selectionne": Schema.Boolean,
});
export type Choice = typeof Choice.Type;

/** Le corps de log client (inline mesuré Api.ts) : niveau **fermé sur */
export const ClientLogRequest = Schema.Struct({
  "detail": Schema.optional(Schema.Unknown),
  "level": Schema.Literals(["error"]),
  "message": Schema.String,
});
export type ClientLogRequest = typeof ClientLogRequest.Type;

/** L'acquittement du log — le `{ok}` du fil : un booléen réel, pas un */
export const ClientLogResponse = Schema.Struct({
  "ok": Schema.Boolean,
});
export type ClientLogResponse = typeof ClientLogResponse.Type;

/** L'union fermée de confirmation du fil (`"confirmed" | "unknown"`). */
export const Confirmation = Schema.Literals(["confirmed", "unknown"]);
export type Confirmation = typeof Confirmation.Type;

/** Le résumé d'une conversation (`ConversationSummary`) — tout ce que la */
export const ConversationSummary = Schema.Struct({
  "agent": Schema.NullOr(Schema.String),
  "branch": Schema.optional(Schema.String),
  "lastPrompt": Schema.optional(Schema.String),
  "model": Schema.optional(Schema.String),
  "name": Schema.NullOr(Schema.String),
  "paneId": Schema.String,
  "paneRank": Schema.NullOr(Schema.Number),
  "preview": Schema.optional(Schema.String),
  "provider": Schema.optional(Schema.String),
  "question": Schema.optional(Schema.Struct({
  "choix": Schema.Array(Schema.Struct({
  "detail": Schema.optional(Schema.String),
  "libelle": Schema.String,
  "numero": Schema.Number,
  "selectionne": Schema.Boolean,
})),
  "contexte": Schema.Array(Schema.String),
  "invite": Schema.optional(Schema.String),
  "texte": Schema.String,
})),
  "sessionState": Schema.Literals(["available", "absent", "error"]),
  "status": Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
  "tabId": Schema.String,
  "tabPaneCount": Schema.Number,
  "thinking": Schema.optional(Schema.String),
  "timestamp": Schema.optional(Schema.Number),
  "title": Schema.String,
  "trust": Schema.optional(Schema.Struct({
  "folder": Schema.String,
  "kind": Schema.String,
  "message": Schema.String,
  "paneId": Schema.String,
  "status": Schema.Literals(["trust-required"]),
})),
  "waiting": Schema.optional(Schema.String),
  "workspaceId": Schema.String,
});
export type ConversationSummary = typeof ConversationSummary.Type;

/** La réponse conversations (`ConversationsResponse`). */
export const ConversationsResponse = Schema.Struct({
  "conversations": Schema.Array(Schema.Struct({
  "agent": Schema.NullOr(Schema.String),
  "branch": Schema.optional(Schema.String),
  "lastPrompt": Schema.optional(Schema.String),
  "model": Schema.optional(Schema.String),
  "name": Schema.NullOr(Schema.String),
  "paneId": Schema.String,
  "paneRank": Schema.NullOr(Schema.Number),
  "preview": Schema.optional(Schema.String),
  "provider": Schema.optional(Schema.String),
  "question": Schema.optional(Schema.Struct({
  "choix": Schema.Array(Schema.Struct({
  "detail": Schema.optional(Schema.String),
  "libelle": Schema.String,
  "numero": Schema.Number,
  "selectionne": Schema.Boolean,
})),
  "contexte": Schema.Array(Schema.String),
  "invite": Schema.optional(Schema.String),
  "texte": Schema.String,
})),
  "sessionState": Schema.Literals(["available", "absent", "error"]),
  "status": Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
  "tabId": Schema.String,
  "tabPaneCount": Schema.Number,
  "thinking": Schema.optional(Schema.String),
  "timestamp": Schema.optional(Schema.Number),
  "title": Schema.String,
  "trust": Schema.optional(Schema.Struct({
  "folder": Schema.String,
  "kind": Schema.String,
  "message": Schema.String,
  "paneId": Schema.String,
  "status": Schema.Literals(["trust-required"]),
})),
  "waiting": Schema.optional(Schema.String),
  "workspaceId": Schema.String,
})),
});
export type ConversationsResponse = typeof ConversationsResponse.Type;

/** L'enveloppe SSE entière — `{"event": nom, "data": charge}` telle que la */
export const EvenementSse = Schema.Union([Schema.Struct({
  "data": Schema.Struct({
  "cursor": Schema.Number,
}),
  "event": Schema.Literal("ready"),
}), Schema.Struct({
  "data": Schema.Struct({
  "from": Schema.NullOr(Schema.String),
  "kind": Schema.Literals(["status", "appeared", "disappeared"]),
  "paneId": Schema.String,
  "to": Schema.String,
}),
  "event": Schema.Literal("agent_status"),
}), Schema.Struct({
  "data": Schema.Struct({
  "confirmation": Schema.Literals(["confirmed", "unknown"]),
  "fingerprint": Schema.String,
  "paneId": Schema.String,
  "status": Schema.Literals(["sent"]),
}),
  "event": Schema.Literal("prompt"),
}), Schema.Struct({
  "data": Schema.Struct({
  "paneId": Schema.String,
  "reason": Schema.String,
}),
  "event": Schema.Literal("prompt-suppressed"),
}), Schema.Struct({
  "data": Schema.Struct({
  "kind": Schema.String,
  "paneId": Schema.String,
  "workspaceId": Schema.String,
}),
  "event": Schema.Literal("agent-launched"),
}), Schema.Struct({
  "data": Schema.Struct({
  "paneId": Schema.String,
  "path": Schema.NullOr(Schema.String),
}),
  "event": Schema.Literal("session_changed"),
}), Schema.Struct({
  "data": Schema.Struct({
  "reason": Schema.String,
  "resumeFrom": Schema.Number,
}),
  "event": Schema.Literal("resync"),
})]);
export type EvenementSse = typeof EvenementSse.Type;

/** Le littéral `"agent-focused"` — union à un membre. */
export const FocusStatus = Schema.Literals(["agent-focused"]);
export type FocusStatus = typeof FocusStatus.Type;

/** La santé du service (mesurée sur `HealthResponse` de api.ts). */
export const HealthResponse = Schema.Struct({
  "herdr": Schema.Struct({
  "protocol": Schema.optional(Schema.Number),
  "reachable": Schema.Boolean,
  "socket": Schema.String,
  "version": Schema.optional(Schema.String),
}),
  "log": Schema.optional(Schema.String),
  "ok": Schema.Boolean,
  "uptimeMs": Schema.optional(Schema.Number),
});
export type HealthResponse = typeof HealthResponse.Type;

/** La partie Herdr de la santé — protocol/version **omissibles** (mesuré : */
export const HerdrHealth = Schema.Struct({
  "protocol": Schema.optional(Schema.Number),
  "reachable": Schema.Boolean,
  "socket": Schema.String,
  "version": Schema.optional(Schema.String),
});
export type HerdrHealth = typeof HerdrHealth.Type;

/** Un type d'agent installé sur la machine (`InstalledKind`). */
export const InstalledKind = Schema.Struct({
  "kind": Schema.String,
  "label": Schema.String,
  "state": Schema.String,
});
export type InstalledKind = typeof InstalledKind.Type;

/** La liste des types installés (`InstalledKindsResponse`). */
export const InstalledKindsResponse = Schema.Struct({
  "kinds": Schema.Array(Schema.Struct({
  "kind": Schema.String,
  "label": Schema.String,
  "state": Schema.String,
})),
});
export type InstalledKindsResponse = typeof InstalledKindsResponse.Type;

/** Le corps de lancement (`LaunchAgentRequest`) — tout est omissible sauf le */
export const LaunchAgentRequest = Schema.Struct({
  "kind": Schema.String,
  "model": Schema.optional(Schema.String),
  "name": Schema.optional(Schema.String),
  "provider": Schema.optional(Schema.String),
  "thinking": Schema.optional(Schema.String),
});
export type LaunchAgentRequest = typeof LaunchAgentRequest.Type;

/** Un lancement réussi (`LaunchAgentResponse`) — 201 sur le fil. */
export const LaunchAgentResponse = Schema.Struct({
  "kind": Schema.String,
  "name": Schema.String,
  "paneId": Schema.String,
  "status": Schema.Literals(["started"]),
  "tabId": Schema.String,
});
export type LaunchAgentResponse = typeof LaunchAgentResponse.Type;

/** L'échec typé du lancement (`LaunchFailed`) — le pane peut exister déjà : */
export const LaunchFailed = Schema.Struct({
  "detail": Schema.String,
  "paneId": Schema.NullOr(Schema.String),
  "phase": Schema.Literals(["validation", "onglet", "agent", "detection"]),
});
export type LaunchFailed = typeof LaunchFailed.Type;

/** L'étape d'un lancement qui a coincé, union fermée mesurée */
export const LaunchPhase = Schema.Literals(["validation", "onglet", "agent", "detection"]);
export type LaunchPhase = typeof LaunchPhase.Type;

/** Le catalogue d'un type (`ModelCatalogResponse`) — `error` est **nullable */
export const ModelCatalogResponse = Schema.Struct({
  "error": Schema.NullOr(Schema.String),
  "kind": Schema.String,
  "models": Schema.Array(Schema.Struct({
  "id": Schema.String,
  "label": Schema.optional(Schema.String),
  "thinkingLevels": Schema.Array(Schema.String),
})),
  "source": Schema.String,
  "thinkingLevels": Schema.Array(Schema.String),
});
export type ModelCatalogResponse = typeof ModelCatalogResponse.Type;

/** La réponse d'overview complète. */
export const OverviewResponse = Schema.Struct({
  "agents": Schema.Array(Schema.Struct({
  "agent": Schema.NullOr(Schema.String),
  "cwd": Schema.NullOr(Schema.String),
  "focused": Schema.Boolean,
  "name": Schema.NullOr(Schema.String),
  "paneId": Schema.String,
  "paneRank": Schema.NullOr(Schema.Number),
  "parentSession": Schema.NullOr(Schema.String),
  "sessionCwd": Schema.NullOr(Schema.String),
  "sessionCwdMatches": Schema.NullOr(Schema.Boolean),
  "sessionId": Schema.NullOr(Schema.String),
  "sessionKind": Schema.NullOr(Schema.Literals(["id", "path"])),
  "sessionPath": Schema.NullOr(Schema.String),
  "status": Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
  "tabId": Schema.String,
  "tabLabel": Schema.NullOr(Schema.String),
  "tabNumber": Schema.NullOr(Schema.Number),
  "tabPaneCount": Schema.Number,
  "title": Schema.NullOr(Schema.String),
  "workspaceId": Schema.String,
  "workspaceLabel": Schema.NullOr(Schema.String),
})),
  "herdrProtocol": Schema.Number,
  "herdrVersion": Schema.String,
  "withoutSession": Schema.Number,
  "workspaces": Schema.Array(Schema.Struct({
  "agentPanes": Schema.Array(Schema.String),
  "agentStatus": Schema.NullOr(Schema.Literals(["idle", "working", "blocked", "done", "unknown"])),
  "checkoutPath": Schema.NullOr(Schema.String),
  "focused": Schema.Boolean,
  "label": Schema.NullOr(Schema.String),
  "paneCount": Schema.Number,
  "tabCount": Schema.Number,
  "workspaceId": Schema.String,
})),
});
export type OverviewResponse = typeof OverviewResponse.Type;

/** La confirmation d'un prompt livré (`event: prompt`, mesuré — */
export const PromptDelivered = Schema.Struct({
  "confirmation": Schema.Literals(["confirmed", "unknown"]),
  "fingerprint": Schema.String,
  "paneId": Schema.String,
  "status": Schema.Literals(["sent"]),
});
export type PromptDelivered = typeof PromptDelivered.Type;

/** Un prompt qui n'est pas parti — l'état réel, nommé, avec son détail. */
export const PromptFailedResponse = Schema.Struct({
  "detail": Schema.String,
  "state": Schema.Literals(["attente", "erreur", "inconnu"]),
});
export type PromptFailedResponse = typeof PromptFailedResponse.Type;

/** Le corps d'un prompt (`PromptBody`, mesuré — `{ text }`). */
export const PromptRequest = Schema.Struct({
  "text": Schema.String,
});
export type PromptRequest = typeof PromptRequest.Type;

/** Un prompt parti (confirmé ou non prouvé — A02 : deux états sur le fil, */
export const PromptSentResponse = Schema.Struct({
  "confirmation": Schema.Literals(["confirmed", "unknown"]),
  "fingerprint": Schema.String,
  "status": Schema.Literals(["sent"]),
});
export type PromptSentResponse = typeof PromptSentResponse.Type;

/** L'état d'un prompt, tel qu'annoncé sur le flux — l'union fermée du fil */
export const PromptStatus = Schema.Literals(["sent"]);
export type PromptStatus = typeof PromptStatus.Type;

/** Un double envoi assumé (`event: prompt-suppressed`, mesuré — */
export const PromptSuppressed = Schema.Struct({
  "paneId": Schema.String,
  "reason": Schema.String,
});
export type PromptSuppressed = typeof PromptSuppressed.Type;

/** Un prompt supprimé — double envoi assumé, pas une erreur (D007.2). */
export const PromptSuppressedResponse = Schema.Struct({
  "reason": Schema.String,
  "status": Schema.Literals(["suppressed"]),
});
export type PromptSuppressedResponse = typeof PromptSuppressedResponse.Type;

/** L'union **du corps de la route push** : le désabonnement est essayé */
export const PushBody = Schema.Union([Schema.Struct({
  "unsubscribe": Schema.String,
}), Schema.Struct({
  "endpoint": Schema.String,
  "expirationTime": Schema.optional(Schema.NullOr(Schema.Number)),
  "keys": Schema.Struct({
  "auth": Schema.String,
  "p256dh": Schema.String,
}),
})]);
export type PushBody = typeof PushBody.Type;

/** Le contenu d'une notification, tel que le navigateur le reçoit. */
export const PushPayload = Schema.Struct({
  "body": Schema.String,
  "tag": Schema.String,
  "title": Schema.String,
  "url": Schema.String,
});
export type PushPayload = typeof PushPayload.Type;

/** Une question posée par un agent (`Question`) — contexte en tableau */
export const Question = Schema.Struct({
  "choix": Schema.Array(Schema.Struct({
  "detail": Schema.optional(Schema.String),
  "libelle": Schema.String,
  "numero": Schema.Number,
  "selectionne": Schema.Boolean,
})),
  "contexte": Schema.Array(Schema.String),
  "invite": Schema.optional(Schema.String),
  "texte": Schema.String,
});
export type Question = typeof Question.Type;

/** Une question tranchée (`QuestionAnsweredResponse`) — libellés du fil */
export const QuestionAnsweredResponse = Schema.Struct({
  "detail": Schema.String,
  "state": Schema.Literals(["appliquee", "transmise", "refusee"]),
  "status": Schema.Literals(["question-answered"]),
});
export type QuestionAnsweredResponse = typeof QuestionAnsweredResponse.Type;

/** Cause d'une réponse de session : `absente | vide | invalide | io`. */
export const ReadCause = Schema.Literals(["absente", "vide", "invalide", "io"]);
export type ReadCause = typeof ReadCause.Type;

/** Source d'une lecture de terminal — libellés exacts du fil. */
export const ReadSource = Schema.Literals(["visible", "recent", "recent_unwrapped", "detection"]);
export type ReadSource = typeof ReadSource.Type;

/** Le signal de vie : le flux est établi, voici le curseur de départ */
export const Ready = Schema.Struct({
  "cursor": Schema.Number,
});
export type Ready = typeof Ready.Type;

/** Une image récente (`RecentImageSchema`) — millisecondes mesurées, jamais */
export const RecentImage = Schema.Struct({
  "modifiedAt": Schema.Number,
  "path": Schema.String,
  "size": Schema.Number,
});
export type RecentImage = typeof RecentImage.Type;

/** La réponse d'images récentes (`RecentImagesResponse`). */
export const RecentImagesResponse = Schema.Struct({
  "images": Schema.Array(Schema.Struct({
  "modifiedAt": Schema.Number,
  "path": Schema.String,
  "size": Schema.Number,
})),
});
export type RecentImagesResponse = typeof RecentImagesResponse.Type;

/** L'ordre de resynchronisation : la continuité du journal n'est plus */
export const Resync = Schema.Struct({
  "reason": Schema.String,
  "resumeFrom": Schema.Number,
});
export type Resync = typeof Resync.Type;

/** L'union fermée des états d'un envoi non parti (libellés du fil exacts). */
export const SendState = Schema.Literals(["attente", "erreur", "inconnu"]);
export type SendState = typeof SendState.Type;

/** La source de session d'un pane a changé (`event: session_changed`) — */
export const SessionChanged = Schema.Struct({
  "paneId": Schema.String,
  "path": Schema.NullOr(Schema.String),
});
export type SessionChanged = typeof SessionChanged.Type;

/** Une entrée de session **rendue au client** : la ligne brute entière, plus */
export const SessionEntry = Schema.Struct({
  "id": Schema.optional(Schema.String),
  "parentId": Schema.optional(Schema.NullOr(Schema.String)),
  "raw": Schema.String,
  "timestamp": Schema.optional(Schema.String),
  "type": Schema.String,
});
export type SessionEntry = typeof SessionEntry.Type;

/** Genre de la référence de session publiée par Herdr pour un agent. */
export const SessionRefKind = Schema.Literals(["id", "path"]);
export type SessionRefKind = typeof SessionRefKind.Type;

/** La réponse de session : quatre clauses nommées du fil (l'union */
export const SessionResponse = Schema.Struct({
  "caughtUp": Schema.optional(Schema.Boolean),
  "cause": Schema.Literals(["absente", "vide", "invalide", "io"]),
  "cursor": Schema.optional(Schema.String),
  "entries": Schema.Array(Schema.Struct({
  "id": Schema.optional(Schema.String),
  "parentId": Schema.optional(Schema.NullOr(Schema.String)),
  "raw": Schema.String,
  "timestamp": Schema.optional(Schema.String),
  "type": Schema.String,
})),
  "hasMore": Schema.Boolean,
  "incremental": Schema.Boolean,
  "previousCursor": Schema.optional(Schema.String),
  "reset": Schema.Boolean,
  "sessionPath": Schema.String,
});
export type SessionResponse = typeof SessionResponse.Type;

/** État de la conversation visible sur une ligne de conversation */
export const SessionState = Schema.Literals(["available", "absent", "error"]);
export type SessionState = typeof SessionState.Type;

/** Une interruption demandée (`StopAgentResponse`). */
export const StopAgentResponse = Schema.Struct({
  "status": Schema.Literals(["interrupt-sent", "not-running"]),
});
export type StopAgentResponse = typeof StopAgentResponse.Type;

/** L'union fermée des résultats d'arrêt. */
export const StopStatus = Schema.Literals(["interrupt-sent", "not-running"]);
export type StopStatus = typeof StopStatus.Type;

/** Le corps d'abonnement (inline mesuré) — `expirationTime` omissible ET */
export const SubscribeRequest = Schema.Struct({
  "endpoint": Schema.String,
  "expirationTime": Schema.optional(Schema.NullOr(Schema.Number)),
  "keys": Schema.Struct({
  "auth": Schema.String,
  "p256dh": Schema.String,
}),
});
export type SubscribeRequest = typeof SubscribeRequest.Type;

/** Les deux clefs d'identité d'un abonnement (inline mesuré) — `auth` puis */
export const SubscriptionKeys = Schema.Struct({
  "auth": Schema.String,
  "p256dh": Schema.String,
});
export type SubscriptionKeys = typeof SubscriptionKeys.Type;

/** Le corps d'acceptation de confiance (`TrustBody`, mesuré — `{ accept }`). */
export const TrustRequest = Schema.Struct({
  "accept": Schema.Boolean,
});
export type TrustRequest = typeof TrustRequest.Type;

/** La confiance exigée avant d'agir (`TrustRequiredResponse`). */
export const TrustRequiredResponse = Schema.Struct({
  "folder": Schema.String,
  "kind": Schema.String,
  "message": Schema.String,
  "paneId": Schema.String,
  "status": Schema.Literals(["trust-required"]),
});
export type TrustRequiredResponse = typeof TrustRequiredResponse.Type;

/** La confiance tranchée (`TrustResolvedResponse`) — les libellés français */
export const TrustResolvedResponse = Schema.Struct({
  "accepted": Schema.Boolean,
  "state": Schema.Literals(["transmise", "acceptee", "refusee", "non-applicable"]),
  "status": Schema.Literals(["trust-resolved"]),
});
export type TrustResolvedResponse = typeof TrustResolvedResponse.Type;

/** L'union fermée des états de confiance (`transmise | acceptee | refusee | */
export const TrustState = Schema.Literals(["transmise", "acceptee", "refusee", "non-applicable"]);
export type TrustState = typeof TrustState.Type;

/** Le corps de désabonnement (inline mesuré — `{ unsubscribe: endpoint }`). */
export const UnsubscribeRequest = Schema.Struct({
  "unsubscribe": Schema.String,
});
export type UnsubscribeRequest = typeof UnsubscribeRequest.Type;

/** Une ligne de workspace de l'overview (homologue de `WorkspaceViewSchema`). */
export const WorkspaceView = Schema.Struct({
  "agentPanes": Schema.Array(Schema.String),
  "agentStatus": Schema.NullOr(Schema.Literals(["idle", "working", "blocked", "done", "unknown"])),
  "checkoutPath": Schema.NullOr(Schema.String),
  "focused": Schema.Boolean,
  "label": Schema.NullOr(Schema.String),
  "paneCount": Schema.Number,
  "tabCount": Schema.Number,
  "workspaceId": Schema.String,
});
export type WorkspaceView = typeof WorkspaceView.Type;
