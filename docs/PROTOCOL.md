# Herdr Remote — PROTOCOLE (vérité terrain)

> Document de travail. **Chaque affirmation est étiquetée par son mode de preuve.**
>
> - `[EXÉCUTÉ]` — observé en lançant la commande, sortie réelle
> - `[SCHÉMA]` — lu dans le schéma JSON officiel (`herdr api schema --json`)
> - `[DOC]` — lu dans la documentation officielle
> - `[INCONNU]` — **non vérifié**, ne pas supposer
>
> Relevé du **2026-10-09**. `herdr 0.9.3` · `private_protocol 22` · `schema_version 1` · `pi 1.1.0` · session Pi `version: 3`
>
> **Revu par une passe de vérification indépendante sans contexte** (même modèle, `docs/DECISIONS.md` D006). 71 affirmations contrôlées, 12 problèmes corrigés, 23 omissions ajoutées. Les corrections issues de cette passe sont marquées **[corrigé v2]**.

---

## 0. Les quatre conclusions qui changent le plan

1. **`session.snapshot` est la source de la fonctionnalité MVP n°1.** Le spec §4 exige « Accueil / état global : projets, workspaces, agents actifs/terminés/bloqués, dernière activité ». `SessionSnapshot` contient `workspaces[]`, `tabs[]`, `panes[]`, `layouts[]`, `agents[]`, plus `protocol` et `version`. `WorkspaceInfo` porte `agent_status`, `pane_count`, `tab_count`, `tokens`, `label`. **Il ne faut pas reconstruire cette vue en itérant `agent.list`.**
2. **Herdr expose déjà le chemin exact du fichier de session de chaque agent.** `AgentInfo.agent_session = { source, agent, kind: "id"|"path", value }`. Rien à deviner. Le producteur est même documenté : `pane.report_agent_session`.
3. **`agent.prompt` n'expose aucune clé d'idempotence.** Le spec §5 exige « actions idempotentes, pas d'envoi doublon ». `AgentPromptParams` = `{ target, text, wait }` — `id` est un identifiant de **corrélation**, pas de déduplication. Cette exigence du spec **n'est pas satisfaite par l'API** : elle devra être implémentée côté Herdr Remote.
4. **`parentId` dans une session Pi est un branchement de conversation, jamais un sous-agent.** Confirmé deux fois (`grep -riE 'sub-?agent'` sur toute la doc Pi → **0 occurrence**). Aucune source d'arborescence de sous-agents n'a été identifiée.

---

## 1. Les trois couches (ne pas les confondre)

| Couche | Quoi | Socket / emplacement |
|---|---|---|
| **A — Herdr Socket API** | Le multiprocesseur : workspaces, panes, agents, événements, injection de prompt | `~/.config/herdr/herdr.sock` `[EXÉCUTÉ]` |
| **B — Herdr Agent Bus** (`herdr-agentd`) | Bus de messages agent→agent (`HELLO`/`MESSAGE`/`EVENT`/`LIST`/`LEAD`) | socket du fichier d'état ; `/tmp/herdr-agent.sock` n'est **que la valeur par défaut du CLI** `[DOC]` |
| **C — Sessions Pi** | Historique structuré JSONL, **lecture seule** | `~/.pi/agent/sessions/--<projet>--/<ts>_<id>.jsonl` `[EXÉCUTÉ]` |

Le backend MVP a besoin de **A et C**. **B est optionnel** (V2).

⚠️ Le spec §2 dit « Herdr : API locale Unix socket JSONL + events.subscribe » — c'est bien la couche A, mais le spec ne dit pas que le repo `herdr-agent` documente **un protocole différent** (couche B). Confondre les deux est l'erreur d'architecture la plus probable.

---

## 2. Couche A — Herdr Socket API

### 2.1 Endpoint `[EXÉCUTÉ]`

```
$ herdr status server
status: running
version: 0.9.3
endpoint_compatible: yes
private_protocol: 22
private_protocol_compatible: yes
socket: /Users/thomas.delalonde/.config/herdr/herdr.sock
```

- Chemin disponible dans `HERDR_SOCKET_PATH`. Socket en `srw-------`.
- **`endpoint_compatible` est le premier niveau de validation, avant `private_protocol`.** Les deux doivent être vérifiés au démarrage. **[corrigé v2]**

### 2.2 Transport `[EXÉCUTÉ]`

**JSON délimité par `\n` (newline-delimited) : un objet JSON par ligne.** Vérifié sur le socket réel :

```
$ printf '{"id":"v1","method":"ping","params":{}}\n' | nc -U ~/.config/herdr/herdr.sock
{"id":"v1","result":{"type":"pong","version":"0.9.3","protocol":22,"capabilities":{...}}}
```

**[corrigé v2]** — c'est un fait de **transport**, pas de schéma : le schéma ne décrit que des objets isolés.

`capabilities` de `ping` : `live_handoff` (seul requis), `health_check`, `surface_interest`, `ssh_agent_registration`, `detached_server_daemon`, `endpoint_protocol_generation`. C'est la vraie surface de négociation de fonctionnalités. **[corrigé v2 — ajout]**

### 2.3 Enveloppe requête / réponse `[SCHÉMA]`

Requête :

```json
{ "id": "<optionnel>", "method": "<nom>", "params": { } }
```

- Le discriminant est **`method`** (et non `command` ni `op`).
- **`method` et `params` sont REQUIS sur toutes les requêtes.** `params` l'est même quand il est vide (`{}`). **[corrigé v2]**
- `id` est optionnel **à l'émission**, mais **`id` est requis dans les deux réponses**.

Réponses, discriminées par la présence de `result` ou `error` :

```json
{ "id": "...", "result": { "type": "…", … } }
{ "id": "...", "error":  { "code": "...", "message": "..." } }
```

`success_response.required = [id, result]` · `error_response.required = [id, error]` · `ErrorBody.required = [code, message]`.

**102 méthodes** au total. Les 15 utiles au MVP :

| Méthode | Params | `result.type` |
|---|---|---|
| `session.snapshot` | `{}` | `session_snapshot` |
| `ping` | `{}` | `pong` |
| `agent.list` | `{}` | `agent_list` |
| `agent.get` | `{ target }` | `agent_info` |
| `agent.read` | `{ target, source, format?, lines?, strip_ansi? }` | **`pane_read`** **[corrigé v2]** |
| `agent.explain` | `{ target }` | `agent_explain` |
| `agent.prompt` | `{ target, text, wait? }` | `agent_prompted` |
| `agent.wait` | `{ target, timeout_ms?, until? }` | — |
| `agent.send_keys` | `{ target, keys[] }` | — |
| `agent.rename` | `{ target, name? }` | — |
| `agent.focus` | `{ target }` | — |
| `agent.start` | `{ name, kind, pane_id, args?, timeout_ms? }` | `agent_started` |
| `agent.view.set` | **`{ source, filter?, label?, sort? }`** | `agent_view` **[corrigé v2]** |
| `agent.view.clear` | `{ source? }` | `agent_view` **[corrigé v2]** |
| `events.subscribe` | `{ subscriptions[] }` | `subscription_started` |
| `events.wait` | `{ match_event, timeout_ms? }` | `wait_matched` / `output_matched` |

**[corrigé v2]** `agent.start.timeout_ms` : « must be **greater than 3000 and at most 300000** » (contrainte dans la description du schéma, absente ailleurs).

**[corrigé v2]** `agent.read` renvoie **`pane_read`**, pas `agent_info`. `agent.read` et `pane.read` partagent le **même** `PaneReadResult` — donc la même sémantique de `revision`.

**[corrigé v2]** `agent.view.set` exige `source`. Le schéma contient un DSL de vue complet (`AgentViewFilter` avec `all/any/not/eq/in/exists`, `AgentViewSort`) — utile pour « agents actifs / terminés / bloqués » du spec §4.

**Primitives pane à connaître** (non listées dans le tableau ci-dessus, mais plus directes que `agent.prompt` dans certains cas) `[SCHÉMA]` : `pane.send_text`, `pane.send_input`, `pane.send_keys`, `pane.wait_for_output`, `pane.scroll`, `pane.edit_scrollback`, `pane.selection.read`, `pane.copy_search`, `pane.copy_motion`, `pane.process_info`.

> `agent.read` rend la **sortie du terminal** (texte ou ANSI), **pas** l'historique structuré. C'est pourquoi la couche C est indispensable.

### 2.4 `session.snapshot` — la source du écran d'accueil `[SCHÉMA]` **[corrigé v2 — ajout]**

`SessionSnapshot` :

```
agents[]  workspaces[]  tabs[]  panes[]  layouts[]
focused_pane_id  focused_tab_id  focused_workspace_id
protocol  version
```

`protocol` et `version` y figurent → **validation du protocole sans même faire `ping`**.

`WorkspaceInfo` : `workspace_id`, `label`, `number`, `active_tab_id`, `pane_count`, `tab_count`, `agent_status`, `tokens`, `worktree`, `focused`.

`panes[]` porte notamment `scroll` ; `layouts[]` porte `splits[]`.

→ **Correspondance directe au spec §4 « Accueil / état global ».** `[EXÉCUTÉ]` sur le snapshot réel : `workspaces[0]` = `{"label":"herdr-pwa","pane_count":1,"tab_count":1,"agent_status":"working",…}`.

### 2.5 `agent.prompt` — le cœur du MVP `[SCHÉMA]`

```json
{ "id": "p1", "method": "agent.prompt",
  "params": { "target": "w2:p1", "text": "…",
              "wait": { "until": ["idle","blocked","done"], "timeout_ms": 30000 } } }
```

`AgentStatus` = **`idle` | `working` | `blocked` | `done` | `unknown`**

Le champ `wait` est majeur : **envoyer un prompt et attendre un état cible dans le même appel.** Cela remplace l'appariement requête/événement manuel.

| Statut Herdr | État Herdr Remote |
|---|---|
| `working` | working |
| `blocked` | waiting (attend l'utilisateur) |
| `idle` | done / disponible |
| `done` | done |
| `unknown` | **afficher tel quel, ne pas deviner** |

⚠️ Herdr n'a **pas** de statut `error`. L'UI ne doit pas fabriquer un état « error » Herdr : il se déduit de l'`error` de réponse.

⚠️ **Aucune clé d'idempotence.** `AgentPromptParams` = `{ target, text, wait }`. Le champ `id` de la requête est une corrélation. **Le spec §5 (« actions idempotentes, pas d'envoi doublon ») n'est pas satisfait par l'API** — voir E8.

### 2.6 `AgentInfo` — et le chaînage vers Pi `[EXÉCUTÉ]`

Clés **réellement présentes** sur le snapshot vivant : `agent`, `agent_session`, `agent_status`, `completion_seq`, `cwd`, `focused`, `foreground_cwd`, `pane_id`, `revision`, `screen_detection_skipped`, `state_change_seq`, `tab_id`, `terminal_id`, `terminal_title`, `terminal_title_stripped`, `workspace_id`.

> **[corrigé v2]** Ma version précédente montrait `"state_labels": {}` et `"tokens": {}` — **ils sont absents** sur cette instance (nullables), pas vides. Ne pas figer leur présence.

Extrait réel :

```json
{
  "agent": "pi",
  "agent_session": {
    "agent": "pi",
    "kind": "path",
    "source": "herdr:pi",
    "value": "/Users/thomas.delalonde/.pi/agent/sessions/--Users-thomas.delalonde-projects-perso-devcli-private--/2026-10-05T12-18-32-927Z_01a10c00-5d5f-70bb-bde5-39315fe09219.jsonl"
  },
  "agent_status": "idle",
  "completion_seq": 38,
  "state_change_seq": 38,
  "cwd": "/Users/thomas.delalonde/projects/perso/devcli-private",
  "pane_id": "w2:p1", "tab_id": "w2:t1", "workspace_id": "w2",
  "terminal_id": "term_65d54a45ef31a12",
  "terminal_title": "π - devcli-private",
  "terminal_title_stripped": "π - devcli-private",
  "focused": false,
  "revision": 7
}
```

`AgentSessionInfo.required = [source, agent, kind, value]` — **les quatre champs sont requis**. `kind: "path"` → `value` est un chemin directement exploitable. `kind: "id"` → résolution **`[INCONNU]`** : aucune méthode de résolution dans le schéma.

`AgentInfo.required = [terminal_id, agent_status, workspace_id, tab_id, pane_id, focused, revision]` — **exactement, ni plus ni moins.** Tous les autres champs sont absents ou nullables.

`source` est namespacé (`herdr:pi`). **Ne pas supposer `source === agent`.**

**Le producteur est documenté** `[SCHÉMA]` **[corrigé v2]** — `pane.report_agent_session` :

```
{ pane_id, agent, agent_session_id?, agent_session_path?, seq?, source,
  session_start_source?, resume_argv? }
```

- `agent_session_id` **et** `agent_session_path` sont deux champs distincts et explicites → la distinction `id` vs `path` est **modélisée à la source**.
- `seq` : ordonnancement des rapports successifs.
- **`resume_argv`** : *« Command that resumes this agent's session after a Herdr restart. The first element must be a plain command name. »* → c'est la **commande de reprise native, fournie par Herdr**, directement réutilisable pour la fonctionnalité « reprendre le travail » du spec §7.

### 2.7 Compteurs `[SCHÉMA]` **[corrigé v2]**

| Compteur | Ce que le schéma dit **réellement** |
|---|---|
| `AgentInfo.completion_seq` | **seul champ décrit** : « the current idle transition completed work, independently of who has viewed it » |
| `AgentInfo.revision` | **aucune description** |
| `AgentInfo.state_change_seq` | **aucune description** |
| `PaneReadResult.revision` | **aucune description** — l'ensemble de `PaneReadResult` n'a **zéro** description |

⚠️ **Correction d'une sur-interprétation.** Ma version précédente affirmait « `PaneReadResult.revision` incrémente à chaque écriture » : **le schéma ne le dit pas.** La monotonie est `[INCONNU]` et doit être **mesurée au spike** avant de bâtir la reprise dessus. Le spec interdit explicitement de bâtir la reprise sur une hypothèse.

### 2.8 Abonnements et taxonomie des événements `[SCHÉMA]` **[corrigé v2 — section refaite]`

`events.subscribe` prend `{ subscriptions: Subscription[] }` et répond `subscription_started`.

**Il y a TROIS vocabulaires distincts dans ce protocole. Les confondre casse l'implémentation temps réel.**

| Vocabulaire | Où | Taille | Style | Rôle |
|---|---|---|---|---|
| `Subscription` | `events.subscribe` → `subscriptions[]` | **27** | **points** | ce qu'on **demande** |
| `SubscriptionEventKind` | champ `event` **reçu** pour les 3 types à charge utile | **3** | **points** | sous-ensemble reçu |
| `EventKind` | champ `event` reçu (union principale) | **26** | **underscores** | tous les événements cœur |
| `EventMatch` | `events.wait` → `match_event` | **19** | **underscores** | attente ponctuelle |

Relations exactes :

- 25 des 27 types d'abonnement sont la forme **à points** d'un `EventKind`.
- **`pane.output_matched` et `pane.scroll_changed` n'ont pas d'équivalent dans `EventKind`** : ils n'existent qu'en points.
- **`pane_output_changed` est reçu mais NON abonnable** — aucun type d'abonnement ne le couvre. C'est pourtant l'événement cœur qui porte `{ pane_id, workspace_id, revision }`, donc **le candidat naturel pour le rattrapage de sortie**.
- `EventMatch` (19) est un **sous-ensemble strict** de `EventKind` (26). Les 7 non attendables : `workspace_metadata_updated`, `workspace_reordered`, `worktree_created`, `worktree_opened`, `worktree_removed`, `pane_updated`, `layout_updated`.

Catégories d'abonnement :

- Workspaces : `workspace.created|updated|metadata_updated|renamed|moved|reordered|focused|closed`
- Worktrees : `worktree.created|opened|removed`
- Tabs : `tab.created|closed|focused|renamed|moved`
- Panes : `pane.created|closed|updated|focused|moved|exited|agent_detected`
- Layout : `layout.updated`
- **À charge utile (les 3 du MVP)** :

| Type d'abonnement | Champs requis |
|---|---|
| `pane.output_matched` | `pane_id`, `source`, `match` (+ `lines?`, `strip_ansi?`) |
| `pane.agent_status_changed` | `pane_id` (+ `agent_status?`) |
| `pane.scroll_changed` | `pane_id` |

Événement reçu — enveloppe `{ event, data }` :

```json
{ "event": "pane.agent_status_changed",
  "data": { "pane_id": "…", "workspace_id": "…", "agent_status": "working",
            "agent": "pi", "display_agent": "pi", "title": "…",
            "state_labels": { } } }
```

> **[corrigé v2]** Ma version précédente contenait `"terminal_title"` dans cet exemple : **ce champ n'existe pas** dans `PaneAgentStatusChangedEvent`. Propriétés réelles : `pane_id`, `workspace_id`, `agent_status` (requis) + `agent`, `display_agent`, `title`, `state_labels`. Le titre du terminal se récupère via `agent.get` / `pane.read`.

`pane.output_matched` embarque une lecture complète (`PaneReadResult` : `pane_id`, `workspace_id`, `tab_id`, `source`, `format`, `text`, `revision`, `truncated` — tous requis) → mécanisme de streaming le plus économique.

### 2.9 Lecture du terminal `[SCHÉMA]`

`source` ∈ `visible` | `recent` | `recent_unwrapped` | `detection`
`format` ∈ `text` | `ansi`

`detection` sert à la détection d'agent ; `recent_unwrapped` est le choix naturel pour lire un historique. `[INCONNU]` : la profondeur réellement disponible n'est pas documentée.

### 2.10 Surface d'exécution à encadrer `[SCHÉMA]` **[corrigé v2 — ajout]**

Le spec §6 exige « API **sans commande shell arbitraire** », « commandes autorisées par liste blanche ». Deux points de vigilance :

- **`command.invoke`** — `CommandInvokeParams.required = [command_id]`, avec `pane_id?`, `tab_id?`, `workspace_id?`, `selection?`. Le `command_id` est décrit comme « **opaque endpoint-issued command identifier** from the client-shell projection ». Ce n'est donc **pas** une exécution shell libre, mais c'est **une surface d'exécution de commande** : elle doit être **exclue ou explicitement allowlistée** côté Herdr Remote, jamais exposée telle quelle à l'iPhone.
- **`pane.send_input` / `pane.send_keys`** — injectent des touches au niveau terminal. `send_keys` est légitime pour les approbations (V1) ; `send_input` est plus large et doit être traité avec le même soin.

### 2.11 Méthodes hors MVP mais à connaître `[SCHÉMA]` **[corrigé v2 — ajout]**

- `notification.show` + `NotificationShowReason` + sons → base des notifications V1 (spec §4).
- `integration.list|install|uninstall` + CLI `herdr integration` → câblage de l'intégration Pi.
- `server.agent_manifests`, `server.reload_agent_manifests`, `server.live_handoff`, `server.ssh_agent.register`.
- Toute la famille `plugin.*` (`plugin.list|link|unlink|set_enabled|action_list|action_invoke|log_list|pane_open|pane_focus|pane_close`) → c'est ce qui **pilote herdr-agent** en practice.
- ~30 méthodes `workspace.*`, `tab.*`, `worktree.*`, `layout.*`, `client.window_title.*`.

---

## 3. Couche B — Herdr Agent Bus (optionnel, V2) `[DOC]`

Protocole distinct : `~/projects/perso/herdr-agent/docs/protocol.md`

- **JSON délimité par `\n`**, un objet par ligne. Le premier paquet **doit** être `HELLO`, et **une seule fois**.
- Paquets : `HELLO` · `MESSAGE` · `EVENT` · `ACK` · `HEARTBEAT` · `LIST` · `LEAD`. `HELLO.v` = `1`.
- Socket : lu dans `$HERDR_PLUGIN_STATE_DIR/host.json` → `socketPath`. **`/tmp/herdr-agent.sock` n'est que la valeur par défaut du CLI** (`crates/herdr-agent/src/main.rs:38`) ; le CLI *« defaults its socket to the host socket »*. **[corrigé v2]**
- Permissions socket **0600**, trame max **1 MiB**.
- Présence : `agent-online` / `agent-offline`.
- Un `MESSAGE` vers un pane devient un `herdr agent prompt <pane> <texte>`.
- **Aucune file durable, aucun replay, aucune garantie exactly-once.**

⚠️ Ne pas confondre `HERDR_SOCKET_PATH` (couche A) et `HERDR_SOCKET` (couche B). **Noms dangerously proches, sens opposés.**

---

## 4. Couche C — Sessions Pi (JSONL, lecture seule)

### 4.1 Emplacement et en-tête `[EXÉCUTÉ]`

```
~/.pi/agent/sessions/--<projet>--/<timestamp>_<session-id>.jsonl
```

Le slug retire le `/` initial et remplace `/`, `\` et `:` par `-`.

En-tête réel, première ligne, **byte-identique** vérifié :

```json
{"type":"session","version":3,"id":"01a120c2-769c-762e-a623-7512f7686503","timestamp":"2026-10-09T13:02:57.693Z","cwd":"/Users/thomas.delalonde/projects/perso/herdr-pwa"}
```

`version` : **1** linéaire (legacy) · **2** arbre `id`/`parentId` · **3** rôle `hookMessage` renommé `custom`. Migration automatique au chargement.

**[corrigé v2 — ajout]** `SessionHeader` peut porter **`parentSession`** : le chemin de la session d'origine pour une session créée via `/fork`, `/clone` ou `newSession({ parentSession })`. C'est le **seul lien de filiation réel entre sessions** — à ne pas confondre avec `parentId`, qui est *intra-session*.

### 4.2 Types d'entrées `[DOC]` + `[EXÉCUTÉ]`

Déclarés : `session` (en-tête) · `message` · `model_change` · `thinking_level_change` · `usage` · `compaction` · `context_edit` · `branch_summary` · `custom` · `custom_message` · `label` · `session_info`

Base commune (sauf en-tête) :

```typescript
interface SessionEntryBase {
  type: string;
  id: string;               // *habituellement* 8 hex ; peut retomber sur un UUID complet
  parentId: string | null;  // parent dans l'ARBRE, pas un sous-agent
  timestamp: string;        // ISO 8601
}
```

⚠️ **Double horodatage** : `entry.timestamp` = chaîne ISO 8601, mais `message.timestamp` = **entier Unix en millisecondes**. Confirmé sur fichier réel (`"2026-10-09T13:03:31.228Z"` vs `1791551009419`).

⚠️ `id` est 8 hex sur 232/232 entrées de la session réelle, mais la doc dit « **usually** 8-char hex ; **may** fall back to a full UUID ». Le parseur doit tolérer les deux. **[corrigé v2]**

**Census réel sur toutes les sessions de la machine** `[EXÉCUTÉ]` **[corrigé v2 — ajout]** — le document ne doit pas donner l'impression que `message` domine :

| Entrée | Occurrences |
|---|---|
| `message` | 9 966 |
| `custom` | 406 |
| `thinking_level_change` | 91 |
| `model_change` | 65 |
| `context_edit` | 57 |
| `session` | 34 |
| `custom_message` | 12 |
| `compaction` | 4 |

⚠️ **`context_edit` (57 occurrences)** est un point subtil : édition **append-only** d'une entrée antérieure. Elle modifie **le contexte futur du modèle sans modifier l'entrée cible ni l'historique brut**. Reconstruire « ce que le modèle a vu » ≠ lire le JSONL. `usage` et `custom` ne participent pas au contexte LLM.

### 4.3 Rôles de message `[EXÉCUTÉ]`

Census sur **toutes** les sessions de la machine :

| Rôle | Occurrences |
|---|---|
| `toolResult` | 4 967 |
| `assistant` | 4 679 |
| `user` | 280 |
| `system` | 32 |
| **`bashExecution`** | **8** |

**[corrigé v2]** Ma version précédente annonçait « `toolResult` 114 / `assistant` 91 / `user` 5 / `system` 1 » sur **une** session — non reproductible, cette session grossit en continu. Le tableau ci-dessus est l'agrégat, reproductible par la commande donnée en §8.

**[corrigé v2]** `AgentMessage` possède **quatre rôles supplémentaires** documentés dans `message-types.md` : **`bashExecution`**, **`custom`**, **`branchSummary`**, **`compactionSummary`**. Un parseur bâti sur les quatre rôles principaux **casse**. `bashExecution` est réellement présent sur cette machine.

Message assistant — **exemples `[DOC]`, copiés de `session-format.md`, PAS d'une session réelle** **[corrigé v2]** :

```json
{"role":"assistant","content":[{"type":"text","text":"Hi!"}],
 "api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-4-5",
 "usage":{...},"stopReason":"stop","timestamp":1733234402000}
```

La session réelle produit `[EXÉCUTÉ]` :

```json
{ "api": "openai-completions", "provider": "opencode-go",
  "model": "space-bunny-free", "stopReason": "toolUse", "thinkingLevel": "max" }
```

→ **`thinkingLevel` existe sur les messages récents** et n'est mentionné nulle part ailleurs dans ma version précédente. **[corrigé v2]**

Résultat d'outil `[EXÉCUTÉ]` :

```json
{"role":"toolResult","toolCallId":"call_01a120c2f977727897b156fe",
 "toolName":"bash","isError":false}
```

→ `toolName` + `toolCallId` + `isError` suffisent pour les **cartes d'appels d'outils** (V1 T7.2), sans parsing supplémentaire.

**[corrigé v2 — ajout]** Le rôle `system` porte le prompt et le jeu d'outils, et doit être **rejoué** pour reconstruire le contexte. Forme réelle : `sections` = `{ preamble, tools, skills, docs, rules, addendum, cwd }` (7 clés) + `toolsAdded` / `toolsRemoved`, et `toolsAdded` est **non vide** (4 outils). C'est le point délicat du rejeu de contexte : ces sections sont modifiées par patchage au fil de la session (`null` supprime une section).

### 4.4 `parentId` n'est PAS un sous-agent `[DOC]`

La doc est explicite : les entrées forment un arbre permettant « **in-place branching without creating new files** ». `branch_summary` existe parce que changer de branche est une fonctionnalité de **conversation**.

Vérification forte : `grep -riE 'sub-?agent'` sur **toute** la documentation Pi → **0 occurrence**.

**Conséquence** : l'arborescence des sous-agents du spec (V1 T7.1) ne peut **pas** être reconstruite depuis le fichier de session. Aucune source n'a été identifiée à ce jour.

### 4.5 Limite RPC — confirmée `[DOC]`

> « RPC mode runs Pi as a **long-lived subprocess** controlled through JSON records on stdin and stdout. » — `rpc.md:3`

Lancé par `pi --mode rpc --no-session`. **C'est un processus neuf.** Le RPC ne se rattache donc pas à une TUI Pi déjà ouverte.

Le seul chemin pour parler à un agent Pi **déjà lancé dans un pane** est `agent.prompt` (couche A), qui écrit dans le terminal du pane.

→ **La porte T2.3 se joue sur la couche A, pas sur Pi.** Tester « prompt sans créer d'agent » = vérifier que `agent.prompt` ne déclenche ni `agent.start` ni nouveau pane.

---

## 5. Le chaînage complet

```text
┌─ iPhone PWA ─────────────────────────────────────────────┐
│  WebSocket ← Herdr Remote (Bun + Effect, 127.0.0.1)      │
└──────────────────────┬────────────────────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        │ A. Herdr Socket API          │  contrôle + temps réel + arbre global
        │ ~/.config/herdr/herdr.sock  │  protocol 22 · endpoint_compatible
        │  session.snapshot            │  ← source de l'écran d'accueil
        │  agent.list / agent.prompt   │
        │  agent_session → {path}      │
        │  events.subscribe            │
        └──────────────┬───────────────┘
                       │  value = chemin absolu
        ┌──────────────▼───────────────┐
        │ C. Sessions Pi (JSONL)      │  historique structuré
        │ ~/.pi/agent/sessions/…      │  LECTURE SEULE
        └──────────────────────────────┘

        B. Herdr Agent Bus — V2 uniquement, hors MVP
```

`agent_session.value` est le **lien** entre les deux couches, fourni par Herdr, jamais deviné. C'est ce qui rend le critère de succès du MVP atteignable sans accès direct au système de fichiers.

---

## 6. Écarts avec `docs/HERDR_REMOTE_SPEC.md`

| # | Spec dit | Réalité vérifiée | Impact |
|---|---|---|---|
| E1 | « T2.2 : détecter le chemin de session » | Herdr le fournit via `agent_session` | T2.2 passe de *enquête* à *lecture* |
| E2 | `working / waiting / done / error` | Enum = `idle/working/blocked/done/unknown`. **Pas de `error`** | L'`error` vient de l'erreur d'appel, pas du statut |
| E3 | « arborescence des sous-agents » (V1) | Absent du fichier de session | V1 T7.1 **sans source identifiée** |
| E4 | `events.subscribe` | ✅ existe | Confirme le spec |
| E5 | Non spécifié | Deux protocoles, deux sockets (`HERDR_SOCKET_PATH` vs `HERDR_SOCKET`) | Risque de confusion n°1 |
| E6 | « protocole non spécifié » | `protocol: 22` + `endpoint_compatible` + `capabilities` + schéma distribuable | Handshake explicite obligatoire |
| E7 | Reprise après coupure « spécifiée en général » | Compteurs présents mais **sans description** ; `pane_output_changed` existe et est **non abonnable** | Base réelle mais **monotonie à mesurer** |
| **E8** | « actions idempotentes, pas d'envoi doublon » (§5) | **`agent.prompt` n'a aucune clé d'idempotence.** `id` = corrélation | **Exigence non satisfaite par l'API** — à implémenter côté Herdr Remote |
| **E9** | « API sans commande shell arbitraire » (§6) | `command.invoke` (`command_id`) et `pane.send_input` existent | Allowlist obligatoire ; `command.invoke` n'est pas une exécution libre mais reste une surface d'exécution |
| **E10** | « Pi : extension locale optionnelle » (§2) | **Existe déjà** : `~/projects/perso/herdr-agent/integrations/pi/herdr.ts`, « ready-to-load extension » | Le spec présente une option comme à créer ; elle est déjà écrite |
| **E11** | Accueil = source inconnue | `session.snapshot` + `WorkspaceInfo.agent_status/pane_count/tokens` | **Écart favorable au spec** : la donnée existe |
| **E12** | Notifications (V1) | `notification.show` + raisons + sons | Non mentionnée, disponible |

---

## 7. Matrice de capacités

`[DOC]` documenté · `[SCHÉMA]` dans le schéma · `[EXÉCUTÉ]` observé · **`INCONNU`** à établir

| Capacité | Source | Statut |
|---|---|---|
| **Arbre global / écran d'accueil** | A `session.snapshot` | `[SCHÉMA]` + `[EXÉCUTÉ]` |
| Lister les agents | A `agent.list` | `[EXÉCUTÉ]` |
| Statut / activité d'un agent | A `agent_status` | `[EXÉCUTÉ]` |
| Lire l'historique structuré | C JSONL | `[EXÉCUTÉ]` |
| Envoyer un prompt | A `agent.prompt` | `[SCHÉMA]` — à exécuter |
| Attendre un état cible | A `agent.prompt.wait` / `agent.wait` | `[SCHÉMA]` — à exécuter |
| Temps réel (statut) | A `events.subscribe` `pane.agent_status_changed` | `[SCHÉMA]` — à exécuter |
| Streaming de sortie | A `pane.output_matched` + `agent.read` | `[SCHÉMA]` — à exécuter |
| **Idempotence d'envoi** | — | **`INCONNU` — l'API ne l'offre pas** (E8) |
| Reprise native d'un agent | A `pane.report_agent_session.resume_argv` | `[SCHÉMA]` — **à exploiter, absent de ma v1** |
| Résolution `agent_session.kind = "id"` | — | **`INCONNU`** — producteur documenté, aucune résolution |
| Granularité / monotonie des compteurs | A | **`INCONNU`** — aucune description dans le schéma |
| Profondeur d'historique `agent.read` | — | **`INCONNU`** |
| Tool calls (V1) | C `role: toolResult` | `[EXÉCUTÉ]` |
| Coûts / tokens | A `tokens` (map string→string, **32 max**) · C `usage` | `[SCHÉMA]` — forme non investiguée |
| Arborescence sous-agents (V1) | — | **`INCONNU` — aucune source identifiée** |
| Approbations à distance (V1) | `blocked` + `agent.send_keys` | **`INCONNU`** |
| Git / code review (V1) | — | **`INCONNU` — hors périmètre Herdr connu** |
| Notifications (V1) | A `notification.show` | `[SCHÉMA]` |
| Pièces jointes (V1) | — | **`INCONNU`** |

**Règle** : aucun `INCONNU` ne doit être comblé par supposition dans le code. L'UI affiche l'absence (`capacité non exposée`), jamais un substitut inventé.

---

## 8. Commandes de reproduction

```bash
herdr status server                                    # endpoint_compatible + protocol + socket
herdr api schema --json > /tmp/herdr_schema.json       # contrat machine

jq '[.schemas.request.oneOf[].properties.method.const] | length' /tmp/herdr_schema.json   # 102
jq '.schemas.request.oneOf[0].required' /tmp/herdr_schema.json                           # ["method","params"]
jq '.schemas.event["$defs"].EventKind.enum | length' /tmp/herdr_schema.json               # 26
jq '.schemas.subscription_event["$defs"].SubscriptionEventKind.enum' /tmp/herdr_schema.json
jq '.schemas.request["$defs"].EventMatch.oneOf | length' /tmp/herdr_schema.json           # 19
jq -r '.schemas.request.oneOf[].properties.method.const' /tmp/herdr_schema.json | grep -E '^(agent|events|pane)\.'

herdr api snapshot | jq '.result.snapshot | keys'

# Framing newline-delimited, vérifié sur le socket réel
printf '{"id":"v1","method":"ping","params":{}}\n' | nc -U ~/.config/herdr/herdr.sock

# Census réel des sessions Pi (agrégat, reproductible)
cat ~/.pi/agent/sessions/*/*.jsonl | jq -r '.type' | sort | uniq -c | sort -rn
cat ~/.pi/agent/sessions/*/*.jsonl | jq -r 'select(.type=="message") | .message.role' | sort | uniq -c | sort -rn

# Aucune notion de sous-agent dans la doc Pi
grep -riE 'sub-?agent' ~/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/ | wc -l   # 0
```

## 9. Références

- Schéma machine : `herdr api schema --json` — **fait foi sur Herdr**
- Bus d'agents : `~/projects/perso/herdr-agent/docs/protocol.md`, `docs/architecture.md`, `crates/agentd/src/main.rs`, `crates/herdr-agent/src/main.rs`
- Extension Pi déjà écrite : `~/projects/perso/herdr-agent/integrations/pi/herdr.ts`
- Sessions Pi : `…/pi-coding-agent/docs/session-format.md`, `message-types.md`, `sessions.md`, `rpc.md`, `cli-integration.md`
- Spécification produit : `docs/HERDR_REMOTE_SPEC.md`
- Plan : `docs/TASKS.md` · Décisions : `docs/DECISIONS.md`
---

## 10. Écarts schéma ↔ implémentation, MESURÉS (E1–E4)

> **Règle de méthode qui en découle : le schéma sert à découvrir la surface ; l'exécution décide de ce qui est disponible.**
> Aucune capacité ne doit être utilisée sans avoir été vérifiée par exécution. Détail complet : `docs/DECISIONS.md` D008.

### 10.1 `events.wait` : 19 variantes au schéma, 1 seule implémentée `[EXÉCUTÉ]`

Serveur `herdr 0.9.3`, message d'erreur littéral :

```
{"error":{"code":"unsupported_event_wait_match",
          "message":"events.wait currently supports pane agent status matches"}}
```

| `EventMatch` testé | Serveur |
|---|---|
| `pane_agent_status_changed` **sans** `agent_status` | ❌ `missing field 'agent_status'` |
| `pane_agent_status_changed` **avec** `agent_status` | ✅ accepté |
| `pane_agent_detected`, `pane_created`, `pane_exited`, `tab_created` | ❌ `unsupported_event_wait_match` |
| `pane_output_changed` + `min_revision` | ❌ `unsupported_event_wait_match` |
| `workspace_focused` sans `workspace_id` | ❌ `missing field 'workspace_id'` |

⚠️ `agent_status` est déclaré **optionnel** au schéma et **exigé** par le serveur.

### 10.2 `revision` vaut TOUJOURS 0 `[EXÉCUTÉ]`

Mesuré sur 3 panes (dont un en écriture continue) et sur les 4 `source` :

| Panes | `visible` | `recent` | `recent_unwrapped` | `detection` |
|---|---|---|---|---|
| `w2:p1`, `w9:p1`, `wB:p1` | `0` | `0` | `0` | `0` |

**`revision` n'est pas un compteur de changement.** Toute stratégie de cache ou de rattrapage bâtie dessus est invalide.

`state_change_seq` et `completion_seq` **ne bougent pas** pendant qu'un agent travaille (relevé : `state_change_seq` constant à 70 puis 98). `completion_seq` est **absent** sur certains panes.

### 10.3 `OutputMatch` n'est pas une chaîne `[EXÉCUTÉ]`

```json
{ "type": "substring", "value": "texte à chercher" }
{ "type": "regex",     "value": "^expression$" }
```

Passer une chaîne brute (`".*"`) produit : `invalid type: string ".*", expected internally tagged enum OutputMatch`.

### 10.4 `pane.agent_status_changed` exige `pane_id` `[EXÉCUTÉ]`

Pas d'abonnement global aux changements d'état : il faut un abonnement **par pane**.
Conforme au schéma, mais à anticiper : **abonner N panes = N entrées d'abonnement.**

### 10.5 Enveloppe livrée : POINTS confirmés `[EXÉCUTÉ]`

```json
{"event":"pane.output_matched",
 "data":{"pane_id":"w2:p1","matched_line":"…",
         "read":{"format":"text","pane_id":"w2:p1","revision":0,"source":"recent_unwrapped",
                 "tab_id":"w2:t1","text":"…","truncated":true}}}
```

L'enveloppe reçue correspond **toujours** à l'abonnement souscrit, donc **à points** pour les 3 types à charge utile. Le vocabulaire à underscores (`EventKind`, 26 valeurs) n'est pas ce qui arrive.

### 10.6 `agent.prompt` : preuve de non-création `[EXÉCUTÉ]`

| Mesure | Avant | Après |
|---|---|---|
| Agents | 4 | **4** |
| Panes | `w2:p1 w9:p1 wA:p1 wB:p1` | **identiques** |
| `terminal_id` | 4 valeurs | **identiques** |
| `agent_status` de la cible | `done` | **`working`** |
| Latence | — | **618 ms** |
| `result.type` | — | **`agent_prompted`** |

Le texte du prompt apparaît **dans la sortie terminal du pane**. Aucun processus fils créé.

### 10.7 JSONL Pi : lecture incrémentale `[EXÉCUTÉ]`

Sur la session d'un agent en train de travailler : croissance de **5 011 octets** en 25 s, **inode stable** (aucune rotation), **4 entrées complètes lues par offset, 0 ligne partielle**, chaîne `parentId` cohérente.

→ Stratégie de lecture : ouvrir par `open()`, mémoriser `offset`, relire au-delà à chaque notification. **Toujours gérer la ligne partielle** (le dernier `\n` peut manquer).

### 10.8 Séparation contenu / contrôle — décision qui découle des mesures

| Besoin | Source | Pourquoi |
|---|---|---|
| **Contenu** de la conversation | **C — JSONL Pi** | append-only, inode stable, `id`/`parentId` fiables |
| **Rattrapage après coupure iOS** | **C — JSONL Pi** | `revision` vaut 0 → **aucun compteur Herdr exploitable** |
| Envoi de prompt | A — `agent.prompt` | fonctionne sur l'agent vivant sans création |
| Statut | A — `agent_status` | fiable |
| Vue globale | A — `session.snapshot` | `workspaces/tabs/panes/layouts` |
| Attente d'état | A — `events.wait` | **uniquement** `pane_agent_status_changed` |
| Changement d'état (push) | A — `events.subscribe` | abonnement **par pane** |

⚠️ **Le contenu et sa reprise ne passent jamais par Herdr.** Cette séparation n'est pas esthétique : elle découle de E3 (revision inutilisable) et E4 (JSONL fiable).
