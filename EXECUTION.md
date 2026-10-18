# Journal d'exécution — migration Rust `plan/rust-backend`

Worktree unique : `.worktrees/rust-backend`, branche `plan/rust-backend`, base d'exécution `d19f98d23b02cacf7d6d9d97facf8d6360b0546b` (inventaire historique figé `576bbf4902a00d3ef9702b4df315c943c7ac5680`). Chaque tâche consigne ici sa commande, son résultat et son commit. Rien n'est exécuté sur un service réel ; aucun agent de l'utilisateur n'a été contacté (règle AGENTS.md, transport factice seulement).

---

## T001 — Référence, baseline, corpus et bundle benchmark

Périmètre : `compatibility/, EXECUTION.md` — geler la base d'exécution + BASELINE-DELTA, créer `baseline.json`, `coverage.json`, `EXECUTION.md`, corpus synthétique de référence, contrôles/mesures TS, bundle benchmark gelé avec hash.

### Environnement

| Outil |	Version | Remarque |
|---|---|---|
| rustc / cargo | 1.94.1 (2026-03-25) | toolchain cible TECH §2 |
| bun | 1.4.2 | exécution contrôles TS + générateurs dev |
| node | 24.21.0 | engines du dépôt |
| effect | 4.0.2 | autorité de contrat TS courante |
| oxfmt / oxlint / tsc | 0.72.0 / 1.87.0 / 7.0.2 | installation locale du worktree (`bun install`) |

`bun install` a été exécuté une fois dans le worktree : l'installation locale était absente (seuls les devtools racine existaient), et `typecheck`/`lint` échouaient uniquement sur la résolution d'`effect`. Aucun fichier source n'a été modifié par cette installation.

### Livrables produits

| Fichier | Contenu |
|---|---|
| `compatibility/baseline.json` | Index gelé : **89 capacités** (O01–O10, H01–H18, D01–D22, A01–A15, E01–E10, S01–S14) avec attente conservée + tâches + cible de test future ; **18 routes** H01–H18 avec jeux de statuts attendus ; **17 clés env** avec défaut/consommateur ; **171 déclarations + 11 schémas inline** extraits de CONTRACTS.md ; **48 modules source** avec propriétaire Rust (SOURCE-MAP.md) ; **27 corrections C01–C27** (comportement courant → comportement Rust, tâches) ; **22 faits de défauts connus** (jamais effacés, chacun lié à sa correction ou explicitement « no change ») ; **33 budgets** de ressources (liste de référence T065) ; unions littérales du fil. |
| `compatibility/coverage.json` | Pour chaque ID : tâches de livraison, tâche de preuve finale T064, cible de test ; pour chaque correction : tâches + preuve ; référence de baseline historique. |
| `compatibility/scripts/build_baseline.py` | Générateur reproductible des deux JSON ci-dessus (décomptes assertés en dur : 89/18/17/171/11/48/27). |
| `compatibility/contracts/corpus.json` | **Corpus synthétique de référence : 296 échantillons.** 269 vérifiés par exécution contre l'autorité TS (`Schema.decodeUnknownSync` sur api.ts/protocol.ts + 6 schémas inline d'Api.ts), 11 cas de curseur (codés/décodés via la sémantique `decodeCursor` : base64 illisible, offsets négatif/non-entier, dev/ino 0 legacy, champs surnuméraires tolérés), 16 formes *construites* (SSE, push store/payload, vocabulaire `Method`, `SUPPORTED_EVENT_WAIT_MATCHES` — figées depuis le code de routage/persistance car aucun décodeur TS n'existe au baseline). Le fichier est **pur JSON** : il ne dépend pas de la façade TS remplacée à T057. |
| `packages/shared/scripts/build_contract_corpus.ts` | Générateur dev du corpus (fail-fast : tout échantillon qui se comporte autrement que sa consigne fait échouer la construction). Situé dans le workspace `packages/shared` pour la résolution d'`effect`. |
| `compatibility/contracts/README.md` | Procédance, distinctions enregistrées (optionnel ≠ nullable, union littérales fermées, inconnus supprimés, curseur), note C03 (le défaut baseline est enregistré comme échantillon négatif, pas effacé). |
| `compatibility/ts-controls/controls.txt` + `junit-baseline.xml` + `test-case-manifest.txt` | Contrôles TS gelés : format/lint/typecheck PASS, `bun test` **1080 pass, 0 fail, 0 skip, 2109 expect(), 59 fichiers** ; manifeste par fichier (somme des suites de premier niveau = 1080 exactement ; les blocs `describe` imbriqués JUnit ne sont pas comptés deux fois). Référence exacte que T004 doit retrouver après déplacement des tests. |
| `compatibility/benchmark/fixtures/**` (76 artefacts + manifest.json) | Bundle benchmark **synthétique et déterministe** : 55 sessions Pi JSONL (≥40 Kio chacune, via `ecrireFixture` LCG seedé, formes Pi réelles), 10 sessions codex rollout-shaped (`response_item`/`event_msg`/`turn_context`, contexte injecté à filtrer), 10 sessions claude shaped (user/assistant, tool_use/tool_result, ligne `api-request-blob` à exclure), `opencode.db` (session_v2/session_message, 50×120 lignes, types mixtes y c. data-URI image/idle/system/model-switched), `devin.db` (sessions/message_nodes, 50×120), base Pi 2 Mio pour le scénario delta. `manifest.json` : sha256 + taille par artefact, graine, hôte, version bun, **7 scénarios figés** (panes-1/10/50, clients-1/4/8, cold-warm, delta32MiB, lockDB, sse-idle). |
| `compatibility/benchmark/generate.ts` + `README.md` | Générateur dev du bundle (⛛ flag `--delta`) et runbook de vérification. |
| `compatibility/benchmark/fixtures/delta/` (gitignoré) | Appending 32 Mio **non committé** mais figé par hash : graine 21 050 318, 33 554 963 octets, sha256 **`51f047366143a5b432ed475445a6d9a93af9820296b0dd1e5ea8e7ffe20731da`** enregistré dans `manifest.json` (`sha256Expected`), à régénérer+vérifier par le harnais avant chaque mesure T065. |
| `EXECUTION.md` | Le présent journal. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `python3 compatibility/scripts/build_baseline.py` | OK — compte vérifié : `capabilities=89 routes=18 env=17 decls=171 inline=11 mods=48 corrections=27 defects=22 budgets=33` (assertions dures). |
| `bun packages/shared/scripts/build_contract_corpus.ts` | OK — `corpus: 296 samples (schema-verified: 269, route-guard: 0, cursor: 11, constructed: 16)`. Trois mismatches initiaux corrigés **du côté des consignes** (pas du vérificateur) : `id: null` sur `SessionEntry` est en réalité rejeté (optionnel ≠ nullable) ; `InstalledKind.state` est une string libre (valeur `not_installed` acceptée au niveau schema, le filtrage est politique de lancement A06) ; un tableau `PaneLayout.panes=[]` est accepté (contrairement à mon intuition initiale). Aucun verdict enregistré n'est une supposition. |
| `bun compatibility/benchmark/generate.ts` | OK — 78 fichiers au premier passage, 76 artefacts + note delta au manifeste après re-run. |
| `bun compatibility/benchmark/generate.ts --delta` | OK — delta 32 Mio écrit, sha256 gelé dans le manifeste. |
| Déterminisme vérifié | Re-génération complète du bundle comparée par sha256 : **tous les hashes identiques** (`hash diffs: none`). |
| `bun run format:check` | PASS (152 fichiers). |
| `bun run lint` | PASS (exit 0). |
| `bun run typecheck` | PASS (exit 0). |
| `bun test` | PASS — **1080 pass / 0 fail / 0 skip sur 59 fichiers**, 2109 expect() ; JUnit + manifeste copiés dans `compatibility/ts-controls/`. |

### Décisions et honnêteté (notées, pas masquées)

0. **Correction de type et de grille en cours de tâche** : le premier jet du générateur de corpus passait entre les mailles de `tsc` — `tsconfig.json` ne couvrait pas `packages/*/scripts`. Méthode corrigée : `tsconfig.json` inclut désormais `apps/*/scripts/**/*` et `packages/*/scripts/**/*`, et le registre de vérification du corpus est typé `Schema.ConstraintDecoder<unknown>` avec imports nommés directs (aucune assertion, aucun `any`) — c'est la garde `noUncheckedIndexedAccess` qui a rendu le `HealthResponse` manquant visible. La preuve « chaque verdict est exécuté » tient ; la voie m'y a fait corriger deux consignes (voir plus bas) et une omission d'import.
1. **Générateur du corpus dans `packages/shared/scripts/`** (et pas `compatibility/scripts/`) : la résolution d'`effect` suit le fichier importateur ; un `package.json` imbriqué aurait créé un second lockfile. La sortie reste dans `compatibility/contracts/`.
2. **Delta 32 Mio non committé** : régénérable octet-pour-octet ; le hash attendu est gelé dans le manifeste, le harnais T065 doit vérifier avant mesure. Les autres artefacts sont committs (12,7 Mio au total).
3. **Échantillons « construits » (16)** : SSE/push/`Method`/`EventWait` n'ont aucun décodeur au baseline (forme produite, pas décodée) ; ils sont figés comme données avec `provenance`, et T053/T057 devront s'y plier. Ce n'est pas une vérification, c'est une consigne gelée — dit tel quel.
4. **Les échantillons inline d'Api.ts** (PromptBody/TrustBody/AnswerBody/ClientLogBody/SubscribeBody/UnsubscribeBody) sont vérifiés par exécution via des copies Shape-identiques des schémas d'Api.ts (source : `Api.ts:82,145,164,385–402,489–494`). La règle `endpoint.startsWith("https://")` est **en dessous** du schema : enregistrée comme échantillon brut `SubscribeHttpPrefixRule`, elle est une consigne de route, pas un verdict de schema.
5. Aucun socket, CLI d'agent, session utilisateur ou service Herdr n'a été utilisé ; tout est synthétique et local au répertoire du worktree.

### Correction post-commit (rattrapage de preuve)

Le `git add compatibility/` du commit T001 a **silencieusement sauté** les deux fixtures `opencode.db` et `devin.db` : la règle préexistante `*.db` de `.gitignore` s'appliquait aux chemins ajoutés par lot. Découvert pendant T002 en préparant l'ajout de `target/` au `.gitignore`. Le manifeste T001 référençait pourtant leurs sha256 (1 667 072 et 1 888 256 octets) — l'arbre committé était incomplet par rapport à sa propre preuve. Correction immédiate : ajout forcé (`git add -f`) après vérification par exécution que les deux fichiers sur disque matchent exactement les empreintes du manifeste ; commit distinct préfixé `T001-fix:` (le hash de T001 n'est pas réécrit). La règle du journal reste : **aucun écart ne se masque, un écart se corrige et se consigne**.

### Commit

Commit `T001` : message préfixé `T001:` — identifiable par `git log --grep '^T001:'`. Contient l'intégralité des livrables ci-dessus, plus `tsconfig.json` (inclusion `scripts/**` au typecheck, voir décision 0). Les documents de base préexistants non commités (`specs/rust-backend/*.md`, règles `AGENTS.md` « Migration Rust ») sont inclus dans ce commit : c'est la « base d'exécution gelée » que T001 est censé figer, et ils restent ensuite inchangés sous version. Aucun autre fichier préexistant n'est touché.

> Rattrapage : commit `T001-fix:` (voir « Correction post-commit » ci-dessus) pour les deux fixtures `.db`.

---

## T002 — Manifestes Cargo, toolchain et verrou

Périmètre : `Cargo.toml` racine (workspace virtuel), `rust-toolchain.toml`, 13 manifests de membres, `Cargo.lock` suivi, `.gitignore` (artifacts Rust).

### Livrables produits

| Fichier | Contenu |
|---|---|
| `Cargo.toml` (racine) | Workspace virtuel, `resolver = "3"`, 13 membres. `[workspace.package]` : `edition = "2024"`, `rust-version = "1.94.1"`, `publish = false`, `version = "0.0.0"` — hérités par chaque membre. `[workspace.dependencies]` centralise versions+features (serde 1.0.229, serde_json 1.0.145, schemars 1.2.3, tokio 1.53.3, axum 0.8.9, rusqlite 0.40.2 bundled, tracing 0.1.44, tracing-subscriber 0.3.20, base64 0.23.1, sha2 0.11.1, web-push 0.11.0). `[workspace.lints]` : `unsafe_code = "deny"`, `unreachable_pub = "warn"`, clippy `all`/`unwrap_used`/`expect_used` en `warn`. |
| `rust-toolchain.toml` | `channel = "1.94.1"` (version installée, prouvée), `profile = "minimal"`, composants `rustfmt` + `clippy` (exigés par T003). |
| `crates/{domain,contracts,herdr-client,sessions,catalog,interactions,files,notifications,application,http-api,herdrchat,test-support}/Cargo.toml` | Un manifeste par crate lib, noms **sans préfixe** (`hc-` débit interdit), deps externes uniquement héritées (`workspace = true`), deps internes par `path`, `[lints] workspace = true`. |
| `xtask/Cargo.toml` | Binaire (dépend uniquement de `contracts`, conformément au graphe TECH §2), `[lints] workspace = true` (omise au premier jet, corrigée à chaud). |
| `crates/*/src/lib.rs`, `*/src/main.rs` | 13 stubs documentés minimum compilables ; les modules réels arrivent avec les tâches propriétaires (T005+). |
| `Cargo.lock` | 284 paquets verrouillés compatibles 1.94.1, suivi en version. |
| `.gitignore` | `target/` + `**/*.rs.bk` ajoutés ; `Cargo.lock` reste suivi. |

Arêtes internes implémentées (identiques au graphe TECH §2, ni plus ni moins) : `contracts→domain` ; `herdr-client→domain` ; `sessions→{domain,files}` ; `catalog→domain` ; `interactions→domain` ; `files→domain` ; `notifications→{domain,files}` ; `application→{domain,interactions}` ; `http-api→{application,contracts,domain}` ; `herdrchat→{http-api,application,herdr-client,sessions,catalog,interactions,files,notifications}` ; `test-support→domain` (dev-seul, rien de production ne dépend de lui) ; `xtask→contracts` ; `domain→∅`.

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo generate-lockfile` | 284 paquets verrouillés pour Rust 1.94.1 compatible ; zéro `git =`, zéro `*`. |
| `cargo build --locked` | OK — 37.56 s au premier passage (rusqlite bundled, ece, web-push compilés) ; 1.13 s après le correctif `[lints]` de `xtask`. |
| `cargo clippy --locked` | Propre — 0 avertissement, 0 erreur sur les 13 stubs. |
| `cargo fmt --check` | Propre (aucun diff). |
| `rustc --version` | `rustc 1.94.1 (e408947bf 2026-03-25)` — la toolchain figée est réellement celle utilisée. |
| Script de preuve (`cargo metadata --no-deps`) | **PREUVE T002 OK** : 13 membres ; arêtes internes exactes vs TECH (aucune de plus, aucune de moins) ; DFS terminant sur ordre topologique ⇒ acyclique ; `edition = 2024`, `rust-version = 1.94.1`, `publish = false` partout ; toute dep externe hérite du workspace, toute dep interne est un `path` ; zéro `git =`/`branch =`/`*`/version locale ; zéro préfixe `hc-`. |

Ordre topologique prouvé : `domain, interactions, application, catalog, contracts, files, herdr-client, http-api, notifications, sessions, herdrchat, test-support, xtask`.

### Décisions (consignées, réversibles task par task)

1. **Déps externes centralisées dès T002, consommées plus tard** : tout ce que TECH §2–§8 nomme explicitement (serde/schemars, rusqlite, axum, tokio, tracing, web-push) + base64/sha2 pour le codec de curseur (T024) est gelé en versions au workspace ; un membre les activera par `workspace = true` quand sa tâche arrive. Rien d'autre n'est prématuré.
2. **`http-api→domain` dès maintenant** : TECH le permet explicitement (« peut dépendre des types de domain selon les besoins ») ; figer l'arête maintenant verrouille la forme du graphe pour la preuve T064 au lieu d'un ajout silencieux en cours de route.
3. **Lint workspace modeste** (deny `unsafe_code` ; warn `all`/`unreachable_pub`/`unwrap_used`/`expect_used`) : T003 (xtask CI) le propagera en strict ; les durcissements par crate viendront avec leurs tâches.
4. **`schemars 1.2.3`** : génération JSON Schema 2020-12 en Rust — pendant des schémas de DTO que T009 expose et que le corpus T001 vérifie.
5. **Omission corrigée à chaud** : `[lints] workspace = true` manquait sur `xtask` au premier jet — attrapée par le contrôle de politique des deps, corrigée, preuve relancée.
6. **Édition de journal ratée puis réparée** : ma première insertion de la section T002 a remplacé l'en-tête T001 au lieu d'appendre ; structure réparée par script (assertion sur l'ancrage), contenu T001 intègre.

### Commit

Commit préfixé `T002:` : `Cargo.toml` (racine), `rust-toolchain.toml`, `Cargo.lock`, `crates/**` (13 manifests + stubs), `xtask/Cargo.toml` + stub, `.gitignore`. Aucune implémentation supplémentaire ; aucun `#[test]` sous `src/` (il n'y a que 13 stubs de compilables). Le déterminisme du verrou tient : aucun `cargo update` n'a été passé ; tout rebuild reproduit le graphe depuis les empreintes de `Cargo.lock`.

---

## T003 — `xtask verify`, `verify-layout` et CI

Périmètre : `xtask, .github/workflows` — ajouter `xtask verify` (format/clippy/tests externes/graphe), la porte `verify-layout` (fichiers suivis ou nouveaux, analyse sans builds ni dépendances, sans descendants dans les worktrees imbriqués) et la CI correspondante. Contrats ajoutés à T009 ; frontend complet à T057 (délibérément ABSENTS aujourd'hui).

### Livrables produits

| Fichier | Contenu |
|---|---|
| `xtask/src/lib.rs` + `src/{layout,graph,allowlist,run}.rs` + `src/main.rs` | xtask devient lib+bin : moteur de portes PUR (layout/graph/allowlist) testable depuis `tests/`, orchestration par processus dans `run.rs`, CLI mince (`verify`, `verify-layout`, `graph`, option `--root <dir>` pour les sondes). |
| `xtask/src/layout.rs` | Règles TS/Rust exactement celles d'AGENTS.md : `*.test.*`/`*.spec.*` sous `src/`, `#[test]`/`#[tokio::test]`/`#[cfg(test)]`/`mod tests`/`include!(…tests…)` hors `tests/` ; jetons composés à l'exécution (voir décisions 1) ; strip naïf documenté des commentaires rust ; chemins `.worktrees/`/`target/`/`node_modules/`/`dist/`/`coverage/`/`.git` ignorés et COMPTRÉS, jamais analysés ; `.rs` illisible = violation apparente (« unreadable-rust-source »), jamais un silence. |
| `xtask/src/graph.rs` | Arêtes internes TECH §2 figées en données (13 membres) + comparaison EXACTE (aucune arête plus, aucune en moins, resensée nom par nom) + DFS de cyclage avec topologie sortie en preuve. |
| `xtask/src/allowlist.rs` | Structure JSON des exceptions TS historiques (`note`, `untilTask`, `entries`) : seule la règle `ts-test-under-src` est pardonnable, une entrée dont le fichier disparaît devient `allowlist-stale` (échec), une expiration ≠ T004 est illégale de bout en bout. |
| `xtask/layout-allowlist.json` | **59 entrées explicites** (tous les fichiers TS de test sous `src/` — la même liste que le manifeste T001, 59 fichiers/1080 cas), `untilTask: "T004"`. |
| `xtask/tests/unit_tests.rs` | Corpus de sondes SYNTHÉTIQUES debout (TECH §11 « negative fixture proving rejection ») : 13 tests — inline `#[cfg(test)]`+`mod tests`+`#[test]` nommés sous `src/`, corps identique silencieux sous `tests/`, `#[tokio::test]` ligne exacte, `include!` hors tests, neutralité des commentaires, règles TS par chemins, skip `.worktrees`/`target`/`node_modules`, allowlist (pardon TS listé, jamais rust, non-listé reste ouvert, stale échec, expiration illégale), graphe figé == lui-même + arête interdite `files→sessions` nommée + membre surnuméraire + arête inversée + cycles nommés, **auto-garde** (le scanner reste silencieux sur son propre `src/`). |
| `.github/workflows/verify.yml` | Deux jobs : `frontend-legacy` (bun install --frozen-lockfile + `bun run verify`) protège le système en place ; `rust` (dtolnay/rust-toolchain@1.94.1 + rustfmt/clippy, cache) exécute `cargo run --locked -p xtask -- verify` — les cinq portes en un point d'entrée. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo run --locked -p xtask -- graph` | OK — `graphe conforme (ordre: domain interactions application catalog contracts files herdr-client http-api notifications sessions herdrchat test-support xtask)` (le même ordre topologique que la preuve T002). |
| `cargo run --locked -p xtask -- verify-layout` | OK — `329 fichiers analysés (0 worktrees imbriqués ignorés, 0 sortis), 59 autorisés (historique T004), 0 ouverts`. |
| `cargo run --locked -p xtask -- verify` | OK — les cinq portes (`verify-layout`, `graph`, `format`, `clippy` [deny warnings], `tests` [workspace --locked]) en 1er passage. |
| `cargo test --locked -p xtask` | **13 passées / 0 échouées / 0 ignorées** (le corpus de sondes). |
| `clippy --workspace --all-targets --deny warnings` | Propre. |
| **SONDES** (corpus synthétique, journal ci-dessous) | Chaque porte prouvée capable d'échouer au niveau CLI réel : voir « Sondes ». |
| `ruby -ryaml` (vérif workflow) | `jobs valides: frontend-legacy, rust (workflow: verify)` — les deux jobs annoncés et les commandes clés présentes. |

### Sondes (corpus synthétique — toutes retirées après usage, arbre réel intact)

| Sonde | Montage | Réultat attendu (obtenu) |
|---|---|---|
| A — test TS sous src | repo git tmp, `apps/web/src/etape.test.ts` + allowlist vide | porte échoue, `ts-test-under-src` nommé exactement |
| B — allowlist TS listé | l'entrée `etape.test.ts` est ajoutée | « 1 autorisés », la violation rust reste ouverte : le pardon TS ne touche jamais les règles rust (échec attendu conservé sur 3 règles rust) |
| C — module inline rust | `crates/foo/src/lib.rs` avec `#[cfg(test)]`+`mod tests`+`#[test]` | trois règles nommées avec numéro de lignes (2/3/4) |
| D — entrée stale | fichier retiré, entrée conservée | `allowlist-stale` échoue (aucune exception persistante possible) |
| E — état sain | corpus neuf : seul `tests/unit/foo.rs` + worktree imbriqué | porte VERTE, worktree compté « (1, worktrees imbriqués ignorés) », 0 analysés de travers |
| 4' — dépendance interdite | copie manifestes-seule dans tmp, `catalog→sessions` ajouté (acyclique, cargo le tolère) | la porte GRAPHE nomme exactement `arêtes internes de «catalog» divergent: ["domain","sessions"] ≠ ["domain"] (TECH §2)` et sort en échec |
| (4-rem) — dépendance cyclique | `files→sessions→files` | cargo lui-même refuse la résolution (double filet implicite), légitime et consigné |
| Retrait final | `rm -rf` des trois tmp | `git status` : aucun fichier de sonde ; 0 modification des manifestes réels |

Défaut d'édition corrigé en cours de tâche, consigné : la sonde E du premier passage a montré `unreadable-rust-source` car `git ls-files` liste des fichiers supprimés restés dans l'index — comportement honnête du moteur (il DIT, il ne feint pas), l'état VERT a été prouvé sur corpus propre.

### Décisions (consignées)

1. **Jeton composés à l'exécution dans les règles du scanner** : la porte se scanne elle-même (`xtask/src/**` est dans le lot) ; écrire les littéraux interdits dans le scanner ferait du scanner un auto-violateur. Les jetons sont assemblés (`"#[cfg({})]"`, etc.) et le test d'auto-garde (lecture réelle des 6 fichiers sources) verrouille le piège pour l'avenir.
2. **Un seul jeton par ligne est reporté, en bombant la limite** : la porte doit échouer, pas énumérer. L'aggravation (tous les jetons) arrivera si une tâche le réclame avec preuve.
3. **Listage des fichiers via `git ls-files --cached --others --exclude-standard`** : « suivis ou nouveaux », `.gitignore` respecté de bout en bout (le `target/` et les node_modules ne rentrent jamais), racine bornée au worktree (pas de descente dans `.worktrees/`).
4. **`--root <dir>` sur le CLI** : permet les sondes sur corpus synthétique SANS toucher l'arbre réel ; cette option fait partie du contrat (documentée dans le `--help` du main.rs minimal).
5. **Allowlist = JSON explicite exigeant le fichier** : après T004, la liste vit avec `entries: []` (sa suppression complète est une décision d'une tâche suivante documentée) — c'est la garde la plus honnête contre l'évasion silencieuse (supprimer le fichier aujourd'hui serait une evasion sans trace).
6. **CI : bun jobs + rust jobs séparés** : le système TS restant (référence jusqu'à T057) continue d'être protégé exactement comme `release.yml` le fait ; le job rust n'ajoute que le plan nouveau, sans mélanger les toolchains.
7. **Rien sur les contrats ni le frontend ici** : T009 ajoute `contracts export/check` ; T057 Ajoutera le coverage frontend complet. Aucun stub fantôme dans le CLI (la sous-commande inconnue répond honnêtement « usage »).

### Preuves où elles vivent

- Les sondes façonnées à la main (sondes A/B/C/D/E/4') sont consignées ci-dessus et n'existent plus sur disque (exemple : `probe-t003*` supprimés) ;
- les sondes DEBOUT (13 tests de `xtask/tests/unit_tests.rs`) rejouent en continu à chaque `cargo xtask verify`/CI ;
- les échecs nommés exactement (règle + path + ligne) doivent être visibles dans le journal CI si l'une des règles est brisée.

### Commit

Commit préfixé `T003:` : `xtask/**` (lib/bin/allowlist/tests), `.github/workflows/verify.yml`. Aucune `src` de production modifiée, zéro test sous `src/`, zéro impact sur les 13 crates stub, zéro dump de contenu utilisateur.

---

## T004 — Déplacement des tests TS hors de `src/`

Périmètre : `apps/*/tests, packages/shared/tests` — déplacer les 59 tests TS de `apps/*/src` et `packages/shared/src` vers leurs dossiers `tests/`, corriger imports et lectures de fixtures/CSS/source sans affaiblir les assertions, puis activer `verify-layout` global **sans exception historique**. Aucun refactoring fonctionnel.

### Livrables produits

| Livrable | Détail |
|---|---|
| 59 fichiers déplacés en `git mv` | Miroir structurel : `apps/server/src/agents/T.test.ts → apps/server/tests/agents/T.test.ts`, etc. `apps/web` (src plat → tests plat), `packages/shared` idem. |
| 76 lignes d'import recalculées | Chaque specifier relatif est résolu par **existence réelle du fichier cible** (extension conservée si présente, candidats testés sinon ; extension jamais inventée), puis re-dérivé depuis le nouveau dossier. Vérifié après coup : 0 specifier local `./x` résiduel (le seul littéral `./Feuille.tsx` restant est une **garde de texte source**, voir ci-dessous). |
| Sauts `import.meta.dir` remappés | 44 sauts réécrits par résolution absolue ancienne→nouvelle (charger `styles.css`, `ChatScreen.tsx`, `Blocks.tsx`, `Api.ts`, `routes-sessions.ts`, `index.html`…), plus les cas dérivés : `lire()` et `readdirSync` de `focus.test.ts`, tableau-fichiers de `launch.test.ts` — tous pointés vers `../src` pour lire exactement les mêmes fichiers qu'avant le déplacement. |
| Gardes de texte source intactes | Le déménageur a muté UNE garde (`toContain('from "./Feuille.tsx"')` — un littéral d'attente, pas un import réel). Attrapée par audit diff ancien/nouveau, restaurée à l'identique ; les gardes parlent du CONTENU des sources, dont les specifiers réels n'ont jamais bougé. |
| `xtask/layout-allowlist.json` vidée | `entries: []` après preuve `git ls-files | grep -E '.(test|spec).'` = 0 sous `src/`. La porte layout est désormais **globale** : 329 fichiers analysés, 0 autorisés, 0 ouverts. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| Déménageur (script dev-only, hors repo) | 59 déplacements `git mv` ; contenu corrigé AVANT le move (le fichier déplacé porte déjà ses imports corrigés) ; aucun fichier non-test touché. |
| Remappeur de sauts + retouches ciblées | `chat-layout` (25 sauts), `chargement-session` (2), `Lisibilite`+`Fixture` (server), `focus` (`lire`, `readdirSync`), `launch`, `feuilles`, `feuilles.focus` — toutes cibles vérifiées existantes avant écriture. |
| `bun run format / format:check / lint / typecheck` | Tous verts (153 fichiers). |
| `bun test` | **1080 pass / 0 fail / 0 skip / 2109 expect() / 59 fichiers.** |
| junit avant/après (comparaison programmatique) | **Manifeste IDENTIQUE à T001** : mêmes 59 fichiers appariés un à un (chemin `src→tests`), mêmes compteurs cas+assertions par fichier, `delta: AUCUN`. Un état intermédiaire avait révélé `focus.test.ts: 109→46 assertions` — corrigé avant commit (décision 2). |
| `cargo run --locked -p xtask -- verify` | Vert sur les cinq portes — layout **sans aucune exception** désormais. |

### Décisions / honnêteté

1. **Le piège du `readdirSync` — attrapé par le manifeste, pas par les yeux.** `focus.test.ts` énumérait `readdirSync(import.meta.dir)` : après déplacement il listait `tests/` (0 `.tsx`) → boucle vide, test passant À VIDE, 63 assertions invisiblement perdues (junit : 109→46 sous le même compteur de cas 20→20). `bun test` seul donnait « 1080 pass » sans indice visible. La comparaison junit fichier par fichier (T001 vs T004) a fait surface, `readdirSync` repointé vers `../src`, retour à 109 expect() dans le fichier — la porte « zéro cas perdu » n'est pas une impression, c'est un diff.
2. **Une garde corrompue, restaurée, jamais affaiblie.** Le déménageur générique réécrivait les littéraux `from "…"` AUSSI dans les chaînes d'assertion (`toContain`). Un seul site touché (diff programmatique ancien↔nouveau sur les 59 fichiers) ; littéral d'origine restauré. La leçon est consignée : un remappeur textuel d'imports doit exclure les chaînes d'attente — à T009 (contrats) cette classe d'outils sera réécrite avec un parseur.
3. **Résolution par existence, jamais par invention.** Chaque specifier a été résolu contre des fichiers réellement présents ; en cas d'échec : rapport + non-écriture (zéro « extension inventée »). Les erreurs intermédiaires visibles en cours de tâche (7 échecs `ENoENT` feuilles/focus/launch puis corrigés) faisaient partie du chemin de preuve, pas de l'état final.
4. **verify-layout activé global.** La liste historique est vidée (`entries: []`) après preuve chiffrée (0 fichier de test sous `src/`). Le fichier JSON reste présent et exigé par la porte (décision T003 n°5) : le supprimer maintenant serait une évasion silencieuse ; sa suppression complète, si souhaitée un jour, sera une décision de tâche explicitement consignée.
5. **Aucune écriture dans un agent réel, aucun store touché** : uniquement des fichiers du worktree, des captures junit dans le tmp dir de l'environnement (jetables).

### Commit

Commit préfixé `T004:` contenant les renames `apps/*/tests/**`, `packages/*/tests/**`, la suppression des fichiers sous `src/`, l'allowlist vidée, la section du journal. Aucune modification des sources TS non-test, aucune modification Rust, aucun test sous `src/`.

---

## T005 — Crate `domain` : valeurs, causes, preuves partielles, ports étroits

Périmètre : `crates/domain/src + crates/domain/tests` — IDs distincts, observations/générations, statuts fermés, causes nommées, preuve partielle, messages/réglages/raw, noms/rangs (D04, owner primaire) et les cinq ports étroits. Aucune E/S, aucun runtime, zéro comportement applicatif (l'enrichissement reste T039, les lecteurs T023).

### Livrables produits

| Livrable | Détail |
|---|---|
| 9 modules, exactement la liste TECH §2 | `ids, status, observation, session, catalog, errors, ports, naming, notifications` + `lib.rs`. Aucun module en plus, aucun en moins. |
| `ids` — 9 newtypes distincts | `PaneId, TabId, WorkspaceId, SessionId, AgentName, AgentKind, RequestId, DeliveryFingerprint, SourceKey`. Aucune conversion **de famille à famille** n'existe dans l'API : la confusion est refusée à la compilation. Tous dérivent `Ord` (ordre d'octets — nécessaire au `NamingContext`, décision consignée). |
| `status` — unions fermées | `AgentStatus` (`idle|working|blocked|done|unknown`, libellés fil exacts) + `SessionState` (`available|absent|error`) ; serde verrouillé et l'inconnu **rejeté** (testé) ; fonctions totales `statut_d_agent`/`etat_de_session`. |
| `observation` — monde Herdr normalisé | `Generation, Millis, Observation<T>, Snapshot (+ SnapshotProvenance), AgentObservation, WorkspaceObservation, TabObservation, PaneLayoutObservation, ScreenObservation, UpstreamPing` ; vues `AgentView`/`WorkspaceView`, homologues des schémas `AgentViewSchema`/`WorkspaceViewSchema` de `api.ts` ; **tri-état `CwdMatch`** (Matched/Mismatched/Unverifiable — `null` ≠ `false`, D03) ; `tabs`/`layouts` en `Option<Vec<_>>` : absent ≠ vide (mesuré). |
| `session` — messages/réglages/raw | `LignePi`/`PiMessage` (+ alias `NormalizedMessage`), `ChangePi`/`ReglageKind` (+ alias `NormalizedSettings`), `RetainedUnknown`, `FilteredContext`, `NormalizedEntry` (quatre conséquences), `SessionEntry` (raw public, clefs du fil `type`/`parentId` verrouillées), `SessionPageOutcome` (cinq conclusions nommées : Absente/Vide/Invalide/Io/Page), `ResolvedSource`/`SessionHint`/`SessionPageRequest`/`SessionPage` (curseurs opaques), `SessionMetadata` (absent = absent, D18), `SourceBinding` (pane ⇄ source, les deux clefs — classe C12/C20). |
| `errors` — causes et taxonomie de port | `ReadCause` (`absente|vide|invalide|io`, verbatims FR du fil actuel, B03) + `ReadVerdict` (bénin seulement pour `absente`/`vide`), `verdict_of_io` (décision sur la nature d'erreur, jamais sur le texte), `invalid_session` (détail dans le message), `PortError` — cinq natures où la cause amont est préservée et une décision de politique n'est pas une panne. |
| `ports` — cinq traits dyn-compatibles | `ControlPort, SessionPort, CatalogPort, ArtifactPort, NotificationPort` ; `PortFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, PortError>> + Send + 'a>>` — uniquement du `std`. Preuves : `PromptEvidence` (Confirmed / Unknown + étapes partielles / Suppressed / Failed), `TransportEvidence`, `PartialStep`, `FocusEvidence`, `StopEvidence`, `StartEvidence` (`ShellNotReady` rejouable, C07), `DeliveryOutcome` (jamais « envoyé » sans preuve, A02). |
| `naming` — D04, owner primaire | `ranks_of_panes` (ordre mesuré y→x→id sur la disposition à cinq panes ; sans rectangle, pas de rang), `pane_label` (nom choisi > nom qui répète écarté > « pane N » > rien), `launch_name` (suffixes 1..=99 ; **épuisement → `None`** — correction C07/A07 : le fil actuel rendait un nom potentiellement pris), `useful_label`/`est_numerique` (une règle pour tout le dépôt), `checkout_path_of` (worktree lié gagne, sinon premier `cwd` du projet — D02), `NamingContext::from_pieces`/`from_snapshot` (sans layouts, pas de rang ; le nom choisi continue de parler). |
| `notifications` | `VapidPublicKey`, `BrowserSubscription`/`PushSubscriptionKeys` (`p256dh`/`auth`), `PushEndpoint`, `PushPayload` (`{title, body, tag, url}` — formes exactes du push actuel) + `AgentAttentionEvent` : les faits, pas des mots — `gone` n'est pas un `AgentStatus`, aucune raison inventée. |
| 64 tests verts | `tests/unit_tests.rs` + `tests/unit/` (9 sous-modules). Les énums d'état sont prouvées par aller-retour serde sur tous leurs libellés + rejet de l'inconnu (`AgentStatus`, `SessionState`, `ReadCause`, `ReglageKind`) ; l'exhaustivité variantielle est prouvée par **match sans joker** (`NormalizedEntry`, `SessionPageOutcome`, `PromptEvidence`, `StartEvidence`, `TransportOutcome`, `FocusEvidence`) ; les futures de ports sont lues via `std::task::Waker::noop()` — aucun exécuteur, aucune dépendance de plus. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p domain --all-targets --locked` | **64 passed / 0 failed / 0 ignored.** |
| `cargo clippy -p domain --all-targets -- -D warnings` | OK, après corrections de lints : `map_or(false, …)` → `is_some_and` (×2), `large_enum_variant` → `Message(Box<LignePi>)`, et cinq `match` à bras unique resserrés en `if let` (détail en décision 6 et 7). |
| `bun run format:check` puis `lint` puis `typecheck` | Tous verts (153 fichiers — TypeScript inchangé). |
| `cargo run --locked -p xtask -- verify` | **Cinq portes vertes** : layout (349 fichiers analysés, 0 autorisés, 0 ouverts), graph (ordre topologique conforme), format, clippy, tests. |
| `Cargo.lock` | Régénéré après ajout de `serde_json` aux dépendances de `domain` (version verrouillée du workspace) ; `schemars` reste déclaré, consommé à partir de T010/T057. |

### Décisions / honnêteté

1. **Le domaine ne décode pas le fil.** Les orthographes serde exactes sont dans le domaine pour être **testables** ; le décodage amont reste `herdr-client` (T021) et la présence sur le fil (`Field<T>` etc.) reste `contracts` (T010). Modèles internes : `Option` là où la distinction « absent / nul / tableau vide » compte encore (TECH §3), vecteur vide là où elle a cessé de compter.
2. **`CwdMatch` à trois états — le troisième porte la vérité du fil.** D03 : `sessionCwdMatches: boolean|null`. `null` = « non vérifiable », volontairement distinct de `false` — les confondre faisait disparaître des agents de la liste. La comparaison est `===` exacte : **les barres finales ne sont pas normalisées** (testé : `/work/x/` vs `/work/x` = Mismatched). Reproduit tel quel, pas adouci.
3. **Départage des rangs en ordre d'octets.** Le fil actuel départage à `localeCompare` (sensible aux préférences de la machine) ; Rust rend l'ordre déterministe. Sur des identifiants Herdr de forme `wA:pN`, les deux ordres coïncident ; la divergence théorique est consignée dans la doc de `ranks_of_panes`.
4. **`launch_name` corrige A07 (C07) dès cette tâche.** Épuisement des 99 suffixes → `None`, jamais un nom potentiellement pris. La réservation et le repli restent l'affaire de la machine de lancement (T030/T037) ; le nommage, lui, ne rend pas un nom supprimé.
5. **`NormalizedEntry::Message(Box<LignePi>)`.** Clippy a signalé la variante la plus lourde (le `serde_json::Value` du contenu, ~320 octets) ; le message vit en boîte pour que l'énum reste raisonnable à porter en masse. Les tests suivent.
6. **Erreurs de rédaction, vues par la compilation — jamais par confiance.** Trois ont atteint le compilateur : une macro à argument optionnel (`$(avec_ordre)?`) en récursion infinie, remplacée par deux macros simples ; un `/*` transformé en `//*` qui a injecté de la prose française dans `ports.rs` (`prefix 'd' is unknown` — le lexer l'a vue) ; quatre `Copy` impossibles sur des champs non-`Copy` (String, newtypes). Chacune corrigée, chacune recompilée.
7. **Le compilateur a aussi arbitré la forme des tests.** Clippy refuse les `match` à bras unique et les expressions `()` inutiles : cinq tests resserrés en `if let`, et le match d'exhaustivité de `TransportOutcome` séparé en trois bras nommés — l'exhaustivité reste prouvée, sans joker. Le journal lui-même (section T005) a été repris une fois intégralement : la première version, écrite d'un trait, contenait plusieurs phrases corrompues détectées à la relecture. Un livrable ne se commit pas mal aligné.
8. **Aucune E/S dans le domaine, aucun runtime.** Pas de tokio, pas de HTTP, pas de filesystem : `PortFuture` est construite sur `std` seul, et le test de port lit immédiatement via `Waker::noop()`. Les bornes `Send + 'a` de futures dyn-boxées et la compat `dyn` des cinq traits sont vérifiées à la compilation et au premier `poll`.

### Commit

Commit préfixé `T005:` contenant `crates/domain/src/**` (9 modules), `crates/domain/tests/**` (unit_tests + 9 sous-modules), `crates/domain/Cargo.toml`, `Cargo.lock` et cette section. Aucune autre crate modifiée, aucun test sous `src/`, aucune écriture hors dépôt.

---

## T006 — Crate `test-support` : faux ports, horloge contrôlée, magasins jetables, charges classées

Périmètre : `crates/test-support/src + crates/test-support/tests` — faux ControlPort, capture ordonnée des actions/cibles, horloge contrôlée, faux processus de catalogue, magasins JSONL/SQLite jetables, faux push, génération de charges classées par stockage/famille/agent/version. Crate **dev-only** : rien ici ne peut devenir un défaut de production.

### Livrables produits

| Livrable | Détail |
|---|---|
| 5 modules, exactement la liste TECH §2 | `fake_herdr, fake_clock, temp_stores, fixtures, push_sink` + `lib.rs`. Dépendance vers `domain` seul (tokio/rusqlite/serde_json déjà verrouillés par T002). |
| `fake_herdr` — le faux ControlPort | Les 11 opérations, capture ordonnée (opération, cible, détail factuel) notée **avant** de répondre — même en panne. Panne globale injectable telle quelle. Absences honnêtes par défaut : écran absent = `text`/`source` à `None`, snapshot sans réglage = **vide** (observation valable), prompt par défaut = `Confirmed` portant **l'empreinte de la demande** (contrat du simulacre, documenté et testé). Identités simulées `t-sim`/`p-sim`, décelables en capture. |
| `fake_clock` — l'horloge contrôlée | Aucun appel d'horloge système : le temps n'existe que poussé (`avance`, `pose_a` explicite pour le saut arrière). Avance hors bornes **refusée** (panic au motif, jamais de saturation silencieuse). Les clones partagent le même temps. |
| `temp_stores` — magasins jetables | `RacineJetable` : `tmpdir + pid + nonce` par création exclusive, **sous le tmpdir, jamais sous le HOME** ; nettoyage à la dernière main (`Arc`) ; `detruit()` **prouvable** (erreur réelle retournée, idempotent), Drop au mieux documenté. `MagasinJsonl` : écriture **verbatim**, ligne vide comprise. `MagasinSqlite` : vrai fichier SQLite (rusqlite bundled), dossiers parents créés, erreurs rusqlite retournées telles quelles. |
| `fixtures` — charges classées et processus factice | `Graine` (xorshift64, zéro réduit à 1 ; graine par défaut = celle du corpus T001, 20 240 310). `Classement` {stockage, famille, agent, version} → chemin relatif `jsonl|sqlite/{famille}/{agent}/version-{n}`. `snapshot_de_base` : disposition mesurée 190×82 (p1p2/p4p3/p5, focus p1), protocole 22 version 0.9.3, absences volontaires (worktree absent — le repli D02 s'exercera au T039 ; agent p2 sans nom ni session). `charges_snapshot` : panes libres mesurés (p4, p5) d'abord en ordre de lecture, puis rangées p6+ de 14 lignes, nommage `spawn-{n}`, genre alterné, statuts en rotation, une session simulée sur deux. `charges_pi` : les **deux formes mesurées du corpus** (utilisateur à plat, assistant enveloppé avec pensée) + une ligne `opaque-reste` sur cinq — le sort du type inconnu appartient au lecteur T023. `ProcessusFaux` : script `sh` **réel** sous la racine (journal d'arguments par `dirname "$0"`, sortie heredoc telle quelle, code programmé, refus si la sortie contient le délimiteur, `chmod 0o755` via std unix). |
| `push_sink` — le faux push | `NotificationPort` complet : remises capturées **dans l'ordre**, tentatives ratées notées aussi ; règles `Delivree{empreinte}` / `Inconnue{detail}` / `Panne{panne}` ; **sans règle = `Unknown`** — jamais « délivré » au hasard (A02). Clef VAPID réglée ou absente, jamais inventée. |
| 24 tests verts | `tests/unit_tests.rs` + `tests/unit/` (5 sous-modules + helper `pousse` : poll au waker no-op, `std` seul ; `Pending` = échec de test). Zéro `unwrap`/`expect` — les échecs annoncent leur motif. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p test-support --all-targets --locked` | **24 passed / 0 failed / 0 ignored.** |
| `cargo clippy -p test-support --all-targets -- -D warnings` | OK après corrections : `is_multiple_of` (×2), `Result` jeté de `pousse` traité, `matches!` pour la garde du tab. |
| `cargo fmt -p test-support` puis `--check` | OK. |
| `cargo run --locked -p xtask -- verify` | **Cinq portes vertes** : layout (361 fichiers, 0 autorisés, 0 ouverts), graph (ordre topologique conforme, `test-support` avant `xtask`), format, clippy, tests. |
| Portes TS | Non relancées ici : aucun fichier TypeScript touché (le hook de commit les relance de toute façon). |

### Décisions / honnêteté

1. **Périmètre du faux mesuré sur la tâche.** T006 demande le faux ControlPort et le faux push — pas de faux `SessionPort` ni `CatalogPort` : les sessions de test passent par des magasins **réels** (JSONL/SQLite), le catalogue par un processus factice **réel** (script `sh`) — mécanique, jamais une simulation de décodage.
2. **La capture note avant de répondre, même en panne.** Un échec non noté serait un état masqué ; les 5 opérations sous panne globale laissent 5 lignes au journal (testé).
3. **Les défauts du simulacre sont des contrats écrits.** `prompt` sans règle → `Confirmed` avec l'empreinte de la demande ; `stop` sans règle → `InterruptSent` : documentés dans le code et testés. Aucun test contre le réel ne s'appuiera dessus — l'adaptateur réel arrive à T021+.
4. **Le nettoyage Drop est au mieux, la preuve est ailleurs.** Drop ne peut pas remonter d'erreur : la preuve de nettoyage passe par `detruit()`, qui retourne l'erreur réelle — testée, y compris l'idempotence et l'attente de la dernière main.
5. **`MagasinSqlite` crée les dossiers parents.** Premier run : « unable to open database file » — cause réelle (dossiers manquants), corrigée, pas contournée.
6. **La règle du puits persiste jusqu'à changement.** Premier jet du test d'enchaînement empilait trois règles : les trois appels voyaient la dernière (règle persistante, mesuré, pas supposé). Réécrit en règle → appel → assertion.
7. **Remplissage en ordre de lecture.** Premier run : `pop()` lisait depuis la fin et remplissait p5 avant p4 — choix arbitraire remplacé par un `VecDeque` (`pop_front`) : p4 puis p5, puis les rangées p6+.
8. **Mêmes incidents de rédaction que T005, attrapés en relecture** (`vappute`, `BrokenCrumb`, `fausé`, une déclaration de fonction incidentée, un nom de test tronqué) — chaque fichier a été relu en entier avant validation, et la compilation/clippy/tests ont arbitré le reste. Le balayage final de double-mots et de symboles connus est reparti vide.

### Commit

Commit préfixé `T006:` contenant `crates/test-support/src/**` (5 modules + `lib.rs`), `crates/test-support/tests/**` et cette section. `Cargo.lock` inchangé (dépendances déjà verrouillées par T002). Aucune autre crate touchée, aucun test sous `src/`, aucune écriture hors dépôt (racines temporaires du système uniquement, nettoyées).