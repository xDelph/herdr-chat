# Herdr Remote — Plan de tâches déterministe

> **Historique du MVP.** Le [backlog de release actif](RELEASE_BACKLOG.md) consolide les tâches restantes, la préparation open source et la refonte mobile décidée le 11/10/2026. T7.7 (terminal) est retirée et la partie UX de T8.5 est replanifiée ; les statuts historiques ne prouvent pas qu'une porte de release est franchie.

> Source normative : `docs/HERDR_REMOTE_SPEC.md`
> Versions vérifiées sur npm/nodejs.org le **2026-10-09**.
> Décisions prises : `docs/DECISIONS.md`.
> Règle : **aucune tâche ne démarre tant que la porte de la tâche dont elle dépend n'est pas verte.**

> **Statut au 2026-10-09**
> **Phase 0 ✅** T0.1 (D001) · T0.2 · T0.3 (`PROTOCOL.md`)
> **Phase 1 ✅** T1.1 (D003) · T1.2 (D002) · T1.3 · T1.4 (D005) · **T1.5 · T1.6 · T1.7** — `bun run verify` **verte**, et **prouvée capable d'échouer** sur les 4 causes
> **Phase 2 ✅** T2.1–T2.4 — spike E1–E4 exécuté, **porte G2 FRANCHIE** (D008)
> **Phase 3 ✅** T3.1 · T3.2 · T3.3 · T3.4 · **T3.5** (déduplication P6 prouvée bout en chaîne)
> **Phase 4 ✅** T4.1–T4.6 — PWA compilée et servie par le backend
> **Phase 5 ⚠️** T5.1 ✅ (bind vérifié, `0.0.0.0` refusé en code) · T5.3b ✅ · T5.4 ✅ — **T5.2 ⛔ BLOQUÉ** : Serve non activé sur le tailnet (D010)
> **Reste** : T6.0 (critère de succès MVP sur iPhone), puis V1/V2

> **Mise à jour du 11/10/2026 :** ce statut Phase 5 est historique. Serve est désormais configuré sur HTTPS `:8790` → `127.0.0.1:8791` (`tailscale serve status`, D019). La validation iPhone/PWA et l'alignement du port de release restent à faire dans le backlog actif ; ne pas interpréter T5.2 comme toujours bloqué par l'administration.

> ## ⚠️ Règle de méthode imposée par le spike
> **Le schéma n'est PAS la source de vérité de l'implémentation.** Écart mesuré et répété (D008.2) : `EventMatch` = 19 variantes au schéma, **1 seule** implémentée · `revision` toujours `0` · `agent_status` optionnel au schéma, exigé par le serveur.
> **Toute capacité doit être vérifiée par EXÉCUTION avant d'être utilisée.** Le schéma sert à découvrir la surface, pas à décider de sa disponibilité.

---

## 0. Conventions d'exécution

**Déterminisme** : chaque tâche a un identifiant, une liste d'actions exactes, des fichiers exacts, et **une seule condition de fin vérifiable** (`Done when`). Pas de « ça marche à peu près ».

**Ports d'étapes** : une tâche est `VERT` quand son `Done when` passe. Toute tâche bloqueuse non verte arrête la chaîne.

**Interdiction de version flottante** : aucune dépendance sans version exacte dans `package.json`. Pas de `^`, pas de `~`, pas de `latest`. Le spec l'exige explicitement (§3).

**État local** : machine au 2026-10-09, après T1.1–T1.4 →
- `node v24.21.0` (LTS Krypton) ✅ — cible validée D002
- `bun 1.4.2` ✅ installé globalement via npm sur le Node LTS (D003)
- `pi` 1.1.0 toujours fonctionnel ✅ — lien préservé dans `~/.bun/bin`
- `tailscale 1.102.4` ✅

**⚠️ Couplage Bun ↔ Node** : Bun est rattaché à la version Node choisie par nvm. Changer de version Node fait disparaître `bun` du `PATH`. Voir D003 et la tâche T1.8.

---

## 1. Versions épinglées (source de vérité)

| Outil | Version exacte | Remarque |
|---|---|---|
| `bun` | `1.4.2` | runtime + `bun install` + `bun test`. **Installé globalement via npm sur le Node LTS (D003)** |
| `node` | `24.21.0` | dernière LTS « Krypton » ; cible `.nvmrc` et `.node-version` (D002). **Current `26.11.1` écarté** |
| `typescript` | `7.0.2` | `latest` stable. **Le binaire `tsc` de TS 7 EST le compilateur natif Go (ex-`tsgo`)** |
| `@typescript/native-preview` | `7.0.0-dev.20260707.2` | **EXCLU par défaut** — nightly, et le spec interdit de l'imposer. Voir T0.2 |
| `effect` | `4.0.2` | |
| `@effect/platform-bun` | `4.0.2` | hôte HTTP/WS sous Bun |
| `@effect/platform` | `0.97.2` | seulement si requis par `platform-bun` |
| `oxlint` | `1.87.0` | ⚠️ le spec dit `1.80.0` → **périmé, corrigé ici** |
| `oxfmt` | `0.72.0` | conforme au spec |
| `@oxc-project/runtime` | `0.153.0` | helpers runtime Oxc |
| `vite` | `8.3.4` | ⚠️ le spec dit `8.3.3` → **périmé, corrigé ici** |
| `rolldown` | `1.2.13` | bundler derrière Vite 8 |
| `react` / `react-dom` | `19.3.0` | |
| `@vitejs/plugin-react` | `6.1.2` | |
| `vite-plugin-pwa` | `2.0.0` | manifest + service worker |

Le `bun.lock` est committé et fait foi. Toute divergence npm/bun.lock est un **bloquant CI**.

---

## 2. Phase 0 — Décisions bloquantes

### T0.1 — Trancher le `tsgo` (BLOQUANT, aucun code avant)

**Constat technique vérifié :**
- `typescript@7.0.2` expose **un seul binaire : `{ tsc: 'bin/tsc' }`**. Il n'existe **pas** de binaire `tsgo` dans le package `typescript`.
- Le seul package qui fournit un binaire nommé `tsgo` est `@typescript/native-preview`, en version **nightly/dev** (`7.0.0-dev.*`).
- Le spec interdit explicitement d'imposer `@typescript/native-preview` (§3).

**Conclusion** : le compilateur natif `tsgo` **est** le moteur de `tsc` dans TypeScript 7 — le projet Go a été absorbé et renommé. Exiger « tsgo » au sens *binaire nommé* impose la nightly ; l'exiger au sens *moteur natif* est satisfait par `typescript@7.0.2`.

**Décision à cocher une seule fois :**
- **[x] Option A — RETENUE** : `typescript@7.0.2` seul. Typecheck via `bun run typecheck` → `tsc --noEmit`. On obtient le moteur natif `tsgo`, la stability, et le respect du spec. **Les scripts ne contiennent pas la chaîne `tsgo`.**
- **[ ] Option B — écartée** : ajouter `@typescript/native-preview@7.0.0-dev.20260707.2` en devDependency pour disposer de la **commande** `tsgo`, et faire tourner `tsgo --noEmit` en plus de `tsc --noEmit`. ⚠️ nightly non pinnée par tag stable, contraire à la politique versions du spec.

**Done when** : ✅ **VERT le 2026-10-09** — D001 écrit dans `docs/DECISIONS.md`.

---

### T0.2 — Vérifier les drapeaux réels des outils Oxc (BLOQUANT)

Les versions sont fixées mais **les noms de drapeaux exacts d'`oxlint` 1.87 et `oxfmt` 0.72 doivent être lus, pas devinés**. Le spec impose Oxlint/Oxfmt ; il ne garantit pas la syntaxe CLI.

**Actions :**
1. `bunx oxlint@1.87.0 --help` → consigner dans `docs/TOOLCHAIN.md`
2. `bunx oxfmt@0.72.0 --help` → consigner dans `docs/TOOLCHAIN.md`
3. Y noter : commande de formatage en écriture, commande de vérification (`--check` ?), directories par défaut, option de sortie CI.

**Done when** : `docs/TOOLCHAIN.md` contient les sorties `--help` brutes des deux outils et les commandes exactes à mettre dans `package.json`. ✅ **VERT le 2026-10-09**.

---

### T0.3 — Inventaire de la surface Herdr (BLOQUANT)

Sans cela, tout le reste est spéculatif.

**Actions :**
1. Lire `https://herdr.dev/docs/socket-api/` — chemin exact du socket Unix, format des messages (JSONL), méthode de `events.subscribe`, mécanisme de corrélation requête/réponse.
2. Vérifier la version/herdr local réellement installée.
3. Lire `https://pi.dev/docs/latest/sessions`, `session-format`, `cli-integration` — emplacement des fichiers JSONL de sessions, structure d'un événement, notion de branche, forme exacte des tool calls.

**Done when** : `docs/PROTOCOL.md` décrit le socket Herdr (schéma de requête, schéma d'événement, version) **et** le format de session Pi, chacun avec un exemple réel copié d'une session existante. Les zones d'incertitude sont marquées `INCONNU` explicitement, pas comblées par supposition.
✅ **VERT le 2026-10-09.** `docs/PROTOCOL.md` écrit. Affirmations étiquetées `[EXÉCUTÉ]` / `[SCHÉMA]` / `[DOC]` / `[INCONNU]`.

**Trouvailles majeures (changent le plan)** :
- **E1** — Herdr expose **déjà** le chemin exact du fichier de session via `AgentInfo.agent_session = { source, agent, kind: id|path, value }`, observé en direct. T2.2 passe de *enquête* à *lecture*.
- **E2** — Herdr n'a **pas** de statut `error` : l'enum est `idle | working | blocked | done | unknown`. Le spec §5 demande `working/waiting/done/error` → l'`error` doit venir de l'erreur d'appel, pas du statut.
- **E3** — **Aucune source d'arborescence de sous-agents n'a été identifiée** dans le fichier de session : `parentId` est un branchement de conversation. V1 T7.1 est sans source pour l'instant.
- **E4** — `events.subscribe` existe ✅ (le spec avait raison).
- **E5** — Deux protocoles distincts coexistent, avec des noms dangerously proches : `HERDR_SOCKET_PATH` (API Herdr, `~/.config/herdr/herdr.sock`) vs `HERDR_SOCKET` (bus d'agents, `/tmp/herdr-agent.sock`). Confondre les deux est le risque d'architecture n°1.
- **E6** — `private_protocol: 22` + schéma JSON officiel distribuable → le backend doit valider le protocole au handshake.
- **E7** — Les compteurs existent (`revision`, `state_change_seq`, `completion_seq`) mais **le schéma ne les décrit pas** (seul `completion_seq` a une description). Le candidat naturel pour le rattrapage est `pane_output_changed`, qui porte `{pane_id, workspace_id, revision}` — mais il est **reçu et non abonnable**. Monotonie à mesurer au spike, jamais à supposer.

**⏳ Seconde vérification** : ✅ **FAITE le 2026-10-09** — passe de relecture indépendante sans contexte, sous-agent sur le **même modèle** (`opencode-go` / `space-bunny-free`, thinking `max`). Verdict **« SOUTENU AVEC RÉSERVES »** : 71 affirmations vérifiées, **12 problèmes corrigés (0 critique, 5 majeurs, 6 mineurs), 23 omissions ajoutées**. Consigné dans **D006**.

**Trouvailles supplementaires de la passe de vérification** :
- **E8** — `agent.prompt` **n'expose aucune clé d'idempotence** (`AgentPromptParams` = `target, text, wait`). Le spec §5 exige « actions idempotentes, pas d'envoi doublon » : cette exigence **n'est pas satisfaite par l'API** et devra être implémentée côté Herdr Remote.
- **E9** — `command.invoke` existe (`command_id` opaque issued par l'endpoint : ce n'est pas un shell libre, mais c'est une surface d'exécution). Le spec §6 exige une API sans commande shell arbitraire → allowlist obligatoire.
- **E10** — L'extension Pi « optionnelle » du spec §2 **existe déjà** : `~/projects/perso/herdr-agent/integrations/pi/herdr.ts` (« ready-to-load extension »).
- **E11** (favorable) — `session.snapshot` est la **source** du écran d'accueil MVP : `workspaces[] tabs[] panes[] layouts[] agents[] protocol version`, et `WorkspaceInfo` porte `agent_status`, `pane_count`, `tab_count`, `tokens`. Il ne faut pas reconstruire cette vue en itérant `agent.list`.
- **E12** — `notification.show` + `NotificationShowReason` + sons existent (base des notifications V1).

---

## 3. Phase 1 — Socle et chaîne de qualité

> Aucune ligne de feature avant T1.6 verte. La chaîne de vérification doit exister **avant** le premier code applicatif.

### T1.1 — Bun à `1.4.2` ✅ VERT

**Actions :**
1. Résolution vérifiée : `which bun` → `~/.nvm/versions/node/v24.21.0/bin/bun`
2. Ancien binaire autonome écarté du `PATH` par **renommage** (pas suppression) : `~/.bun/bin/bun` → `bun.1.3.14.bak`, idem `bunx`. `~/.bun/bin` conservé car il porte le lien `pi`
3. ⚠️ **Bun 1.4 utilise une installation isolée** : `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>` + liens par workspace. La racine ne contient que les devDependencies. Un contrôle naïf « `node_modules/<pkg>` n'existe pas » conclut **à tort** que l'installation a échoué. Vérifier en résolvant **depuis chaque workspace**.

**Done when** : ✅ `bun --version` → `1.4.2`, `bunx --version` → `1.4.2`, `pi --version` → `1.1.0` intact. Détails et procédure de restauration dans **D003**.

**⚠️ Contrainte** : Bun est lié à la version Node. Changer de version Node ⇒ `bun` absent du `PATH`.

### T1.2 — Node `24.21.0` (LTS Krypton) + `.nvmrc` ✅ VERT

**Actions exécutées :**
1. Node `24.21.0` déjà installé sur la machine et déjà `default` de nvm — rien à installer
2. `.nvmrc` = `24.21.0` (sans `v`, sans commentaire)
3. `.node-version` = `24.21.0` (compatibilité herdr / launchd / outils tiers)
4. Vérifié : `nvm use && node --version` → `v24.21.0`, `npm 11.19.0`

**Justification du choix LTS plutôt que Current** : Node n'est pas requis en production (Bun exécute le runtime, les tests et les scripts) ; il ne sert qu'à la compatibilité. Une LTS évite de réépingler Node tous les 6 mois. Consigné dans **D002**.

**⚠️ Rappel** : `.nvmrc` n'est pas un confort — c'est une **prérequis de disponibilité de Bun** (cf. T1.1 / D003).

**Done when** : ✅ `.nvmrc` = `24.21.0`, `.node-version` = `24.21.0`, `node --version` = `v24.21.0`.

### T1.3 — Initialiser le dépôt et la structure

**Actions :**
1. ✅ `git init -b main` — le dossier **est** désormais un dépôt git
2. ✅ `.gitignore` : `node_modules/`, `dist/`, `.env`, `.env.*`, `*.local`, `.DS_Store`, `coverage/`, `.tailscale/`
3. Arborescence :
   ```
   herdr-pwa/
   ├─ apps/
   │  ├─ server/          # Bun + Effect
   │  └─ web/             # React + Vite PWA
   ├─ packages/
   │  └─ shared/          # types partagés (enveloppes d'événements, schéma)
   ├─ docs/
   ├─ .nvmrc
   ├─ .node-version
   ├─ package.json
   ├─ tsconfig.json
   ├─ .oxlintrc.json
   └─ bun.lock
   ```
4. `package.json` racine : `"private": true`, `"packageManager": "bun@1.4.2"`, workspaces `apps/*`, `packages/*`

**Done when** : ✅ **VERT le 2026-10-09** — dépôt git initialisé, arborescence présente.

### T1.4 — Dépendances épinglées, versions exactes

**Actions :** `bun add --exact <pkg>@<version>` pour chacune, en copiant la table §1. Aucune dépendance sans version exacte.

**Done when** : ✅ `bun install --exact <pkg>@<version>` pour chaque paquet ; `grep -E '"[^"]+": "[^0-9"]' package.json apps/*/package.json` ne retourne **aucune** entrée `^`/`~`/`latest`. Consigné dans **D005**.

### T1.5 — TypeScript strict via le compilateur natif ✅ VERT

`tsconfig.json` écrit avec `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`. `types: ["bun"]`.

**Preuve du moteur natif** : `tsc --version` → **7.0.2**, et **0,37 s à froid / 0,17 s à chaud** sur 6 fichiers. Consigné dans `docs/TOOLCHAIN.md`.

**Done when** : ✅ `bun run typecheck` sort 0, temps mesuré et consigné.

### T1.6 — Oxlint + Oxfmt ✅ VERT

`.oxlintrc.json` validé et exécuté, `.oxfmtrc.json` en place, scripts `lint` / `lint:fix` / `format` / `format:check`.

⚠️ **Dépendance découverte** : `--type-aware` exige **`oxlint-tsgolint@7.0.2003`** (binaire `tsgolint`), installé en devDependency. Sans lui, `lint` échoue. Sans `--type-aware`, `no-floating-promises` et `no-misused-promises` ne s'exécutent jamais.

**Corrections réelles imposées par le lint** (aucune règle désactivée) :
- `consistent-type-imports` → `import type` sur `TransportError`
- `no-unsafe-type-assertion` → **remplacement de mes `as` par de vrais décodages `Schema`**. Le lint avait raison : je castais au lieu de décoder
- `no-underscore-dangle` sur `_tag` → autorisé explicitement (convention d'Effect), pas contourné

**Done when** : ✅ `bun run lint` et `bun run format:check` sortent 0, sortie vide.

### T1.7 — Chaîne de vérification unique ✅ VERT

`verify` = `format:check → lint → typecheck → test`.

**Les quatre portes ont été prouvées capables d'échouer** — dans les deux sens :

| Sonde | Porte | Mesuré |
|---|---|---|
| `(x: any)` | `lint` | **1** ✅ |
| format non respecté | `format:check` | **1** ✅ |
| `const h: number = "x"` | `typecheck` | **1** ✅ |
| `expect(1).toBe(2)` | `test` | **1** ✅ |
| *après nettoyage* | `verify` | **0** ✅ |

⚠️ **Piège rencontré** : une sonde nommée `__probe.ts` n'a **pas** été ramassée par `bun test`, qui a sorti `0` en paraissant valider un test qui n'avait jamais tourné. Faux négatif **détecté et corrigé** (sonde renommée `__probe.test.ts`). Convention Bun : `*.test.ts`, `*.spec.ts`, `*_test.ts`, `test_*.ts`, `__tests__/`.

**Done when** : ✅ `bun run verify` sort 0, **et** échoue pour les quatre causes attendues. Détail : `docs/TOOLCHAIN.md`.

### T1.8 — CI locale identique

**Actions :** pipeline en **deux temps obligatoires**, dans cet ordre :
1. Provisionner Node depuis `.nvmrc` → `24.21.0`
2. **Puis** installer Bun : `npm install -g --allow-scripts=bun bun@1.4.2`
3. Ensuite seulement : `bun install --frozen-lockfile` puis `bun run verify`

⚠️ L'ordre est critique : installer Bun avant Node, ou omettre `--allow-scripts=bun`, produit un binaire non fonctionnel (cf. D003). Une CI utilisant `oven-sh/setup-bun` est acceptable à condition d'épingler `bun-version: 1.4.2`.

**Done when** : `bun install --frozen-lockfile && bun run verify` réussit depuis un clone frais du dépôt, sur une machine sans aucune installation Bun préexistante.

### T1.9 — Git + hooks

**Actions :**
1. `.gitignore` committé
2. Hook pre-commit suggérant `bun run verify` (script `scripts/verify.sh`)
3. Premier commit tagged

**Done when** : un commit est refusé quand `verify` échoue.

---

## 4. Phase 2 — Spike protocole ✅ TERMINÉE

> **Porte G2 : FRANCHIE.** Les expériences E1–E4 ont exécuté T2.1–T2.4. Résultats complets : `docs/DECISIONS.md` **D008**, et `docs/PROTOCOL.md` **§10**.

### T2.1 — Localiser le socket Herdr et lire l'état ✅ VERT

`~/.config/herdr/herdr.sock` lu via `HERDR_SOCKET_PATH`. `session.snapshot` renvoie l'arbre complet. 4 agents réels observés. Transport **newline-delimited JSON** vérifié sur le socket.

### T2.2 — Corréler agent ↔ pane ↔ fichier de session ✅ VERT

Réduite par E1 (T0.3) : Herdr expose le chemin dans `AgentInfo.agent_session`. **Validé sur 4 agents réels : les 4 sont en `kind = "path"`, source `herdr:pi`.** Aucun cas `kind = "id"` observé — le besoin de résolution reste théorique.

### T2.3 — Envoyer un prompt SANS créer d'agent ✅ VERT — **porte G2 franchie**

| Mesure | Résultat |
|---|---|
| Agents avant / après | **4 / 4** |
| Panes / terminals | **identiques** |
| `result.type` | **`agent_prompted`** |
| Latence | **618 ms** |
| État | `done` → **`working`** |
| Texte | **visible dans la TUI du pane** |

**La peur d'origine du spec est morte.** `agent.prompt` écrit dans la TUI existante.

**Reste à faire — ce que E1 n'a PAS testé** : le **double-envoi** (P6 / D007.2). E1 a envoyé le prompt **une seule fois**. Le test de déduplication (envoyer deux fois le même texte, vérifier qu'un seul traitement est déclenché, et vérifier que la levée de déduplication fonctionne quand le premier envoi échoue) **n'a pas encore été exécuté**. → reporté en **T3.5**.

### T2.4 — Valider ce que l'API Herdr couvre réellement ✅ VERT

Matrice §7 de `PROTOCOL.md` remplie par observation directe. Résultats détaillés en **§10** du même fichier.

**Ce que E3 a révélé et qui change l'architecture** :

1. **`events.wait` n'implémente QUE `pane_agent_status_changed`** (avec `agent_status` obligatoire) — alors que le schéma déclare **19** variantes. Erreur serveur littérale : `unsupported_event_wait_match`.
2. **`revision` vaut TOUJOURS `0`** — sur 3 panes et 4 sources. Ce n'est **pas** un compteur de changement.
3. **Conséquence** : le rattrapage après coupure iOS **ne peut pas** venir d'Herdr. Il vient du **JSONL Pi** (E4 : append-only, inode stable, lecture par offset, 0 ligne partielle).
4. **Règle de méthode** : le schéma n'est pas la source de vérité de l'implémentation. **Toute capacité doit être vérifiée par exécution.**

**Reste `INCONNU`** : la forme livrée de `pane.agent_status_changed` (souscription acceptée, mais aucun changement d'état n'est survenu pendant l'écoute) · ce qui incrémente `state_change_seq` · le comportement à la rotation de fichier.

---

## 5. Phase 3 — MVP backend

> Chaque tâche T3.x se termine par un `bun test` vert et passe par `bun run verify`.

### T3.1 — Squelette Effect : services typés, `Layer`, cycle de vie ✅ VERT

**Actions :** `apps/server` : `Layer` pour config, logger, client Herdr ; `Schema` pour les types d'événements ; gestion propre de l'arrêt (SIGINT/SIGTERM) ;资源 (ressources) libérées à la fermeture.

**Done when** : ✅ **VERT** — le serveur démarre sur `127.0.0.1` (`lsof` le confirme, jamais `0.0.0.0`), `/api/health` renvoie `herdr 0.9.3 / protocole 22`, et `Effect.addFinalizer` arrête le serveur. `config.ts` · `main.ts`.

### T3.2 — Client Herdr (socket Unix, JSONL) ✅ VERT

`apps/server/src/herdr/Transport.ts` + `HerdrClient.ts`.

**Transport injectable** : l'interface `Transport` a un `Layer` réel (socket Unix, une connexion par requête) et un `Layer` de test (file de réponses scriptées). **Aucun test ne requiert qu'Herdr tourne**, comme l'exigeait la tâche.

**Aucune assertion de type sur les données entrantes** : tout passe par un décodage `Schema`. Une charge utile partielle reste exploitable ; un agent illisible est écarté sans faire tomber le lot (principe « dégradé propre »).

**10 tests** couvrent : liste complète, agent incomplet écarté, erreur de protocole (code + méthode), JSON malformé, enveloppe sans `result` ni `error`, panne de transport, charge utile partielle, `ping`, `ping` sans version, préservation des champs non modélisés.

**Done when** : ✅ tests verts **sans Herdr**.

### T3.3 — Lecture de l'historique Pi (JSONL, **strictement en lecture seule**) ✅ VERT

**Actions :** parser sessions, branches, tool calls. Garantir qu'aucun chemin d'écriture vers un fichier de session n'existe dans le code.

**Done when** : ✅ **VERT** — 8 tests couvrent la lecture par offset, la reconstitution d'une ligne partielle, l'absence de nouvelle donnée, la conservation d'une ligne illisible et le `parentId` de branche. **Aucune fonction du module n'ouvre un fichier en écriture.** `SessionReader.ts`.

### T3.4 — Bus d'événements + flux temps réel ✅ VERT (SSE, pas WebSocket — D009)

**Actions :**Enumerator Herdr → frontend, avec monotonie des séquences pour permettre le rattrapage après coupure iOS. Dégradation propre quand la connexion tombe.

**Done when** : ✅ **VERT** — `EventHub` à journal borné et identifiants monotones ; `/api/events` rejoue au-delà de `Last-Event-ID`, et émet **`resync`** si le journal est tronqué plutôt que de laisser un trou. Vérifié en direct (`event: ready` reçu). ⚠️ Écart assumé avec le spec : **SSE au lieu de WebSocket (D009)**.

### T3.5 — Envoi de prompt idempotent ⚠️ TEST NON EXÉCUTÉ

⚠️ **Cette tâche porte désormais le test P6 que E1 n'a pas fait.** E1 a prouvé qu'un envoi unique fonctionne ; il n'a **pas** testé la déduplication.

**Règles (D007.2)** :
1. Deux envois **consécutifs du même texte vers la même cible** → le second **supprimé**.
2. **La suppression ne s'applique que si le premier envoi a été CONFIRMÉ.** Non confirmé (erreur, timeout, aucun changement d'état) → le nouvel envoi **passe**.
3. **Confirmation** fournie par Herdr : `result.type = "agent_prompted"` **et/ou** passage en `working` (via `wait.until` ou abonnement `pane.agent_status_changed`).
4. **Fenêtre de suppression** nécessaire (ordonnée : 60 s, configurable) pour ne pas bloquer un utilisateur qui refait légitimement la même demande après la fin du travail.

**Done when** :
- test envoyant deux fois la même requête → **un seul** prompt atteint l'agent ;
- test d'un premier envoi en échec → le second **passe bien** ;
- test d'un envoi validé puis répété après la fenêtre → **passe bien**.

**Limite assumée** : crash du backend entre « envoyé » et « clé enregistrée » → la garantie saute, l'UI affiche **« état inconnu »** et jamais « envoyé » (D007.2).

**États exposés à l'UI** : `envoyé` / `en cours` / `erreur` / `état inconnu`.

---

## 6. Phase 4 — MVP frontend PWA

### T4.1 — Scaffold Vite 8 + React 19 strict ✅ VERT

**Done when** : ✅ **VERT** — `bun run build` → 235 modules, `index.js` 298 kB (94 kB gzip), `built in 540ms`. `verify` verte.

### T4.2 — PWA : manifest + service worker ✅ VERT

**Actions :** `vite-plugin-pwa@2.0.0`, mode `standalone`, icônes, `display: standalone`, couleur de thème. **Prérequis de Web Push (V1).**

**Done when** : ✅ `manifest.webmanifest` (200), `sw.js` (200), 5 entrées précachées (296 kB), `display: standalone`. **Validation « installable » sur iPhone : à faire en T6.0.**

### T4.3 — Écran Projets : workspaces et activité ✅ VERT

**Done when** : ✅ onglet Projets alimenté par `session.snapshot` (9 workspaces réels), états distingués par pastille, `unknown` en neutre pointillé.

### T4.4 — Liste multi-agents filtrable ✅ VERT

**Done when** : ✅ filtres projet + état cumulables, sélection instantanée en SPA.

### T4.5 — Écran chat : historique, rattrapage ✅ VERT

**Actions :** Markdown + code repliable, bulles, composeur fixe, indicateurs `working / waiting / done / error`, historique rechargé après reconnexion.

**Done when** : ✅ l'historique vient du JSONL Pi (rechargé en continu), le flux SSE assure le rattrapage, code/sorties en bloc repliable. **Test de coupure réseau sur iPhone : à faire en T6.0.**

### T4.6 — Envoi d'instructions avec retour d'état ✅ VERT

**Done when** : ✅ quatre états distincts affichés — *envoyé (confirmé)*, *confirmation incertaine — état inconnu*, *double envoi supprimé*, *échec*. **Jamais « envoyé » sans confirmation** (D007.2).

---

## 7. Phase 5 — Sécurité et transport (non négociable)

### T5.1 — Bind `127.0.0.1` strict ✅ VERT

**Done when** : ✅ **VERT** — `lsof` → `TCP 127.0.0.1:8794 (LISTEN)`. `hostname` est **figé à `127.0.0.1` dans le code**, non configurable par l'environnement.

### T5.2 — Tailscale Serve uniquement ⛔ BLOQUÉ (interrupteur d'administration)

**⛔ Bloqué.** Mesuré : `Serve is not enabled on your tailnet` → `https://login.tailscale.com/f/serve?node=nPAobCaTyk11CNTRL`, et `tailscale cert` → `your Tailscale account does not support getting TLS certs`. **Réglage d'administration Tailscale, hors de portée depuis la machine.**

**Repli implémenté** : `HERDR_REMOTE_BIND` accepte `127.0.0.1` ou une IP Tailscale, **refuse `0.0.0.0` et toute IP publique** (exit 1, message explicite). Vérifié : `TCP 100.80.161.83:8790 (LISTEN)`, joignable sur le tailnet, injoignable sur `127.0.0.1`.

⚠️ **Sans HTTPS, la PWA n'est pas installable sur iOS** et le Web Push V1 est impossible. Le transport reste chiffré par WireGuard. Détail : **D010**.

**Done when** : ⛔ **non atteignable sans action d'administration**. Aucun funnel n'est configuré (`tailscale serve status` → `No serve config`), donc aucun port public n'est ouvert.

### T5.3 — ACL/grants tailnet + origine des requêtes

**Actions :** restreindre le tailnet aux seuls appareils autorisés ; vérifier l'origine des requêtes HTTP/WS ; limites de débit.

**Done when** : une requête depuis un appareil non autorisé échoue ; une origine falsifiée est rejetée.

### T5.3b — Liste blanche de commandes ✅ VERT

**Actions :** aucune surface d'exécution shell générique. Chaque action exposée est nommément autorisée et journalisée.

**Done when** : ✅ **VERT** — la **seule** surface d'action est `POST /api/agents/:paneId/prompt`, dont l'effet est un `agent.prompt`. Aucun shell, aucun `command.invoke` exposé (écart E9).

### T5.4 — Non-exposition des secrets ✅ VERT

**Actions :** ne jamais renvoyer clés API, variables d'environnement, contenu complet de fichiers sans action explicite de l'utilisateur. Logs bornés.

**Done when** : ✅ **VERT** — l'API n'expose que des métadonnées d'agent, un chemin de session et la sortie terminal. Aucune variable d'environnement n'est lue ni transmise.

---

## 8. Phase 6 — Critère de succès MVP (T6.0 = porte de sortie)

### T6.0 — Test bout en bout, sur le texte exact du spec ⬜ À FAIRE (action utilisateur)

> Depuis l'iPhone, en **Wi-Fi ou 5G** : ouvrir la PWA → retrouver un agent Pi **déjà lancé** par Herdr → lire sa session → lui envoyer un message → suivre sa réponse → reprendre **la même session** sur Mac. **Sans SSH. Sans modification des droits dans `$HOME`.**

**Tout ce qui est automatisable est fait** : backend, PWA, déduplication, rattrapage, isolation réseau. Ce jalon exige un **iPhone physique**.

**Procédure :**
1. Sur le Mac, lancer le backend : `HERDR_REMOTE_BIND=$(tailscale ip -4 | head -1) bun run apps/server/src/main.ts`
2. Sur l'iPhone (Wi-Fi **ou** 5G), ouvrir `http://<ip-tailscale>:8790`
3. Retrouver un agent Pi **déjà lancé** par Herdr dans l'onglet Agents
4. Lire sa session — le contenu vient du JSONL Pi
5. Envoyer un message, suivre la réponse
6. **Reprendre la même session sur le Mac** : l'identifiant de session doit être **identique** des deux côtés

**Done when** : les 6 étapes passent, **sans SSH** et **sans modification des droits de `$HOME`**, avec preuve que la session Mac est la **même** (même identifiant, pas seulement le même contenu).

---

## 9. Phase 7 — V1 (après porte T6.0 verte)

T7.1 Arborescence subagents · T7.2 Cartes tool calls/activité · T7.3 Approbations depuis l'iPhone · T7.4 Git / code review avec validation explicite · T7.5 Notifications Web Push (PWA installée + permission) · T7.6 Pièces jointes (taille et types bornés) · T7.7 Terminal de secours (**lecture en priorité**, interaction seulement si le protocole l'autorise)

Chaque tâche : critère de fin vérifiable + `bun run verify` vert. **Les capacités non exposées par la source ne sont pas simulées** — l'absence est affichée comme telle.

---

## 10. Phase 8 — V2

T8.1 Orchestration mobile · T8.2 Recherche transverse · T8.3 Observabilité (durée, modèles, tokens/coûts **lorsque exposés**) · T8.4 Adaptateurs multi-harness (Pi/Claude/Codex, sans masquer les capacités propres) · T8.5 Préférences et UX

---

## 11. Entretien continu

### T9.1 — Renovate hebdomadaire

**Actions :** Renovate configuré sur `bun.lock` ; une PR de mise à jour **par semaine** ; CI obligatoire (`bun install --frozen-lockfile` + `verify`) ; fusion uniquement si CI verte.

**Done when** : une PR de mise à jour est générée chaque semaine et CI exécute `verify`.

### T9.2 — Dérive des formats fournisseurs

**Actions :** les versions de Herdr et de Pi changent. Un test de fumée détecte un changement de schéma JSONL et **échoue explicitement** plutôt que de produire des données fausses.

**Done when** : modifier volontairement une fixture → le test échoue avec un message nommant le champ cassé.

### T9.3 — Réévaluer la couverture Herdr/Pi

**Done when** : `docs/PROTOCOL.md` est mis à jour à chaque évolution du protocole, avec date et statut de chaque capacité.

---

## 12. Récapitulatif des portes

| Porte | Tâche | Bloque |
|---|---|---|
| G0 | T0.1 `tsgo` tranché | tout le code |
| G1 | T1.7 `verify` vert et **testé comme failing** | tout le code applicatif |
| G2 | T2.3 prompt envoyé **sans créer d'agent** | toute l'UI |
| G3 | T2.4 matrice de capacités remplie par observation | V1 |
| G4 | T6.0 critère MVP exécuté sur iPhone | V1 |

---

## 13. Fichiers de suivi à créer

| Fichier | Créé par | Contenu |
|---|---|---|
| `docs/TOOLCHAIN.md` | T0.2, T1.5 | sorties `--help` Oxc, commandes réelles, temps de typecheck |
| `docs/DECISIONS.md` | T0.1, T2.3, T2.4 | chaque décision datée, son alternative écartée, sa justification |
| `docs/PROTOCOL.md` | T0.3, T2.1–T2.4 | socket Herdr, format session Pi, matrice de capacités |
| `docs/FIXTURES.md` | T3.3 | origine, anonymisation et portée des fixtures de test |

---

## 14. Résultats du spike — ce qui est tranché et ce qui reste

**Tranché par exécution (D008)** :

| Question | Réponse mesurée |
|---|---|
| `agent.prompt` crée-t-il un agent ? | **NON** — 4 agents avant/après, panes et terminals identiques (E1) |
| Le prompt atteint-il l'agent existant ? | **OUI** — `agent_prompted`, 618 ms, texte visible dans la TUI (E1) |
| Vocabulaire de l'enveloppe livrée ? | **POINTS** pour les 3 abonnements à charge utile (E2) |
| `revision` est-il un compteur ? | **NON** — toujours `0` (E3) |
| `events.wait` sur `pane_output_changed` ? | **NON** — `unsupported_event_wait_match` (E3) |
| Rattrapage après coupure par Herdr ? | **IMPOSSIBLE** — aucun compteur exploitable (E3) |
| Le JSONL Pi est-il reliable en continu ? | **OUI** — offset, inode stable, 0 ligne partielle (E4) |
| D'où vient le rattrapage de contenu ? | **Du JSONL Pi**, jamais d'Herdr **(D008.1)** |

**Reste `INCONNU` après le spike** :

1. **Répartition exacte des événements cœur** : `pane.agent_status_changed` a été souscrit avec succès mais **aucun changement d'état n'est survenu** pendant la fenêtre d'écoute. La forme livrée de cet événement précis reste `[INCONNU]` (les autres le sont par inférence d'enveloppe).
2. **Granularité de `state_change_seq`** : constant pendant qu'un agent travaille. Ce qui l'incrémente exactement n'est pas établi.
3. **Résolution de `agent_session.kind = "id"`** : aucun cas réel observé (les 4 agents sont en `kind = "path"`). Le besoin est donc théorique à ce stade.
4. **Comportement à la rotation de fichier** : aucune rotation observée. La stratégie de lecture doit tout de même gérer `ino` changé, par prudence.

**Point laissé en suspens pour V1** : l'**arborescence des sous-agents** (P3, E3 du spec). Le spike **ne l'a pas résolue** : aucune source identifiée, ni dans le JSONL (`parentId` = branchement de conversation), ni dans les événements Herdr observés. C'est le seul point de V1 sans chemin connu.
