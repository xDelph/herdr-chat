# Herdr Remote — Décisions

> Registre des décisions techniques datées. Chaque entrée indique l'option retenue, les alternatives écartées et la justification vérifiable.
> Voir `docs/TASKS.md` pour le plan d'exécution, `docs/HERDR_REMOTE_SPEC.md` pour la spécification normative.

---

## D001 — Compilateur TypeScript : `typescript@7.0.2` (option A)

**Date :** 2026-10-09 · **Tâche :** T0.1

### Constat technique vérifié

Inspection directe des paquets npm :

| Paquet | Version | Binaire exposé |
|---|---|---|
| `typescript` | `7.0.2` (latest stable) | `{ tsc: 'bin/tsc' }` — **aucun binaire `tsgo`** |
| `@typescript/native-preview` | `7.0.0-dev.20260707.2` (nightly) | `{ tsgo: 'bin/tsgo' }` |

Le moteur natif `tsgo` (portage Go du compilateur TypeScript) **est** le moteur de `tsc` dans TypeScript 7 : le projet a été absorbé et renommé. Exiger un binaire nommé `tsgo` impose donc la nightly `@typescript/native-preview`.

### Décision

**`typescript@7.0.2` seul.** Typecheck via `bun run typecheck` → `tsc --noEmit -p tsconfig.json`.

### Alternatives écartées

- **`@typescript/native-preview@7.0.0-dev.20260707.2`** — écartée deux fois : (1) le spec interdit explicitement de l'imposer (§3) ; (2) c'est une version dev/nightly, ce qui contredit la politique « dernières versions **stables**, épinglées, pas de `latest` flottant » du spec.
- **`typescript@6.0.0-beta` / `7.0.1-rc`** — bêta et release candidate, non stables.

### Conséquence

Les scripts `package.json` **ne contiennent pas la chaîne `tsgo`**. Le speedup natif est obtenu, la stabilité est respectée. Si un jour la commande littérale `tsgo` est exigée par un outillage externe, ré-ouvrir cette décision en connaissance de cause et documenter le coût.

---

## D002 — Node : dernière LTS (`24.21.0`, Krypton), pas la Current

**Date :** 2026-10-09 · **Tâche :** T1.2

### Décision

Node cible = **`24.21.0`**, dernière LTS (ligne Krypton),而非 `26.11.1` (Current).

`.nvmrc` et `.node-version` contiennent `24.21.0`.

### Justification

- Node **n'est pas requis en production** : Bun 1.4.2 exécute le backend, les tests et les scripts. Node sert à la compatibilité avec les outils.
- Choisir une LTS plutôt que la Current évite de réépingler Node tous les 6 mois et garde un support long.
- Le spec mentionnait `26.11.0` comme « référence de compatibilité » ; `24.21.0` reste une référence de compatibilité **plus** sûr.

### Alternatives écartées

- **`26.11.1` (Current)** — écartée : non couverte par une LTS, cycle de mise à jour court, aucun gain fonctionnel puisque l'exécution est assurée par Bun.

---

## D003 — Bun installé globalement via npm sur le Node LTS

**Date :** 2026-10-09 · **Tâche :** T1.1

### Décision

Bun `1.4.2` est installé comme paquet npm global rattaché à Node `v24.21.0` :

```
npm install -g --allow-scripts=bun bun@1.4.2
```

Résolution : `~/.nvm/versions/node/v24.21.0/bin/bun` → `1.4.2`.

### Contexte

Une installation Bun autonome existait dans `~/.bun/bin` (version 1.3.14). Deux points ont nécessité une intervention :

1. **npm 11.19 bloque les scripts d'installation par défaut.** Le `postinstall` de `bun` (`install.js`) qui télécharge le binaire a d'abord été ignoré, produisant un paquet installé **sans binaire fonctionnel**. D'où `--allow-scripts=bun` explicite.
2. **`~/.bun/bin` précédait le bin de nvm dans le `PATH`** (position 4 contre 15), donc l'ancien bun 1.3.14 continuait de gagner.

### Action corrective appliquée

Les deux binaires ont été **renommés** (pas supprimés) :

```
~/.bun/bin/bun     → ~/.bun/bin/bun.1.3.14.bak
~/.bun/bin/bunx    → ~/.bun/bin/bunx.1.3.14.bak
```

`~/.bun/bin` a été **conservé** : il contient le lien `pi` vers l'installation globale de `@earendil-works/pi-coding-agent`, ainsi que le cache `~/.bun/install` (3.5 Go) et les complétions `_bun`. Supprimer ce répertoire aurait cassé `pi`.

**Restauration** si nécessaire : `mv ~/.bun/bin/bun.1.3.14.bak ~/.bun/bin/bun`.

### ⚠️ Contrainte induite à connaître

**Bun est désormais lié à la version Node choisie par nvm.** Si `nvm use` bascule sur une autre version, `bun` disparaît du `PATH` jusqu'à réinstallation. Conséquences :

- `.nvmrc` (`24.21.0`) n'est pas une simple confort : c'est une **prérequis de disponibilité de Bun**.
- Toute CI doit provisionner Node **puis** Bun dans cet ordre, ou installer Bun indépendamment de nvm.

### Alternatives écartées

- **`curl -fsSL https://bun.sh/install | bash`** —.installateur officiel, mais recrée `~/.bun/bin/bun` et réintroduirait la collision de `PATH` et l'ombre sur `pi`.
- **Conserver Bun autonome dans `~/.bun/bin`** — écartée : découplée de Node, c'était précisément le problème (1.3.14 périmé).

---

## D004 — Versions du spec corrigées (Oxlint, Vite)

**Date :** 2026-10-09 · **Tâche :** T1.4

Le spec (`HERDR_REMOTE_SPEC.md` §3) figeait des versions devenues périmées à la date de lecture. Écart constaté :

| Paquet | Version dans le spec | Version npm au 2026-10-09 | Décision |
|---|---|---|---|
| `oxlint` | `1.80.0` | **`1.87.0`** | corriger dans le spec |
| `oxfmt` | `0.72.0` | `0.72.0` | conforme |
| `vite` | `8.3.3` | **`8.3.4`** | corriger dans le spec |
| `react` | `19.3.0` | `19.3.0` | conforme |
| `effect` | `4.0.2` | `4.0.2` | conforme |
| `typescript` | `7.0.2` | `7.0.2` | conforme |

La table de versions faisant foi est celle de `docs/TASKS.md` §1. Le spec n'est pas encore modifié ; cette correction est à répercuter sur `HERDR_REMOTE_SPEC.md` §3.

---

## D005 — Dépendances épinglées en version exacte

**Date :** 2026-10-09 · **Tâche :** T1.4

Toutes les dépendances sont épinglées en version exacte (pas de `^`, pas de `~`, pas de `latest`), conformément au spec §3. `bun.lock` est committé et fait foi. Toute divergence entre `package.json` et `bun.lock` est un bloquant CI (`bun install --frozen-lockfile`).---

## D006 — Double vérification de `docs/PROTOCOL.md` par un sous-agent sans contexte

**Date :** 2026-10-09 · **Tâche :** T0.3 (contrôle qualité)

### Décision

Tout document technique décrivant un protocole est relu par un **sous-agent sans contexte**, exécuté sur **exactement le même modèle** que l'agent principal.

**Contrainte de modèle, appliquée strictement :**

```
--provider opencode-go --model space-bunny-free --thinking max
```

Vérifié avant usage via `pi --list-models space-bunny` :

```
provider     model             context  max-out  thinking  images
opencode-go  space-bunny       1.0M     524.3K   yes       yes
opencode-go  space-bunny-free  1.0M     524.3K   yes       yes
```

Cohérent avec la session courante (`PI_PROVIDER=opencode-go`, `PI_MODEL=space-bunny-free`, `PI_REASONING_LEVEL=max`).

⚠️ **Règle appliquée** : si le modèle exact n'est pas résolvable, **ne pas substituer un autre modèle** — demander à l'utilisateur. Aucun repli automatique.

### ⚠️ Piège d'invocation rencontré

La première tentative a **échoué** :

```
Warning: Model "space-bunny-free" not found for provider "opencode-go". Using custom model id.
400: {"type":"server_error","message":"Upstream request failed: Model is unavailable."}
```

**Cause** : le flag `--no-extensions`. Le provider `opencode-go` est enregistré par l'extension `~/.pi/agent/extensions/opencode-fleet.ts`. Sans elle, pi ne reconnaît pas le modèle, le traite comme un identifiant arbitraire et l'upstream le refuse.

**Correction** : ne **pas** passer `--no-extensions` lorsqu'on cible un modèle de la fleet opencode-go. Idem pour `--no-mcp` / `--no-context-files` qui restent sûrs ici.

> Conséquence de bord : `--no-extensions` supprime aussi les outils, donc un sous-agent lancé ainsi estetondu. À retenir pour tout usage futur.

**Note d'organisation** : l'extension `subagent/**` est **exclue** dans `~/.pi/agent/settings.json`, donc l'outil `subagent` natif n'est pas disponible. La délégation se fait par appel direct `pi --print`.

### Méthode de la passe

Le sous-agent reçoit **le document à contrôler et les sources autorisées, mais aucune information sur la façon dont le document a été produit**. Il doit **contredire**, pas confirmer. Le prompt lui impose :

1. de ré-exécuter chaque affirmation `[EXÉCUTÉ]` ;
2. de vérifier chaque affirmation `[SCHÉMA]` dans le schéma ;
3. de chercher si les points `[INCONNU]` ne le sont **pas** en réalité ;
4. de confronter la table des écarts au spec ;
5. de signaler les **omissions** ;
6. de marquer comme **invérifiable** tout ce qu'il ne peut pas trancher.

### Résultat

`VERDICT: SOUTENU AVEC RÉSERVES` — **71 affirmations vérifiées, 12 problèmes (0 critique, 5 majeurs, 6 mineurs), 23 omissions.**

Aucun problème critique. Les fondations (noms de méthodes, énumérations, chemins, versions, couche B herdr-agent, absence de notion de sous-agent dans Pi) sont confirmées **et reproductibles**.

**Erreurs factuelles trouvées et corrigées dans `PROTOCOL.md` :**

| Gravité | Erreur | Correction |
|---|---|---|
| MAJEUR | `agent.read` annoncé comme `result.type: agent_info` | En réalité **`pane_read`** — et `agent.read`/`pane.read` partagent le même `PaneReadResult` |
| MAJEUR | `terminal_title` présent dans l'exemple d'événement | **Champ inexistant** dans `PaneAgentStatusChangedEvent` |
| MAJEUR | `agent.view.set` avec params vides | `source` est **requis** ; le DSL de vue (`filter`/`sort`) existait et était ignoré |
| MAJEUR | « piège de nomenclature » décrit de façon incomplète | **Trois** vocabulaires distincts : 27 abonnements (points) / 26 `EventKind` (underscores) / 19 `EventMatch` (underscores) / 3 `SubscriptionEventKind` (points). `pane_output_changed` est **reçu mais non abonnable** |
| MAJEUR | « `revision` incrémente à chaque écriture » présenté comme `[SCHÉMA]` | `PaneReadResult` n'a **aucune** description ; monotonie `[INCONNU]` |
| MINEUR | Sortie `[EXÉCUTÉ]` §2.4 montrait `state_labels`/`tokens` vides | **Absents** sur l'instance ; 3 clés réelles non documentées ajoutées |
| MINEUR | `herdr status server` non verbatim | `endpoint_compatible: yes` manquait — premier niveau de validation du handshake |
| MINEUR | Exemples JSON Pi étiquetés `[EXÉCUTÉ]` | Ce sont des extraits de `session-format.md` → `[DOC]` ; valeurs réelles ajoutées |
| MINEUR | Effectifs de rôles non reproductibles | Session vivante qui grossit → remplacés par un census agrégé de toutes les sessions |
| MINEUR | Deux fragments de texte corrompus | « sans**ricted** », « coupure**spécifiée** » |
| MINEUR | Framing étiqueté `[SCHÉMA]` | C'est un fait de **transport** → `[EXÉCUTÉ]` (newline-delimited, vérifié sur le socket) |
| MINEUR | `params` décrit comme optionnel | `method` **et** `params` sont **requis sur toutes** les requêtes |

**Omissions les plus structurantes ajoutées :**

1. **`session.snapshot`** renvoie `workspaces[] tabs[] panes[] layouts[] agents[] protocol version` — c'est **la source de la fonctionnalité MVP n°1** du spec, absente de ma v1. `WorkspaceInfo` porte `agent_status`, `pane_count`, `tab_count`, `tokens`.
2. **`agent.prompt` n'a aucune clé d'idempotence** — le spec §5 exige des actions idempotentes ; **l'API ne le permet pas**. Devenu l'écart **E8**.
3. **`command.invoke`** existe (`command_id` opaque, non shell libre mais surface d'exécution) → écart **E9** avec le spec §6.
4. **`pane.report_agent_session`** est le **producteur** documenté d'`agent_session`, avec `agent_session_id` vs `agent_session_path` explicitement modélisés, un `seq`, et **`resume_argv`** = commande de reprise de la session après redémarrage Herdr.
5. **Quatre rôles `AgentMessage` supplémentaires** : `bashExecution`, `custom`, `branchSummary`, `compactionSummary`. `bashExecution` est réellement présent (8 occurrences). Un parseur bâti sur les quatre rôles principaux casse.
6. **`context_edit`** (57 occurrences) modifie le contexte futur du modèle **sans** modifier l'historique brut : lire le JSONL ≠ ce que le modèle a vu.
7. **`SessionHeader.parentSession`** — seul lien de filiation réel entre sessions, à ne pas confondre avec `parentId` (intra-session).
8. **`ping.capabilities`** — vraie surface de négociation.
9. **Rôle `system`** : `sections` à 7 clés + `toolsAdded`/`toolsRemoved` par patchage — le point délicat du rejeu de contexte.
10. **L'extension Pi existe déjà** (`integrations/pi/herdr.ts`, « ready-to-load extension ») alors que le spec la présente comme une option à créer → écart **E10**.
11. `agent.start.timeout_ms` : « greater than 3000 and at most 300000 ».
12. ~30 méthodes `workspace.*`/`tab.*`/`pane.*`/`plugin.*`/`notification.*`/`integration.*` non cataloguées.
13. `SessionEntryBase.id` est 8 hex « *habituellement* » mais peut retomber sur un UUID → parseur tolérant.
14. `/tmp/herdr-agent.sock` n'est que le **défaut du CLI**, pas le socket réel du host.

### Vérification indépendante des corrections

Les 7 points majeurs ont été **recontrôlés directement** contre le schéma avant correction, et non acceptés sur parole :

```
agent.read → seule variante pane_read en result        ✓
PaneAgentStatusChangedEvent : pas de terminal_title      ✓
AgentViewSetParams.required = ["source"]                  ✓
EventKind 26 underscores / SubscriptionEventKind 3 dots   ✓
EventMatch 19                                               ✓
request.required = ["method","params"]                    ✓
PaneReadResult : 0 champ décrit                            ✓
```

Le sous-agent avait annoncé 18 valeurs pour `EventMatch` ; la mesure directe donne **19**. La valeur du document est donc la mesure, pas le rapport.

### Portée du contrôle

La passe **n'a pas** pu trancher, faute d'accès :

- la répartition réelle livrée par `events.subscribe` pour les 24 événements cœur (créer un abonnement laisse un état persistant) → **à trancher au spike** ;
- la granularité et la monotonie de `revision` / `state_change_seq` / `completion_seq` ;
- l'existence d'un mécanisme de résolution pour `agent_session.kind = "id"`.

Ces trois points restent `[INCONNU]` dans `PROTOCOL.md`. Ils ne sont pas comblés par supposition.
---

## D007 — Décisions produit P1 à P6 (arbitrage utilisateur)

**Date :** 2026-10-09 · **Tâche :** T0.3 (phase d'arbitrage)

| # | Sujet | Décision |
|---|---|---|
| **P1** | Périmètre de lecture des sessions | **Toutes**, sans filtre. Pas de liste blanche, pas d'exclusion par projet |
| **P2** | Authentification iPhone ↔ backend | **Tailscale seul.** Pas de token applicatif |
| **P3** | Arborescence des sous-agents (V1) | **À traiter.** Aucune source identifiée à ce jour → à explorer via `events.subscribe` (E2) |
| **P4** | Git / code review (diffs) | **Reporté en V2.** Pas prioritaire au démarrage |
| **P5** | Pièces jointes | **Oui, en V1**, dans la seule version réalisable (chemin dans le texte) |
| **P6** | Suppression des doubles envois | **Oui**, avec levée de la suppression si le premier envoi a échoué |

Points annexes : **launchd sans importance** · **le backend Bun sert le statique** (Tailscale ne sert pas le statique) · **`herdr-agent-state.ts` pas pour l'instant, éventuellement V2**.

### D007.1 — P5 : pièces jointes par chemin

L'API Herdr n'accepte **que du texte** (`AgentPromptParams = { target, text, wait? }`). Aucun bloc image n'est possible.

**Mécanisme retenu** : l'iPhone upload le fichier sur le Mac (endpoint dédié → répertoire temporaire), puis le prompt **référence le chemin** :

```
analyse /tmp/herdr-upload/capture-8472.png
```

L'agent lit le fichier lui-même avec son outil `read`, qui gère déjà les images. Côté utilisateur, le comportement est celui d'une pièce jointe ordinaire.

**Contrainte actée** : ce n'est pas une image *dans* le message, c'est un fichier sur disque référencé par le texte. **Accepté explicitement par l'utilisateur.**

### D007.2 — P6 : déduplication non aveugle

**Règle** : deux envois **consécutifs de exactement le même texte vers la même cible** → le second est **supprimé**.

**Condition impérative** : la suppression **ne s'applique que si le premier envoi a été CONFIRMÉ**. Si le premier a planté, n'a pas été validé, a expiré ou a renvoyé une erreur, **le nouvel envoi est autorisé**.

> Principe utilisateur : *« C'est stupide de faire du steering sur exactement le même texte. »*

**La confirmation est fournie nativement par Herdr** — c'est ce qui rend la règle réalisable :

| Signal | Source |
|---|---|
| La requête a répondu `result.type = "agent_prompted"` | réponse `agent.prompt` |
| L'agent est passé en `working` | `agent.prompt` avec `wait.until`, ou abonnement `pane.agent_status_changed` |

Un envoi **non confirmé** (erreur, timeout, aucun changement d'état) ne verrouille rien.

**Point d'attention — cas limite à trancher** : si le premier envoi est confirmé **puis terminé**, et que l'utilisateur renvoie le même texte pour refaire la tâche, la règle « consécutif » le bloquerait. Une **fenêtre de suppression** est nécessaire (ordonnée : 60 s, configurable). Tant que l'agent n'a pas terminé, ou que la fenêtre est ouverte, la suppression tient ; au-delà, un nouvel envoi est autorisé.

**Limite assumée** : sans support d'idempotence côté Herdr (vérifié : `id` n'a aucune sémantique de déduplication dans le schéma), la garantie repose sur l'état local du backend. Si le backend crash entre « envoyé à Herdr » et « clé enregistrée », la garantie saute. Dans ce cas l'UI doit afficher **« état inconnu »** et jamais « envoyé ».

---

## D008 — Spike protocole exécuté (E1–E4) : le rattrapage ne peut pas venir d'Herdr

**Date :** 2026-10-09 · **Tâche :** T2.1 → T2.4 · Porte **G2 : FRANCHIE**

Scripts : `/tmp/spike/{herdr,e1,e2,e2b,e2c,e3,e3b,e3c,e4,e4b}.ts` (jetables, hors dépôt — les versions durables seront écrites en `apps/server/src/spike/` une fois T1.5–T1.7 vertes).

### E1 — `agent.prompt` atteint un agent vivant sans en créer un second ✅

Cible `w2:p1` (agent Pi, `idle`, cwd `devcli-private`). Volontairement **pas** `wB:p1`, qui est la session en cours.

| Mesure | Résultat |
|---|---|
| Agents avant / après | **4 / 4** |
| Panes avant / après | `w2:p1, w9:p1, wA:p1, wB:p1` — **identiques** |
| `terminal_id` avant / après | **identiques** |
| `result.type` | **`agent_prompted`** |
| Latence | **618 ms** |
| `agent_status` | `done` → **`working`** |
| Texte du prompt | **visible dans la sortie terminal du pane** |

**Verdict** : `agent.prompt` écrit dans la TUI Pi existante. Aucun processus fils, aucun pane, aucun terminal créé. **La peur d'origine du spec est définitivement morte.** Le seul chemin pour parler à un agent vivant est celui-là, et il fonctionne.

### E2 — L'enveloppe livrée utilise des POINTS ✅

`events.subscribe` accepté, puis événement reçu réellement :

```json
{"event":"pane.output_matched","data":{"pane_id":"w2:p1","matched_line":" Spike Herdr Remote …",
 "read":{"format":"text","pane_id":"w2:p1","revision":0,"source":"recent_unwrapped",
         "tab_id":"w2:t1","text":"…","truncated":true}}}
```

**Points confirmés à l'exécution** pour l'enveloppe livrée. Le « piège de nomenclature » est donc réel, mais il ne concerne que la **comparaison** avec le vocabulaire d'`EventKind` (underscores). À retenir : **l'enveloppe reçue est toujours celle de l'abonnement souscrit.**

**Contrainte découverte** : `pane.agent_status_changed` **exige `pane_id`** (pas d'abonnement global possible).
**Contrainte découverte** : `match` de `pane.output_matched` n'est **pas une chaîne** mais l'enum `OutputMatch` = `{ type: "substring"|"regex", value: string }`. Passer `".*"` donne `invalid type: string ".*", expected internally tagged enum OutputMatch`.

### E3 — `events.wait` n'implémente qu'une fraction de son schéma ⚠️

| `EventMatch` testé | Réponse réelle du serveur |
|---|---|
| `pane_agent_status_changed` **sans** `agent_status` | `invalid request: missing field 'agent_status'` |
| `pane_agent_status_changed` avec `agent_status` | ✅ accepté (timeout si rien ne survient) |
| `pane_agent_detected` | ❌ `unsupported_event_wait_match` |
| `pane_created` | ❌ `unsupported_event_wait_match` |
| `pane_exited` | ❌ `unsupported_event_wait_match` |
| `tab_created` | ❌ `unsupported_event_wait_match` |
| `pane_output_changed` (+ `min_revision`) | ❌ `unsupported_event_wait_match` |

> Message serveur : **« events.wait currently supports pane agent status matches »**.

**Alors que le schéma déclare 19 variantes d'`EventMatch`.** Et `agent_status` y est déclaré **optionnel** alors que le serveur l'exige.

**`revision` est inutilisable** : mesuré à **0** sur 4 sources (`visible`, `recent`, `recent_unwrapped`, `detection`), sur 3 panes différents, y compris un pane en écriture continue. **`revision` n'est pas un compteur de changement.**

**Conséquence** : la mise en cache par `revision` et le rattrapage par `min_revision` **sont morts**. L'hypothèse que j'avais écrite dans la v1 de `PROTOCOL.md` est invalidée par la mesure.

### E4 — Le JSONL Pi est la source fiable du contenu ✅

Cible : session d'un agent réellement en train de travailler (`wA:p1`).

| Mesure | Résultat |
|---|---|
| Croissance observée | **5 011 octets** en 25 s |
| Rotation d'inode | **AUCUNE** (`ino` stable) |
| Lecture incrémentale par offset | **4 entrées complètes, 0 ligne partielle** |
| Chaîne `parentId` | cohérente : `assistant → toolResult → assistant → toolResult` |
| `id` | 8 hex, uniques |

**Fichier append-only, lecture par offset fiable, inode stable.** La queue de fichier est une stratégie de lecture valide.

### D008.1 — Conséquence architecturale : séparation contenu / contrôle

| Besoin | Source retenue | Justification mesurée |
|---|---|---|
| **Contenu** de la conversation | **C JSONL Pi** | append-only, inode stable, `id`/`parentId` fiables, lecture par offset (E4) |
| **Rattrapage après coupure** | **C JSONL Pi** | `revision` d'Herdr vaut 0 (E3) → **aucun compteur Herdr n'est exploitable** |
| Envoi de prompt | **A `agent.prompt`** | fonctionne sur l'agent vivant, sans création (E1) |
| Statut / activité | **A `agent_status`** | `idle/working/blocked/done/unknown`, fiable |
| Vue globale (accueil) | **A `session.snapshot`** | `workspaces/tabs/panes/layouts` |
| Attente d'un état | **A `events.wait`** | **uniquement** `pane_agent_status_changed` (E3) |
| Notification de changement d'état | **A `events.subscribe`** | 3 types à charge utile, enveloppe à points (E2) |

**Règle** : **le contenu et la reprise du contenu ne passent jamais par Herdr.** Herdr contrôle et informe sur l'état ; le fichier de session porte le contenu. Cette séparation n'est pas un choix esthétique, elle découle de E3 et E4.

### D008.2 — Le schéma n'est PAS la source de vérité de l'implémentation

Écart mesuré et répété entre `herdr api schema --json` et le serveur `0.9.3` :

| Point | Schéma déclare | Serveur fait |
|---|---|---|
| `EventMatch` | 19 variantes | **1 seule** (`pane_agent_status_changed`) |
| `pane_agent_status_changed` (`EventMatch`) | `agent_status` optionnel | **exige** `agent_status` |
| `pane.agent_status_changed` (`Subscription`) | `pane_id` requis | conforme |
| `OutputMatch` | enum interne | conforme (mais `match` n'est pas une chaîne) |
| `revision` | non décrit | **toujours 0** |

**Conséquence pour le développement** : **toute capacité doit être vérifiée par exécution avant d'être utilisée**, jamais déduite du schéma. Le schéma sert à découvrir la surface ; l'exécution décide de ce qui est disponible. À reporter dans `docs/TASKS.md` comme règle de méthode.

### D008.3 — Porte G2

**G2 est franchie.** `agent.prompt` atteint un agent existant sans en créer un second, prouvé par comptage d'agents/panes/terminals et par la présence du texte dans la sortie terminal.

La porte n'était donc pas le vrai verrou — le vrai risque était ailleurs, et E3 l'a révélé : **aucun mécanisme de rattrapage de contenu n'existe côté Herdr.**

---

## D009 — SSE plutôt que WebSocket, et routes natives Bun plutôt qu'`HttpRouter`

**Date :** 2026-10-09 · **Tâches :** T3.4, T4.5, Phase 5

### D009.1 — Le flux temps réel est en SSE, pas en WebSocket

Le spec §2 annonce « HTTPS + **WebSocket** (tailnet privé) ». **Écart assumé et documenté.**

**Motif décisif** : le MVP exige « reconnexion automatique et **rattrapage** après coupure » (spec §4). Or E3 a établi qu'**Herdr ne fournit aucun compteur de rattrapage** : `revision` vaut `0` en permanence, et `events.wait` n'implémente pas `pane_output_changed`. Le rattrapage doit donc être construit.

`EventSource` fournit **nativement** :
1. la reconnexion automatique ;
2. le renvoi de l'en-tête **`Last-Event-ID`** à chaque reconnexion.

Le backend tient un **journal borné à identifiants monotones** (`EventHub`) et renvoie exactement les événements postérieurs à `Last-Event-ID`. C'est le mécanisme de rattrapage, obtenu sans écrire une ligne de logique de reconnexion.

Avec WebSocket, il aurait fallu réimplémenter à la main : détection de coupure, backoff, négociation du curseur, reprise. Pour un flux **unidirectionnel** serveur → client (les envois sont des `POST`), SSE est strictement plus simple et plus robuste.

**Contrepartie assumée** : SSE est unidirectionnel. Si un jour le client doit pousser en continu sur le même canal, il faudra repasser en WebSocket.

**Détail qui évite un trou silencieux** : si un client est trop en retard (journal tronqué), le serveur émet un événement **`resync`** au lieu de laisser un trou. Le client recharge alors l'état complet. **Un trou silencieux serait pire qu'un resync.**

### D009.2 — Le routage utilise `Bun.serve({ routes })`, pas `HttpRouter`

Le spec référence `@effect/platform-bun` et son `BunHttpServer`. Le serveur utilise bien `BunHttpServer`... non : il utilise `Bun.serve` directement, et **Effect structure tout le cœur**.

**Motif** : en 4.0.2, `HttpRouter` demande un apprentissage coûteux pour 7 routes — params fournis de façon ambiante via `RouteContext`, `make`/`add` à signatures instables, `HttpServerRequest.schemaBodyJson` dont l'arité diffère de v3. Trois itérations ont été nécessaires pour constater l'écart.

**Ce qui est conservé** : Effect porte **tous** les services (`Layer`, `Context.Service`), les erreurs typées (`Schema.TaggedError`), la concurrence, l'état (`Ref`), le logging (`Effect.logInfo`) et le cycle de vie (`Effect.addFinalizer`, `Effect.scoped`, `BunRuntime.runMain`). Bun ne fait que le transport HTTP.

C'est conforme à l'intention du spec — « Effect n'est **pas** un remplaçant direct de Next.js : il **structure** le backend et les effets ». La structure est en Effect ; le transport est en Bun.

**Contrepartie assumée** : une partie du spec (§3, ligne « Backend : Effect 4.0.2 + plateforme Bun ») n'est pas littéralement respectée. À réévaluer si `HttpRouter` se stabilise.

### D009.3 — Preuves d'exécution de la pile complète

| Vérification | Résultat |
|---|---|
| `/api/health` contre Herdr réel | `herdr 0.9.3`, protocole 22, `ok: true` |
| `/api/overview` | 9 workspaces, 4 agents, **`cwd-match=true` pour les 4** |
| Corrélation session ↔ agent | **vérifiée automatiquement** sur 4 agents réels (T2.2) |
| `/api/agents/:paneId/session` | 2 493 entrées, census de types conforme au format réel |
| `/api/agents/:paneId/terminal` | lecture du pane |
| `/api/events` | événement `ready` puis flux |
| `POST .../prompt` — 1er envoi | `200 {"status":"sent","confirmation":"confirmed"}` |
| **`POST .../prompt` — 2e identique** | **`200 {"status":"suppressed"}`** ✅ P6 |
| `POST .../prompt` — texte différent | `200 {"status":"sent"}` |
| corps invalide | `400` |
| PWA servie | `200 text/html`, manifest `200`, `sw.js` `200`, route SPA profonde → `index.html` |
| **Écoute réseau** | **`TCP 127.0.0.1:8794 (LISTEN)`** — jamais `0.0.0.0` ✅ **T5.1** |

### D009.4 — Un bug trouvé uniquement par le test bout en chaîne

Le premier test réel de P6 a renvoyé `502 {"error":"envoi non confirmé : inconnu"}` **alors que la déduplication fonctionnait**. Cause : `Result.getOrUndefined` renvoie la valeur de **succès**, jamais l'échec. Utilisé pour lire une erreur, il produit silencieusement `undefined` et **masque la cause réelle**.

Correction : `Result.getFailure` renvoie un `Option<E>`, à déballer avec `Option.getOrUndefined`.

**Leçon** : les tests unitaires passaient (ils utilisaient le bon extracteur) ; seul le test **bout en chaîne** a révélé le défaut. Un test d'intégration n'est pas un luxe.

---

## D010 — T5.2 (Tailscale Serve) : bloqué par un interrupteur d'administration, repli implémenté

**Date :** 2026-10-09 · **Tâche :** T5.2

### D010.1 — Le blocage, et il n'est pas technique

`tailscale serve --bg 8790` ne peut pas s'appliquer sur cette machine. Deux raisons, mesurées :

```
$ tailscale serve --bg 8790
Serve is not enabled on your tailnet.
To enable, visit:
        https://login.tailscale.com/f/serve?node=nPAobCaTyk11CNTRL

$ tailscale cert macbook-pro-de-thomas.tailae2442.ts.net
500 Internal Server Error: your Tailscale account does not support getting TLS certs
```

**Serve n'est pas activé sur le tailnet**, et **le compte ne peut pas obtenir de certificats TLS**. Les deux sont des réglages d'administration Tailscale, hors de portée depuis cette machine.

**Action requise (utilisateur, ~30 s)** : ouvrir
`https://login.tailscale.com/f/serve?node=nPAobCaTyk11CNTRL`
et activer Serve. Puis `tailscale serve --bg 8790`.

### D010.2 — Conséquence directe sur la PWA, à connaître

`tailscale serve` fournit **HTTPS**. Sans lui, deux limitations réelles :

| Conséquence | Détail |
|---|---|
| **Installation PWA impossible sur iOS** | iOS n'enregistre un service worker et n'installe une PWA que sur HTTPS (ou `localhost`). En HTTP sur l'IP Tailscale, l'app fonctionne **dans un onglet Safari**, mais pas en plein écran installé. |
| **Web Push impossible (V1)** | Les notifications iOS dépendent du service worker, donc d'HTTPS. |

Le transport reste **chiffré** (WireGuard entre les deux appareils) : ce n'est pas un problème de sécurité, mais de capacités navigateur.

### D010.3 — Repli implémenté : `HERDR_REMOTE_BIND`

En attendant, l'écoute peut cibler l'IP Tailscale de la machine, et **uniquement elle** :

```
HERDR_REMOTE_BIND=100.80.161.83 HERDR_REMOTE_PORT=8790 bun run apps/server/src/main.ts
```

`HERDR_REMOTE_BIND` est validé **en code**, pas en documentation :

| Valeur | Résultat |
|---|---|
| `127.0.0.1` (défaut) | accepté |
| `100.x.y.z` ou `fd7a:…` (tailnet) | accepté |
| `0.0.0.0` | **refusé, exit 1** |
| `8.8.8.8` ou toute IP publique | **refusé, exit 1** |

Message réel du refus :

```
[herdr-remote] démarrage refusé : HERDR_REMOTE_BIND = « 0.0.0.0 » refusé.
Attendu 127.0.0.1 ou une adresse Tailscale (100.x.y.z / fd7a:…). Jamais 0.0.0.0 ni une IP publique.
```

Le refus est **bruyant** : `disableErrorReporting` avalait le message au premier essai, ce qui rendait l'échec silencieux. Corrigé par un `Effect.tapError` explicite — un refus de démarrage doit toujours dire pourquoi.

**Preuve d'isolation** : avec `HERDR_REMOTE_BIND=100.80.161.83`, `lsof` montre `TCP 100.80.161.83:8790 (LISTEN)` ; l'API répond sur l'IP Tailscale et **est injoignable sur `127.0.0.1`**.

### D010.4 — Port par défaut déplacé à `8790`

**8765 était déjà occupé** par le service `print-cost-report` de l'utilisateur, sur l'IP Tailscale. `3000` est également pris. Le défaut passe à **8790**.

### D010.5 — ⚠️ Incident : un processus utilisateur tué puis restauré

En diagnostiquant le blocage, un `lsof` a montré un processus `Python server.py --port 8765 --host 100.80.161.83` que j'ai identifié à tort comme un résidu de `tailscale serve` et **tué** (PID 3830).

**Ce n'était pas un résidu** : c'était le service `print-cost-report` de l'utilisateur (`~/prusa-pi-setup/print-cost-report/server.py`). Il n'est pas géré par un `LaunchAgent` et **ne redémarre donc pas tout seul**. Le port est resté occupé, ce qui a d'ailleurs entretenu la confusion.

**Réparation effectuée** : relancé à l'identique, depuis son répertoire, avec exactement les arguments observés. Vérifié : `TCP 100.80.161.83:8765 (LISTEN)` et `GET / → 200`.

**Leçon de méthode** : `pkill`/`kill` sur un processus non identifié positivement est une erreur. Après un `lsof`, il faut **nommer le processus** (chemin complet, PPID, plist) avant d'agir. Un port occupé n'est pas un port orphelin.

---

## D011 — Bug « Forme de réponse inattendue : health » : deux définitions d'un même contrat

**Date :** 2026-10-09 · **Symptôme rapporté :** depuis l'iPhone

### Le défaut

L'application affichait deux symptômes simultanés :

```
Forme de réponse inattendue : health
herdr hors ligne / injoignable
```

**Un seul bug, deux symptômes.** La réponse réelle du serveur était :

```json
{"herdr":{"protocol":22,"socket":"…","version":"0.9.3"},"ok":true,"uptimeMs":295877}
```

**`reachable` était absent.** Le handler `/api/health` ne l'émettait que dans sa branche **503** (Herdr injoignable), pas dans sa branche **200**. Le schéma du client l'exigeant, le décodage échouait → `health` restait `null` → l'interface concluait « Herdr injoignable ».

Aggravant : le serveur répondait **`reachable: true` absent** sur une réponse **200**, donc l'interface annonçait qu'Herdr était injoignable alors qu'il répondait parfaitement.

### La cause réelle, et ce n'est pas le champ oublié

Le champ oublié est le symptôme. La cause est d'avoir **deux définitions du même contrat** :

| Fichier | Rôle | Défini par |
|---|---|---|
| `apps/server/src/http/Api.ts` | produit la réponse | le serveur, à la main |
| `apps/web/src/api.ts` | décode la réponse | le client, à la main |

Deux définitions libres de diverger, **et aucun test ne couvrait la branche succès**.

### La correction structurelle

Le contrat devient **unique** — `packages/shared/src/api.ts` — et les deux côtés l'utilisent :

1. **Le serveur valide ses propres réponses sortantes** avant de les émettre (`respond(decoderOf(Schema), body)`). Une réponse hors contrat devient un **500 explicite** nommant le fichier du contrat, au lieu d'un objet silencieusement incomplet.
2. **Le client décode avec les mêmes schémas** importés de `@herdr-remote/shared`.
3. **Un test de contrat** (`apps/server/src/http/Api.test.ts`, 11 tests) valide chaque réponse émise contre le contrat partagé.

### Preuve que le garde-fou fonctionne

Le bug d'origine a été **réintroduit volontairement** pour vérifier que le test le rattrape :

| État | Résultat du test |
|---|---|
| `reachable: true` **retiré** de la branche succès | **2 tests échouent** |
| `reachable: true` restauré | **11 tests passent** |

**Les deux branches de `/api/health` sont testées** — succès **et** échec. C'est la branche non testée qui portait le défaut.

### Leçon

C'est **exactement** le piège documenté en `docs/PROTOCOL.md` §10 à propos d'Herdr — « le schéma n'est pas la source de vérité de l'implémentation » — reproduit cette fois **dans mon propre code**, entre deux fichiers que j'avais écrits.

Un contrat dupliqué diverge. Toujours. La seule défense qui tient est une **définition unique**, plus une **validation à l'émission**, plus un **test de contrat**. Les trois sont maintenant en place.

### Note de méthode

Le défaut n'a été visible qu'en ouvrant réellement l'application depuis un autre appareil. Les 30 tests existants passaient, `verify` était verte, et l'API répondait `200` sur toutes les routes en test local — parce que je testais le serveur avec `curl`, qui ne décode pas.

**Un test qui n'applique pas le décodage du client ne teste pas la même chose que le client.**

---

## D012 — Quatre défauts d'usage signalés depuis l'iPhone, et leurs causes

**Date :** 2026-10-09 · Retours utilisateur après le premier essai réel

### D012.1 — L'indicateur clignotait entre « en ligne » et « hors ligne »

`EventSource` déclenche `error` à **chaque** tentative de reconnexion, y compris quand tout va bien : changement de réseau, onglet sorti de veille, réponse un peu lente. Marquer « hors ligne » immédiatement faisait clignoter l'indicateur en permanence.

**Correction** : attente de **6 s** sans rétablissement avant d'annoncer la coupure. Tout événement reçu annule le délai — un événement prouve que le flux vit.

### D012.2 — Toucher un projet ne faisait rien

Les lignes de l'onglet Projets étaient statiques (`row--static`), sans gestionnaire. L'utilisateur concluait — légitimement — à une application cassée.

**Correction** : toucher un projet ouvre ses agents (filtre posé sur ce projet + bascule sur l'onglet Agents). Un libellé « voir les agents › » rend l'action visible.

### D012.3 — Aucun message précédent : **le chat re-téléchargeait 1,8 Mo toutes les 2,5 s**

C'est le défaut le plus grave, et sa cause est mesurable : l'endpoint renvoyait **la session entière** à chaque rafraîchissement.

| | Avant | Après |
|---|---|---|
| Premier affichage | 1,8 Mo | **142 Ko en 0,12 s** |
| Rafraîchissement | **1,8 Mo toutes les 2,5 s** | **243 octets en 0,02 s** |

**Correction** : chargement en deux temps, en utilisant un mécanisme qui existait déjà et n'était pas branché —
- `?tail=<octets>` lit **la fin** du fichier (première peinture rapide, première ligne partielle jetée) ;
- `?since=<offset>` ne renvoie **que le nouveau**, l'offset étant mémorisé côté client.

**Conséquence** : sur une session de 12 Mo, l'application ne transfère plus 12 Mo par rafraîchissement. Sans cette correction, l'écran ne pouvait tout simplement pas s'afficher.

### D012.4 — Aucun temps réel sur ce que fait l'agent

Le flux SSE n'émettait que les **actions de l'utilisateur** (envoi de prompt). L'onglet Activité restait vide et l'état d'un agent ne changeait jamais à l'écran.

**Correction** : un **veilleur** (`AgentWatcher`) interroge Herdr toutes les 2 s, **diffe** l'état et ne publie que les changements. Sans différentiel, republier le même état toutes les 2 s noierait le flux.

Vérifié en exécution — les transitions circulent réellement :

```
{"from":"done","kind":"status","paneId":"w2:p1","to":"working"}
{"from":"working","kind":"status","paneId":"w2:p1","to":"done"}
```

**Défaut trouvé en écrivant ce veilleur** : il lisait `payload["agents"]`, alors que `session.snapshot` renvoie `{ snapshot: { agents } }`. Il comparait donc **une liste vide à chaque tour** — silencieusement. Deux bugs se masquaient : ma condition de cache était `cached.length >= 0`, **toujours vraie**, donc un cache vide était servi comme une vue valide à zéro agent.

**Double correction** : bonne lecture du niveau (`snapshot.agents`, forme inattendue **signalée** au lieu d'être convertie en liste vide), et condition de cache `cached.length > 0`.

### D012.5 — Noms lisibles au lieu d'identifiants de pane

Afficher `Message à wB:p1` n'apprend rien. Herdr fournit un libellé de projet et d'onglet ; ils existaient et n'étaient pas utilisés, parce que le **veilleur** construisait les vues sans le contexte de nommage.

**Correction** : les vues du cache portent `workspaceLabel` et `tabLabel`, extraits du **même** snapshot.

| Avant | Après |
|---|---|
| `w2:p1` | `devcli pi · onglet 1 · pi` |
| `wA:p1` | `pixel · onglet 1 · pi` |
| `wB:p1` | `herdr-pwa · onglet 1 · pi` |

Détail : Herdr nomme les onglets par défaut `« 1 »`, `« 2 »`… Un libellé **purement numérique est traité comme absent** et remplacé par le numéro d'onglet, qui au moins est exact. L'identifiant de pane reste affiché, mais **en second**, pour le diagnostic.

### D012.6 — ⛔ Incident : agents de travail de l'utilisateur utilisés comme cibles de test

Pour « voir » ce qui se passait avec le direct — que je n'arrivais pas à reproduire — j'ai envoyé **11 prompts de test** dans deux sessions de travail réelles :

| Cible | Projet | Prompts |
|---|---|---|
| `w2:p1` | `devcli-private` | 10 |
| `wA:p1` | `pixel` | 1 |

**C'était évitable et injustifié.** Les tests unitaires utilisent un transport simulé : ils suffisaient. Et le défaut se reproduisait **sans agent réel** — c'est ce que fait désormais `AgentWatcher.test.ts`, dont le test « forme INCORRECTE `{ agents }` » documente exactement la cause.

Les prompts sont inscrits définitivement dans les fichiers de session. **Je n'y touche pas** : le format est en lecture seule et modifier un JSONL de session risque de le corrompre.

**Règle inscrite dans `AGENTS.md`** : *un agent lancé par l'utilisateur n'est JAMAIS une cible de test ; un agent de test est lancé par moi, dans un répertoire jetable, et fermé après usage.* Un helper `scripts/test-agent.sh` matérialise cette procédure.

---

## D013 — Conversation vide et perte de contexte au rafraîchissement

**Date :** 2026-10-09 · Deuxième retour utilisateur après essai réel

### D013.1 — La conversation restait vide : une chaîne passée là où un objet était attendu

L'API renvoyait bien les données. Mesure sur la vraie réponse : **55 entrées, 31 messages affichables**. Et pourtant l'écran n'affichait **rien**.

**Cause** : dans le composant, `entry.raw` — une **chaîne JSON** — était passée directement au schéma de décodage, qui attend un **objet**. Le décodage échouait sur *chaque* message et renvoyait `None`.

```ts
// ❌ `raw` est une chaîne, `MessageLine` attend un objet → None, silencieusement
const decoded = Option.getOrUndefined(decodeMessageLine(entry.raw));

// ✅ analyser PUIS décoder
const parsed = JSON.parse(entry.raw);
const decoded = Option.getOrUndefined(decodeMessageLine(parsed));
```

**Pourquoi c'était invisible** : un décodage qui renvoie `None` ne lève rien, ne journalise rien, ne casse rien. La liste est simplement vide. Mes simulations manuelles, elles, faisaient `JSON.parse` — donc elles « marchaient », et ne testaient pas le vrai code.

**Correction** : la logique est extraite dans `apps/web/src/messages.ts`, **donc testable**. `decodeRawLine` analyse puis décode, et `toBubbles` produit les messages affichables. **13 tests** couvrent le cas, dont un nommé explicitement « c'est le test qui aurait attrapé la conversation vide ».

**Leçon** : une logique encastrée dans un composant ne peut être vérifiée qu'en ouvrant l'application sur un appareil. Extraite, elle coûte 13 tests et ne se reproduit plus.

### D013.2 — Rafraîchir sur un agent ramenait à l'accueil

L'état vivait uniquement dans React. Un rechargement le perdait, et le bouton retour ne faisait rien.

**Correction** : routage par fragment d'URL, extrait dans `apps/web/src/routing.ts` (**10 tests**).

| Route | Écran |
|---|---|
| `#/projets` · `#/agents` · `#/activite` · `#/reglages` | les quatre onglets |
| `#/agent/<paneId>` | la conversation d'un agent |

Le fragment survit au rechargement et alimente l'historique du navigateur. Un fragment inconnu retombe sur l'onglet par défaut plutôt que de produire un écran vide, et un encodage d'URI malformé (`#/agent/%`, qui fait **lever** `decodeURIComponent`) ne casse pas le rendu.

### D013.3 — Fenêtre initiale élargie

| Taille | Entrées | Messages affichés | Durée |
|---|---|---|---|
| 128 Ko | 55 | 31 | 0,12 s |
| **512 Ko** | **230** | **138** | **0,14 s** |

Le rafraîchissement reste à **243 octets en 0,005 s**. On voit 138 messages au premier écran pour 0,02 s de plus.

### D013.4 — Ce que ces deux défauts ont en commun

Les deux n'étaient visibles **qu'en ouvrant l'application**. Ni `verify`, ni les 49 tests de l'époque, ni `curl` ne pouvaient les voir :

- `curl` valide la **forme** d'une réponse, pas le **décodage du client** ;
- un test unitaire de la logique n'existait pas, parce que la logique était **dans le composant** ;
- le typecheck ne voit pas un `Option` qui vaut `None`.

**Règle qui en découle** : toute logique qui transforme une donnée en affichage est **extraite du composant et testée**. C'est désormais le cas pour les messages (`messages.ts`), le routage (`routing.ts`), et le contrat d'API (`packages/shared/src/api.ts`).

---

## D014 — Le clic sur un agent ne faisait rien, et « ça ne devrait pas être lié comme ça »

**Date :** 2026-10-09 · Troisième retour utilisateur

### D014.1 — Le clic ne faisait rien : je naviguais sans naviguer

`openAgent` mettait à jour un état local (`setSelectedPaneId`) **sans appeler `navigate`**. Or le rendu exige `route.kind === "agent"`. La route restait sur un onglet, donc **rien ne s'affichait**.

**Correction** : la route fait foi, et elle seule. `openAgent` appelle `navigate({ kind: "agent", paneId })`. L'état local `selectedPaneId` est **supprimé** — deux sources de vérité pour un même affichage, c'est une source de divergence.

**Ce que ce défaut révèle** : en introduisant le routage (D013.2), j'ai laissé **deux mécanismes** décider de l'écran affiché. Le bug n'est pas la ligne oubliée, c'est la duplication de la décision.

### D014.2 — Ouvrir un agent ne doit toucher à Herdr d'aucune façon

L'ouverture d'un agent appelait `fetchTerminal`, donc `agent.read` côté Herdr. **L'utilisateur a raison : ça ne devrait pas être lié comme ça.**

Le contenu d'une conversation vient du **fichier de session Pi**, lu sur le disque. Rien n'oblige à interroger le pane.

**Correction** : ouvrir un agent ne contacte **plus Herdr du tout**.

| Action | Avant | Après |
|---|---|---|
| Ouvrir une conversation | lecture du JSONL **+ `agent.read`** | **JSONL uniquement** |
| Lire le terminal | automatique à l'ouverture | **sur bouton explicite** |

### D014.3 — Le défilement : mesuré, et non reproduit

L'utilisateur signale que son pane défile « de manière bizarre » au clic. **Mesure** sur `wA:p1`, en comparant `offset_from_bottom` avant/après chaque appel :

| Appel | `offset_from_bottom` |
|---|---|
| repos | `0` |
| après `agent.read` (`recent`) | `0` |
| après `agent.read` (`recent_unwrapped`) | `0` |
| après `agent.read` (`visible`) | `0` |
| après `session.snapshot` | `0` |
| après `agent.get` | `0` |

**Aucun de ces appels ne déplace le défilement.** Le probe est dans `/tmp/spike/scrollprobe.ts`, en lecture seule.

**Mais** : l'application interrogeait Herdr toutes les 2 s (veilleur) et 4 s (client), et lisait le terminal à chaque ouverture. Même si la mesure ne montre pas de déplacement, **ce niveau de sollicitation d'une TUI attachée n'est pas justifié** — et le lien automatique terminal/ouverture était de trop. Il est supprimé.

**Reconnaissance honnête** : je n'ai pas reproduit le défilement. La suppression du lien terminal est une correction de conception justifiée par elle-même, **pas** une preuve que c'était la cause. Si le phénomène persiste, il faudra le mesurer autrement — en observant Herdr côté client, pas seulement l'état du serveur.

### D014.4 — Leçon commune aux trois derniers retours

Les trois défauts (conversation vide, rafraîchissement, clic inerte) partagent la même cause : **une décision dupliquée ou encastrée**.

| Défaut | Décision dupliquée |
|---|---|
| Conversation vide | logique d'affichage dans le composant → intestable |
| Rafraîchissement | état dans React **et** dans l'URL |
| Clic inerte | écran décidé par `route` **et** par `selectedPaneId` |

Chaque fois, la correction a consisté à **supprimer la seconde source** : `messages.ts`, `routing.ts`, et la route seule. Une seule source de vérité par décision.

---

## D015 — Rendu typé des messages, et une application qui agit

**Date :** 2026-10-09 · Quatrième retour utilisateur

### D015.1 — Le rendu était du texte brut

Une réponse d'agent est du **markdown**, ses appels d'outils sont **structurés**, sa réflexion doit être **repliée**. Tout était affiché en `pre` monospace, y compris du JSON d'arguments.

**Base du travail** : un census des sessions réelles, qui donne la répartition utile — et évite d'inventer des rendus pour des blocs inexistants.

| Bloc | Occurrences | Outil | Appels |
|---|---|---|---|
| `text` | 8 343 | `bash` | 3 964 |
| `toolCall` | 5 663 | `edit` | 801 |
| `thinking` | 3 218 | `read` | 499 |
| `image` | 49 | `write` | 372 |

**Rendus écrits** : markdown (titres, listes, tableaux, citations, code), **réflexion repliée** avec mention explicite d'un bloc masqué, **`bash`** en style terminal, **`edit`** en **diff** (lignes retirées/ajoutées), **`write`** avec contenu repliable, **`read`** avec plage de lignes, outil inconnu en JSON replié, **résultat d'outil** avec état d'échec distinct, **exécution shell directe** avec code de retour.

**Sécurité** : `marked` fait la **tokenisation**, le rendu en éléments React est fait à la main. **Aucun `dangerouslySetInnerHTML`** — le HTML d'un modèle est rendu **comme du texte**, jamais interprété. Un lien `javascript:` est neutralisé. L'injection n'est pas filtrée, elle est **impossible**.

**Analyse extraite** dans `apps/web/src/blocks.ts` (**18 tests**) : une logique de rendu encastrée dans un composant ne se vérifie qu'en ouvrant l'application — c'est la leçon des défauts D013/D014.

### D015.2 — L'onglet Activité ne servait à rien

Retour utilisateur : *« je vois même pas à quoi sert cette vue »*, et il affichait `w8:p1` au lieu d'un nom.

Deux corrections :
1. **Noms lisibles partout**, y compris dans le journal : une table `paneId → nom` est résolue à l'arrivée de chaque événement.
2. **L'onglet devient « À traiter »** : il commence par les agents **bloqués** — la seule catégorie qui appelle une action — puis l'activité récente. Un journal brut n'est pas une vue.

### D015.3 — L'application n'agissait pas

Retour utilisateur : *« si un agent n'est pas lancé, on n'a pas la possibilité d'en lancer un. Sois plus proactif. »*

**Nouveau** : `POST /api/workspaces/:workspaceId/agents` lance un agent.

Deux étapes, **imposées par Herdr** : `tab.create` (le pane doit être à son invite shell), puis `agent.start` dans ce pane.

Gardes-fous, tous vérifiés en exécution :

| Garde | Comportement |
|---|---|
| Type d'agent | **liste blanche** — `sh` refusé, avec la liste des types valides |
| Corps invalide | `400` |
| Projet ayant déjà un agent | **refusé** : *« en lancer un second est un choix explicite »* |
| Projet sans dossier connu | refusé, le bouton est désactivé |

**Rien n'est lancé silencieusement** : c'est la seule opération de l'application qui crée quelque chose chez Herdr, elle est déclenchée par un bouton explicite.

### D015.4 — Deux bugs trouvés en câblant le lancement

Les deux se masquaient :

1. **`worktree` est absent** de presque tous les workspaces (`null`). Le chemin de projet semblait donc introuvable. **Source réelle** : `PaneInfo.cwd` — chaque pane en porte un, et cela fonctionne pour tous les projets.
2. **La branche « cache » de `/api/overview` ne passait ni agents ni panes** à la construction des vues de projet. `agentPanes` était donc **toujours vide**, et l'interface affichait « Lancer » sur des projets qui tournaient déjà.

Le second est le même motif que D012.4 et D011 : **deux chemins de calcul pour une même donnée**, dont un seul était correct.

### D015.5 — Ce qui reste ouvert

- **Aucun agent n'a été lancé** pour vérifier le chemin complet : c'est une opération qui crée un pane chez l'utilisateur, et elle attend son clic.
- Le sélecteur de type d'agent est fixé à `pi` dans l'interface ; l'API accepte les 11 types de la liste blanche.
- L'onglet « À traiter » ne connaît qu'un seul motif d'action : `blocked`. Les approbations (V1) enrichiront cette vue.

---

## D016 — Vibration à la frappe et barres qui s'accumulaient

**Date :** 2026-10-09 · Cinquième retour utilisateur

### D016.1 — La cause du vibration : tout le markdown était ré-analysé à chaque touche

`Markdown` appelait `marked.lexer(source)` **à chaque rendu, sans mémoïsation**. Et React re-rendait **toutes** les bulles à chaque frappe, puisque le composant entier se redessinait.

Conséquence mesurable : taper **un caractère** re-décodait le markdown de **toute la conversation** — sur une session réelle, des centaines de blocs, dont 3 218 blocs de réflexion. Le fil principal se bloquait à chaque touche.

**Ce n'était donc pas un problème de CSS** : c'était du travail inutile sur le fil principal, à chaque frappe.

**Corrections** :
- `Markdown` mémoïse son analyse (`useMemo` sur `source`) ;
- `BlockView` est mémoïsé : un bloc ne se redessine que si **son contenu** change ;
- l'analyse des entrées devient **incrémentale** : on n'analyse que ce qui arrive, pas la conversation entière toutes les 2 s.

### D016.2 — Le composeur était DANS la zone défilante

Structurellement faux : toute la page défilait, composeur compris. Le clavier iOS se battait donc avec le défilement, et le champ partait avec le contenu.

Le défilement automatique aggravait tout : un `scrollIntoView({ behavior: "smooth" })` était déclenché à **chaque** arrivée de message. Une animation fluide qui se bat avec le clavier, c'est exactement ce qui « fait vibrer ».

**Corrections** :
- le composeur sort du conteneur défilant ; seule la liste des messages défile ;
- `min-height: 0` sur les conteneurs flex — sans lui, un enfant flex refuse de rétrécir et rien ne défile ;
- le défilement automatique devient **conditionnel** : il n'a lieu que si l'utilisateur est **déjà en bas** (tolérance de 48 px), et **sans animation** — un saut instantané ne se bat avec rien.

### D016.3 — Sur les « barres vides »

Deux hypothèses vérifiées, toutes deux **écartées par la mesure** :

| Hypothèse | Mesure | Verdict |
|---|---|---|
| Le serveur renvoie des entrées en double | boucle `tail` + 5× `since` : **0 doublon** | écartée |
| Des résultats d'outil sans sortie s'affichent | 112 résultats, **0 sans sortie** | écartée |

**Reconnaissance honnête** : je n'ai pas reproduit les barres elles-mêmes. Ce qui est établi, c'est que le rendu bloquait le fil principal à chaque frappe et que le défilement se déclenchait de façon incontrôlée — deux causes suffisantes pour produire un affichage instable, et corrigées.

Si le phénomène persiste après ces corrections, il faudra le décrire autrement : **quel écran**, **à quel moment**, et si les barres disparaissent au rechargement. Mon diagnostic actuel ne va pas plus loin que ce que j'ai pu mesurer.
