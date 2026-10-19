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

---

## T007 — Crate `contracts` : DTO publics, présence exacte, renames, corpus C01

Périmètre : `crates/contracts/src + crates/contracts/tests` — tous les DTO publics de `api.ts` (corps inline, SSE, push, résultats non JSON), `Field`/`Nullable` et les renames exacts. L'autorité du fil actif reste `api.ts` jusqu'à T057 ; les DTO Rust sont développés contre le corpus gelé (296 échantillons), acceptés/refusés **identiquement**.

### Livrables produits

| Livrable | Détail |
|---|---|
| `presence.rs` — les quatre présences | `Nullable<T>` (présent, peut valoir null — champ **obligatoire** nullable) et `Field<T>` = `Option<T>` + décodeurs : `refuse_null` (omissible : absent ou valeur, **null refusé**), `optionnel_nullable` (omissible et nullable : absent, null, ou valeur — les trois états distincts). |
| `events.rs` — six charges SSE nommées | `EvenementSse`, enveloppe taguée `{"event", "data"}` mesurée sur la boucle de flux (nom `agent_status` à soulignement, les autres à traits) : `Ready{cursor}`, `Resync{reason, resumeFrom}`, `PromptDelivered{paneId, confirmation, fingerprint, status:"sent"}`, `PromptSuppressed{paneId, reason}`, `AgentLaunched{kind, paneId, workspaceId}`, `AgentStatusChanged{from:null\|état, kind:"status"\|"appeared"\|"disappeared", paneId, to}` — formes mesurées sur les producteurs, plus de `data: unknown`. |
| `http/` — 12 modules par famille | `health` (HealthResponse + HerdrHealth), `overview` (AgentView, WorkspaceView, OverviewResponse — tous champs présents, vagues via `Nullable`), `sessions` (SessionEntry avec `raw` entier + SessionResponse, curseurs opaques), `commands` (PromptRequest, PromptSent/Suppressed/Failed, StopAgent, AgentFocused), `launch` (request/response, LaunchPhase union fermée, LaunchFailed), `catalog` (InstalledKind(s), AgentModel, ModelCatalogResponse — `error` nullable **obligatoire**), `files` (RecentImage(s) + FileBody non JSON), `interactive` (TrustRequest, AnswerRequest, TrustRequired/Resolved, QuestionAnswered, Choice/Question — noms du fil conservés : `numero`, `libelle`, `selectionne`, `detail`), `conversations` (ConversationSummary, ConversationsResponse), `errors` (ApiErrorResponse), `diagnostics` (ClientLogRequest/Response), `push` (SubscribeRequest avec `expirationTime` omissible-nullable, UnsubscribeRequest, union `PushBody` à **précédence désabonnement**, `endpoint_en_https` — règle du 400, VapidKeyText en texte brut, AcquittementVide pour les 204 sans corps). |
| `limits.rs` | Les sept limites partagées de `limits.ts` (MAX_SSE_STREAMS 8, MAX_SESSION_READS 4, timeout/cache catalogue, fenêtre de dedup, tap target, contraste) — une source unique. |
| Réexports C01 | `AgentStatus`, `SessionState`, `ReadSource`, `ReadCause`, `PushPayload`, `SessionRefKind` — les unions fermées restent définies **dans le domaine**, jamais recopiées. |
| 7 tests verts, dont le coureur de corpus | Le coureur charge `compatibility/contracts/corpus.json`, décode chaque échantillon dans **le type mappé à sa cible** (41 cibles), exige accept/refus identique au schéma TS, et vérifie la **fidélité** du rendu (tout champ rendu existait dans le fil avec la même valeur — les champs non déclarés sont retirés, mesuré : le corpus pose un champ `notDeclared` « stripped on decode »). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p contracts --all-targets --locked` | **7 passed / 0 failed** — dont les 296 échantillons du corpus (accept/refus + fidélité du rendu). |
| `cargo clippy -p contracts --all-targets -- -D warnings` | OK après corrections : doc-lazy-continuation (ligne commençant par « + » lue comme sous-liste), single-match → `is_ok()`. |
| `cargo fmt -p contracts` puis `--check` | OK. |
| `cargo run --locked -p xtask -- verify` | **Cinq portes vertes** : layout (381 fichiers, 0 autorisés, 0 ouverts), graph, format, clippy, tests. |
| Portes TS | Non relancées ici : aucun fichier TypeScript touché (le hook de commit les relance). |

### Décisions / honnêteté

1. **Les quatre présences, pas deux.** `Option<T>` de serde confond absent et null ; le schéma TS ne le fait pas. D'où `Nullable` (présent-nullable, **refuse le champ absent**) et `Field` (omissible, **refuse le null explicite**), composables — chaque cas testé sur les deux fils (décode/sérialise).
2. **Le piège serde `missing_field`, vu en test.** Un type décodé via `deserialize_option` réussit même **absent** (le `missing_field` de serde délègue à `deserialize_option`) : `Nullable` passe donc par `serde_json::Value` (`deserialize_any`) — un champ absent reste une erreur, un null mesuré devient `Nulle`. Premier run : `{}` décodait en silence ; corrigé, testé.
3. **La fidélité n'est pas l'égalité d'octets.** Premier run : un échantillon positif portait `notDeclared: "stripped on decode"` — le schéma TS **retire** les champs non déclarés. Le contrôle devient `fidele()` récursif : tout champ rendu existait dans le fil avec la même valeur ; l'égalité stricte aurait été une règle que le corpus contredit.
4. **Les échantillons SSE sont des enveloppes.** Le corpus teste `{"event", "data"}` — le contrat est donc l'enveloppe taguée entière (`EvenementSse`), utile telle quelle au T008 et au routeur SSE.
5. **Exclusions nommées et assertées (21 cibles).** La famille fil Herdr (AgentInfo, WorkspaceInfo, PaneInfo, HerdrReply, PaneReadPayload, PongPayload, AgentSessionInfo, AgentListPayload + vocabulaires Method/EventWait) et la famille snapshot passthrough (TabInfo, PaneLayout*, SnapshotPane, SnapshotPayload) appartiennent à `herdr_client::wire` (TECH §5 : les DTO HTTP ne servent pas de décodeurs amont — T021) ; `SessionCursor` au codec privé de `sessions` ; `PushStore.legacy*` à la persistance privée de `notifications` (T030). Le test ferme les deux bouts : toute cible nouvelle doit être mappée ou exclue nommément, et aucune exclusion ne doit devenir obsolète.
6. **Résultats non JSON typés, pas des DTO fictifs.** VAPID en `text/plain` (`VapidKeyText`), corps de fichier (`FileBody`, conversion exhaustive depuis `ArtifactBody`), 204 sans corps (`AcquittementVide`, variant du registre T008).
7. **La règle https est un contrat testé.** L'échantillon construit `SubscribeHttpPrefixRule` (endpoint en `http://`, accepté au schéma) est porté par `push::endpoint_en_https` — c'est la route qui refuse avec 400 ; les deux faits sont testés séparément.
8. **`registry.rs` et `schema.rs` volontairement absents** — T008 (registre des 18 routes) et T009 (exports de schémas) les livrent ; le journal de T003 n'exige pas les fichiers non livrés.

### Commit

Commit préfixé `T007:` contenant `crates/contracts/src/**` (lib + presence + limits + events + http/12 modules), `crates/contracts/tests/**` et cette section. `Cargo.lock` inchangé. Aucune autre crate touchée, aucun test sous `src/`, aucune écriture hors dépôt.

---

## T008 — `contracts::registry` : le manifeste typé des 18 routes

Périmètre : `crates/contracts/src/registry.rs + tests` — méthodes, gabarits, entrées (corps/query/chemin/entête), variantes de statuts avec leur Content-Type, politique mutante, gardes POST partagées, recherche nommée. Les DTO amont restent séparés (famille `herdr_client::wire`, T021) — le registre ne décode rien.

### Livrables produits

| Livrable | Détail |
|---|---|
| `RouteId` (18 variants) + `Methode` (Get/Post) + `Politique` (Lecture/Mutation) | Unions fermées serde — l'ordre du manifeste suit H01…H18, testé position par position. |
| `Route` + `Entree` + `Corps` + `ParametreRequete` + `Forme` + `Variante` | Le gabarit exact du fil (`/api/agents/{paneId}/prompt`…), la politique mutante mesurée, les paramètres de chemin/query/entête (H04 : trois query optionnelles ; H17 : `path` **requise** ; H14 : entête `Last-Event-ID`), les corps **nommés** (`PromptRequest`, `LaunchAgentRequest`, `AnswerRequest`, `TrustRequest`, `ClientLogRequest`, `PushBody`) avec la limite propre du prompt (32 KiB), les corps **ignorés après garde** (H06/H11, mesuré), et les variantes de réponse : JSON nommé, **texte brut** (H15, 200 et 503), **corps de fichier** (H17), **204 vide** (H16), **flux SSE** (H14). |
| Les variantes explicites, transcription de CURRENT.md §2 | Route par route, y compris les deux 200 du prompt (envoyé ou supprimé), le 409 `TrustRequiredResponse` du lancement, le 400 `{ok:false}` du journal (**même** schéma `ClientLogResponse`, pas une ApiError), et H09 **sans aucune branche non-200** documentée (le non-soutenu/indisponible est une valeur du 200). |
| `GARDES_POST` | Les quatre gardes partagées des POST (403/415/413/405, toutes en `ApiErrorResponse` — le corps du 405 aussi, mesuré) + `variantes_totales()` qui compose. |
| Recherche nommée | `entree_de(id)` (totale, manifeste complet testé), `cherche(methode, gabarit)` — `None` nommé pour un chemin inconnu, une méthode absente d'une route existante (le 405 du routeur s'en sert), ou un gabarit voisin mal nommé. |
| `limits.rs` complété | `MAX_BODY_BYTES` (64 KiB, garde partagée 413) et `MAX_PROMPT_BYTES` (32 KiB, H05) — mesurés CURRENT.md §2. |
| 10 tests de registre (17 au total sur la crate) | Manifeste complet et sans doublon, chemins/méthodes verbatim, politique mesurée, variantes documentées une à une, formes non JSON nommées, corps nommés réels, gardes composées, **deux négatifs** : route absente (chemin/méthode/gabarit) et réponse absente (H09 sans non-200, H11 sans explicite au-delà du 200, vocabulaire de statuts fermé). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p contracts --all-targets --locked` | **17 passed / 0 failed** (10 registre + 7 corpus/présence). |
| `cargo clippy -p contracts --all-targets -- -D warnings` | OK après corrections : `Deserialize` retiré des dérivations du registre (impossible sur des champs `&'static str`, et inutile — le manifeste se lit, il ne se décode pas), import mort retiré. |
| `cargo fmt -p contracts` puis `--check` | OK. |
| `cargo run --locked -p xtask -- verify` | **Cinq portes vertes** : layout (383 fichiers, 0 autorisés, 0 ouverts), graph, format, clippy, tests. |
| Portes TS | Non relancées : aucun fichier TypeScript touché (le hook de commit les relance). |

### Décisions / honnêteté

1. **Le registre ne décode pas — il nomme.** Chaque corps pointe vers un contrat de `http/` ; le test vérifie que les six noms restent dans la liste des contrats réels. La preuve que le type décode VRAIMENT le corps appartient au coureur de corpus (T007) et aux handlers (T050+).
2. **Le 403 des lectures n'est pas la garde POST.** Premier run du test : H04 (chemin de session rejeté) et H17 (fichier refusé) portent un 403 **explicite documenté** — l'invariant négatif ne porte que sur 415/413/405. L'échec a enseigné la distinction, elle est maintenant dans le test.
3. **Le 405 n'existe pas comme variante propre** : c'est le fait « pas de route pour cette méthode » du manifeste (`cherche` → `None`) qui le fonde — testé négativement.
4. **Le défaut documenté de H12 est consigné, pas modélisé.** CURRENT.md note que la construction actuelle omet `state` (500 de validation au fil) : le manifeste porte le contrat **intended** (`200 TrustResolvedResponse`) ; la correction du défaut appartient à la tâche qui branche H12 (T051).
5. **Les réponses nommées par route (enums de conversion HTTP, TECH §5) ne sont pas encore posées** : elles deviennent utiles quand les handlers convertissent les résultats du domaine (T050–T053) — les poser maintenant ferait des enums sans consommateur. Décision consignée ici, à reprendre par ces tâches.
6. **`schema.rs` reste hors T008** (exports de schémas, T009).

### Commit

Commit préfixé `T008:` contenant `crates/contracts/src/registry.rs`, `crates/contracts/src/limits.rs` (deux constantes mesurées), `crates/contracts/tests/unit/registry.rs`, les mises à jour de `lib.rs`/`mod.rs` et cette section. `Cargo.lock` inchangé. Aucune autre crate touchée, aucun test sous `src/`, aucune écriture hors dépôt.

---

## T009 — `xtask contracts export/check` : schémas, OpenAPI 3.1, types TS, validateurs Ajv, corpus JS

Périmètre : `xtask`, `contracts::schema`, `packages/shared/generated`, `scripts/` — JSON Schema 2020-12, OpenAPI 3.1, types TS et validateurs Ajv **standalone** ; deux exports identiques octet pour octet ; une modification de DTO fait échouer `check` ; le corpus est accepté/refusé **identiquement par serde et par JS** ; générateurs figés dans les lockfiles. Les imports frontend actuels ne bougent pas (jusqu'à T057).

### Livrables produits

| Livrable | Détail |
|---|---|
| `contracts::schema` | `definitions()` (60 types, sous-schémas **inline** — pas de `$defs` numérotés, chaque document autonome), `bundle()` (bundle 2020-12 avec complétude assertée : toute cible et tout nom de route/route-corps doit y figurer), `cibles()` (la table corpus → définition, même découpage que le coureur T007), `openapi()` (synthèse **depuis le registre** : chemins, méthodes, paramètres, requestBody avec limites, réponses par variante avec Content-Type, `components/schemas` avec `$ref` réécrits). |
| `Field` devient un vrai type | Newtype sur `Option<T>` : schéma JSON = **celui de `T` sans null** (l'absence s'écrit par clé omise), décodeur/sérialiseur manuels (null explicite refusé). Refactor porté par T009 parce que C01 l'exigeait : un alias d'`Option` exportait un schéma null-tolérant que serde refuse. |
| `Nullable` exporte sa vraie forme | `#[serde(untagged)]` ajouté **pour schemars** (les impls serde sont manuels) : le schéma devient `anyOf [T, null]` au lieu de la forme étiquetée par défaut — le point qui faisait rejeter JS là où serde acceptait. |
| `xtask contracts export` | Écrit les trois documents Rust (bundle, OpenAPI, cibles) puis lance les scripts bun : `contracts-types.ts` (json-schema-to-typescript, une interface par définition → `contracts.d.ts`) et `contracts-validators.ts` (Ajv 2020-12 **standalone**, un validateur exporté par nom → `valider.mjs`). |
| `xtask contracts check` | **Deux** exports temporaires comparés octet par octet (déterminisme), dépôt comparé à une passe fraîche (échec nommé si périmé — prouvé en modifiant `openapi.json` : échec, puis retour vert après export), ensemble de fichiers **fermé** (5 documents exactement), puis corpus validé côté JS : **214 échantillons identiques à serde + 82 exclusions rencontrées = 296**. |
| Générateurs figés | `ajv` 8.20.0 et `json-schema-to-typescript` 16.0.0 en devDependencies **exactes** (bun.lock figé). |
| Exclusion des artefacts | `.oxlintrc.json` (`ignorePatterns` + `packages/shared/generated`) et `.prettierignore` créé : les fichiers **générés** ne sont ni lintés ni reformatés — l'export doit rester octet-identique, un reformatage du dépôt le casserait. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo xtask contracts export` | 5 documents générés (60 définitions). |
| `cargo xtask contracts check` | **exit 0** : deux passes identiques, dépôt identique, corpus JS « 214 acceptés/refusés comme serde, 82 exclusions — identique (C01) ». |
| `cargo xtask contracts check` sur export modifié | **exit 1** : « openapi.json diffère entre export frais et dépôt » — le négatif est prouvé. |
| `cargo test -p contracts` / `-p domain` | 17 / 64 passed — le corpus T007 reste vert après le refactor `Field`. |
| `cargo run --locked -p xtask -- verify` | Cinq portes vertes (394 fichiers). |
| `bun run verify` | format/lint/typecheck/test verts (153 fichiers TS, 1080 cas — inchangé). |

### Décisions / honnêteté

1. **C01 a forcé le refactor `Field`.** Le coureur de corpus JS a rejeté des échantillons que serde acceptait : le schéma d'un champ omissible incluait null (sématique d'`Option`) là où le décodeur Rust le refuse. La règle tenait depuis T007 — l'export l'a rendue **incontournable** : `Field` est un newtype dont le schéma est celui de `T`. Le piège serde `missing_field` est documenté dans le code (un décodage via `deserialize_option` réussit même absent).
2. **Le schéma de `Nullable` mentait aussi** : le derive schemars suit la représentation serde **par défaut** (étiquetée), pas mes impls manuels (valeur ou null). `#[serde(untagged)]` — inerte pour les impls manuels — aligne le schéma sur le réel. Vu par la divergence serde/JS du corpus, pas par relecture.
3. **Ajv standalone ne voit que `addSchema` + `getSchema`** : mesuré par sonde (un `compile()` direct produit un module vide). Chaque définition porte `$id` = son nom (identificateur JS valide) — le module exporte les validateurs par nom exact, consommables par `cibles.json`.
4. **La composition `Option<Nullable<T>>` exporte `anyOf [T, null]` une seule fois** via `#[schemars(with = …)]` — l'`Option` de schemars dupliquait le null (visible en TS : `(string \| null) \| null`, attrapé par le lint TS `no-duplicate-type-constituents`).
5. **Les avertissements `unknown format "uint64"` d'Ajv sont silenciés par `logger: false`** : l'annotation est décorative (la contrainte réelle est `type: integer`) ; la validation ne change pas.
6. **Un dépôt périmé a été vu en vraie condition** : après le refactor, `check` a échoué sur `openapi.json` avant que j'aie pensé à re-exporter — la porte fonctionne dans le sens anti-régression voulu, et le négatif a ensuite été prouvé délibérément.
7. **Les scripts de build (`scripts/contracts-*.ts`) ne sont ni lintés ni typecheckés** par les portes TS (champ `apps packages`) : ce sont des outils de build lancés par xtask, leur échec remonte à `contracts export/check` — consigné.
8. **Le corpus JS ne remplace pas le coureur serde** : les deux vivent (T007 côté Rust, ce script côté JS), et `check` ne passe que si les deux disent la même chose — c'est exactement la preuve C01 demandée.

### Commit

Commit préfixé `T009:` contenant `crates/contracts/src/schema.rs` (+ `Field`/`Nullable` ajustés, attrs DTO), `crates/domain/src/*` (dérivations `JsonSchema`), `xtask/src/contracts.rs` + wiring, `scripts/contracts-*.ts`, `package.json`/`bun.lock` (générateurs figés), `.prettierignore`/`.oxlintrc.json`, `packages/shared/generated/` (5 documents) et cette section. Aucun test sous `src/`, aucune écriture hors dépôt.

---

## T010 — `domain::errors` + `http-api::errors` : treize natures, diagnostic structuré, cartographie par route

Périmètre : `crates/domain/src/errors.rs (+tests)`, `crates/http-api/src/errors.rs (+tests)` — les treize natures de TECH §5, détail sûr + contexte diagnostic, aucun statut HTTP dans le domaine ; la cartographie par endpoint depuis le registre ; les formes atypiques documentées conservées ; les messages sûrs mesurés de Reply.ts.

### Livrables produits

| Livrable | Détail |
|---|---|
| `Nature` (13 variants) + `code()` | `InvalidInput, NoSource, SourceAbsent, SourceInvalid, SourceIo, PathDenied, UpstreamUnavailable, UpstreamRejected, UpstreamMalformed, Deadline, PartialAction, Overloaded, InternalInvariant` — codes stables (`invalid_input`…) pour le journal plat. |
| `ErreurDomaine` + `Diagnostic` | Nature fermée + détail (nettoyé **à l'affichage**, comme le fil) + diagnostic structuré (code, cause réelle, entrées clé/valeur). `Diagnostic::insere` **refuse** toute clé de matériel privé (`prive/privee/private/secret/token/password/passe`) — refus nommé, jamais une réécriture silencieuse ; le refus se propage via `avec_entree`. |
| Messages sûrs (Reply.ts, mesurés) | `supprime_identifiants` : `wX:pY` → « le nouvel onglet », `wX:tY` → « son onglet », `pane_id=…`/`tab_id=…`/`workspace_id=…` retirés — sans dépendance regex (jetons aux frontières de mots, UTF-8 sûr, plafond 300 reculant à la frontière de caractère) ; vide → « erreur sans message ». |
| `cause_de_lecture` | `Invalide → SourceInvalid`, `Io → SourceIo` ; **absente/vide restent des valeurs** (ReadVerdict bénin) — la conversion en erreur masquerait un état normal (C04). |
| `http-api::errors` — la table par route | `statut(route, erreur)` : H04 distingue TOUTES les natures (400/403/404/409/422/502/503/500) ; H02 = 500 (run générique) ; H03 503/502 ; H05 400/502/500 ; H06 404/502 ; H07 400/503/502 ; H08 502 ; H10/H12 400/502 ; H14 503 ; H15 503 texte/500 JSON ; H16 400/503/500 ; H17 403/500 ; H18 502. `corps`/`corps_de_lecture` : `ApiErrorResponse` avec cause **nommée** (invalide≠vide≠absent≠IO) et hint = code diagnostic. |
| Formes atypiques conservées | `reponse_erreur` : H05 502 → `PromptFailedResponse` à trois états (`attente` = Herdr n'a pas tranché, `erreur` = refusé, `inconnu` = malformé/partiel — B05) ; H15 503 → texte brut. `catalogue_en_valeur` (H09 : erreur = valeur du 200, listes vides mesurées), `focus_sans_effet` (H11 : `focused:false`), `journal_sans_effet` (H13 : `{ok:false}`). |
| 7 tests domaine (71 au total) + 7 tests http-api | Codes des 13 natures, refus des clés privées (4 clés + une saine), remplacements mesurés (y compris `http://wA:p7x/fin` — les `/` sont des frontières), plafond 300 + accents, cause bénigne ≠ erreur, matrice **complète** 13 natures × 18 routes (tout statut est documenté ou le repli 500), états B05, formes atypiques. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p domain --all-targets --locked` | **71 passed / 0 failed** (+7 diagnostics). |
| `cargo test -p http-api --all-targets --locked` | **7 passed / 0 failed** (nouveau cahier). |
| `cargo clippy -p domain -p http-api --all-targets -- -D warnings` | OK après corrections : `is_empty` au lieu de comparaison à vide, bloc de test inachevé retiré avant commit (jamais committé). |
| `cargo run --locked -p xtask -- verify` | Cinq portes vertes (399 fichiers). |
| `bun run verify` | Vert (1080 cas TS, inchangé). |

### Décisions / honnêteté

1. **Le nettoyage se fait à l'affichage, pas à la construction** — fidèle au fil (Reply.ts `describe`) : le détail reste brut dans la structure, `message_sur` applique les règles ; les constructeurs ne transforment pas (deux passages seraient indiscernables d'un seul de toute façon — testé par idempotence de fait).
2. **La liste des fragments de secrets est fermée et honnête** : les clés françaises comptent (`mot_de_passe` a été attrapé **par le test**, le fragment `passe` ajouté ensuite) — un faux refus est une erreur visible (acceptable), un secret passé serait une fuite (inacceptable).
3. **Le 409 de H04 = `SourceInvalid`** (curseur d'historique périmé) et le **503 = `SourceAbsent`** (base SQLite manquante) : la répartition vient de la ligne H04 de CURRENT.md ; chaque nature de H04 a son statut testé une à une.
4. **H07 : `NoSource` → 400** (type non installé — « rien ne prouve ce type ») et découverte échouée (`UpstreamUnavailable`/`Deadline`) → 503 : deux échecs voisins, documents distincts. Le 409 `TrustRequired` est une variante de **succès-refusé** portée par le handler (T053), pas par la table d'erreurs.
5. **Le repli 500 est nommé, jamais un succès.** La matrice complète (13×18) est testée : tout statut rendu est dans le manifeste de la route ou vaut 500 — le seul statut que CURRENT.md §2 autorise hors variantes (« uncaught defects »).
6. **Les enums de réponse complètes par route (TECH §5) restent à leur tâche** : `ReponseErreur` couvre les trois formes d'erreur nommées (Api/PromptRate/TexteBrut) ; les enums de succès (200 typés) arrivent avec les handlers qui les construisent (T050–T053) — poser des enums sans consommateur serait du code mort documenté.

### Commit

Commit préfixé `T010:` contenant `crates/domain/src/errors.rs` (natures + diagnostic + messages sûrs), `crates/domain/tests/unit/diagnostics.rs`, `crates/http-api/src/errors.rs` + `lib.rs`, `crates/http-api/tests/**` et cette section. `Cargo.lock` inchangé. Aucun test sous `src/`, aucune écriture hors dépôt.

---

## T011 — `files::confined` + `sessions::path_policy` : l'ouverture confinée (C13)

Périmètre : `crates/files/src/confined.rs (+tests)`, `crates/sessions/src/path_policy.rs (+tests)` — racines canoniques, descripteurs possédés, régularité, liens internes sûrs, RAII ; `sessions` réutilise le moteur de `files`, sans dupliquer de résolution.

### Livrables produits

| Livrable | Détail |
|---|---|
| `RacineAutorisee` | Résolue (realpath) à la construction ; porte **les deux formes** (brute + canonique) — la pré-vérification lexicale compare à l'une ou l'autre : sur macOS `/var` est un lien vers `/private/var`, comparer le chemin brut d'une demande à une racine canonique seule refusait tout légitime (défaut du fil documenté, réintroduit puis attrapé **par le test**). |
| `FichierAutorise` | Le descripteur **possédé** + la taille prise **sur le descripteur** (S04 : les contrôles portent sur l'objet qui sera lu, pas sur un chemin revu depuis) ; RAII ferme sur tous les chemins ; `lis()` borne à la taille mesurée et rend les octets **réellement lus** (troncature concurrente explicite). |
| `ouvre_confine` | Quatre défenses dans l'ordre : lexical (composants, `..`/frère refusés) → résolution réelle + re-contrôle (lien sortant vs hors racine, tranché par le parent résolu) → ouverture **relative** cap-std avec `O_NONBLOCK` (jamais bloqué par un FIFO) → `fstat` sur descripteur (régularité + taille). `est_sous` compare par **composants** (`Path::strip_prefix`) — `/a/b` ne couvre jamais `/a/bc`. |
| `sessions::path_policy` | `resolu_sous(racines, candidat)` → `VerdictChemin::Autorise{resolu}` ou `Refuse{raison}` — quatre refus distincts avec leurs libellés du fil (`sessions root not found`, `missing session`, `session path outside the allowed root`, `symlink escaping the allowed root`) ; plusieurs racines (pi/codex passent ensemble) ; **le refus précis l'emporte sur « racine-absente »** ; fichier pas encore créé = le parent résolu décide (`CheminAbsent` dedans, `HorsRacine` dehors) ; lien sortant vs sortie déclarée distingués. |
| Dépendances | `cap-std` 3.4.6 + `libc` 0.2 ajoutés au workspace (TECH §6 mandate cap-std) ; arêtes graphe conformes (`sessions → files` était déjà attendue). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p files --all-targets --locked` | **12 passed / 0 failed** : légitime, sortie/`..`/frère/absolu, lien interne accepté, lien sortant refusé, **swap de lien** (réouverture après ré-étiquetage → refus), **FIFO sans blocage**, répertoire, périphérique, trop-gros (tailles au message), **5 000 échecs sans fuite de descripteur** (la 5 001re ouverture marche), troncature concurrente explicite, normalisation lexicale, comparaison par composants. |
| `cargo test -p sessions --all-targets --locked` | **7 passed / 0 failed** : légitime résolu, refus distincts, racine absente propre, sortie/frère hors racine, lien sortant vs sortie déclarée, chemin pas-encore-créé (parent décide), plusieurs racines + priorité du refus précis. |
| `cargo run --locked -p xtask -- verify` | Cinq portes vertes (407 fichiers). |
| Portes TS | Vertes (inchangées — hook de commit). |

### Décisions / honnêteté

1. **Le piège macOS a été réintroduit puis attrapé par les tests.** La pré-vérification lexicale comparait le chemin brut à la racine canonique : neuf tests rouges d'un coup (`HorsRacine` sur tout légitime). Corrigé en portant les deux formes de racine — le défaut documenté dans le fil (`/var` → `/private/var`) est maintenant une **règle testée**, pas une anecdote.
2. **La pré-vérification lexicale de `path_policy` a été retirée** : elle recréait le même piège et n'apportait rien que `realpath` ne fasse — le fil actuel résout d'abord, vérifie ensuite ; reproduit tel quel.
3. **Un frère inexistant se manifeste d'abord comme « missing session »** — le premier fait constaté (mesuré : le fil fait pareil) ; pour avoir `HorsRacine`, le frère doit exister. Les tests créent donc ce qu'ils prétendent voir.
4. **Les descripteurs et la course** : l'ouverture relative cap-std + `fstat` sur descripteur ferment la fenêtre mesurée (stat décrivait l'ancien, lecture livrait le nouveau) ; la canonisation seule n'est pas une défense complète — le swap de lien est testé à la réouverture.
5. **Pas de `unsafe`** : le FIFO est créé via le binaire `mkfifo` (l'appel libc direct est `unsafe`, interdit au workspace) ; `O_NONBLOCK` passe par `custom_flags` du trait `cap_std::fs::OpenOptionsExt` (import nécessaire — mesuré à la compilation).
6. **Les dev-dependencies sur `test-support` sont refusées par la porte graphe** (le collecteur compte les dev-deps) : les tests de `files`/`sessions` construisent leurs racines temporaires en `std` direct — quinze lignes, zéro arête nouvelle.
7. **La politique MIME reste à T052** (handlers) : T011 porte le confinement, pas le rendu navigateur.

### Commit

Commit préfixé `T011:` contenant `crates/files/src/confined.rs` + `lib.rs` + `tests/**`, `crates/sessions/src/path_policy.rs` + `lib.rs` + `tests/**`, `Cargo.toml` (workspace deps) + `Cargo.lock` et cette section. Aucun test sous `src/`, aucune écriture hors dépôt.

---

## T012 — `herdr-client::transport` : le transport Unix (T012)

Périmètre : `crates/herdr-client/src/transport.rs (+tests)` — JSONL ligne par ligne, corrélation par identifiant, cadre borné 16 MiB, UTF-8 fragmenté, fermeture, deadline par méthode ; zéro relance mutante automatique.

| Livrable | Détail |
|---|---|
| `TransportUnix` | Un socket Unix, un compteur d'ids monotone ; `appelle(methode, params)` : un cadre demande (id/method/params + saut de ligne), un cadre réponse corrélé — `result` → Ok, `error` → `AmontRefus{code, message}` (structuré, jamais une chaîne opaque), `result`+`error` → enveloppe ambiguë refusée. |
| Bornes et délais | Cadre > 16 MiB refusé **avant** de lire la suite ; deadlines par méthode (`delai_de`) : 15 s défaut (mesuré C07), catalogage 20 s (limite partagée) — posées en `set_read/write_timeout`. |
| UTF-8 fragmenté | Lecture **par octets** jusqu'au saut de ligne : un « é » coupé en deux se reconstitue (le décodage n'arrive qu'à la fin du cadre) — testé avec trois fragments espacés. |
| Erreurs nommées | `Ferme` (EOF), `CadreTropGrand`, `JsonInvalide`, `EnveloppeInvalide` (id absent, ni result ni error, les deux à la fois), `MauvaiseCorrelation{attendu, recu}`, `DelaiDepasse`, `Socket`, `AmontRefus{code, message}` — **aucune relance automatique** : un délai dépassé rend la main, le serveur reçoit UN cadre, l'appelant rejoue **explicitement** (`prochain_identifiant` avance). |
| 8 tests contre un faux socket | Échange corrélé, cadre fragmenté UTF-8, mauvaise corrélation, JSON invalide, enveloppe sans id / vide, refus amont structuré, EOF, délai, surtaille, aucune relance + ids qui avancent. |

Transport **bloquant** (`std::os::unix::net`) : les tests et les politiques l'exigent simplement ; l'adaptateur asynchrone l'enveloppera (T021) sans re-décoder ici.



---

## T013 — `herdr-client::wire/client/capabilities` : les méthodes utilisées, réponses vérifiées (C05)

| Livrable | Détail |
|---|---|
| `wire.rs` | Les formes protocol.ts **privées à l'adaptateur** (InfoAgent, InfoSessionAgent, InfoWorkspace, InfoWorktree, InfoPane, PhotoSession, Pong, ListeAgents, LecturePane, OngletCree) — omissible/nullable **trois états** portés tels quels, jamais aplatis. |
| `client.rs` — les méthodes **mesurées** | Les 12 sites de demande de HerdrClient (`of`) : ping, photo_session, liste_agents, fiche_agent (résultat opaque — le décodage ciblé reste chez l'appelant), lecture_ecran (**`strip_ansi: true` au fil ; `visible` sans `lines`** ; charge partielle = vide, pas une panne), prompt, texte_brut (`pane_id`), touches (`target`), focus, creation_onglet (réponse `{tab, root_pane}` **vérifiée**), lancement, fermeture_onglet. |
| C05 — le discriminant | `demande_objet` exige `result` **objet** (le `Schema.Record` du fil) : `null`, `"ok"`, `[]` ne confirment PAS un prompt — testé pour les trois. |
| `capabilities.rs` | 14 méthodes déclarées, **12 utilisées** (sites mesurés), 2 déclarées non activées (`events.subscribe/wait` — E3 : l'amont ne les implémente pas) ; `est_activee` les expose absentes, jamais en no-op. Le corpus dit « runtime uses 13 » : l'écart (12 sites + `request`) est consigné, mesuré ici site par site. |
| 13 tests (8 transport + 5 client) | Vocabulaire cohérent, orthographes exactes (`pane_id` vs `target`, tab.create cwd/focus/label/workspace_id), lecture visible/recent, C05 ×3 + l'objet qui confirme, onglet sans pane racine refusé nommé. |



---

## T014 — `sessions::storage::jsonl` : framing par octets, identité, pages avant/arrière (C02)

| Livrable | Détail |
|---|---|
| `framing.rs` | La découpe **par octets** : une ligne = octets jusqu'au saut de ligne compris ; une queue sans saut = **en attente** (ni rendue, ni comptée) ; la cible est douce — un premier cadre au-delà est rendu **seul** (le lecteur buterait sinon à jamais) ; l'offset nouveau = la fin du dernier cadre complet. |
| `identity.rs` | `(dev, ino, offset)` = le curseur du fil (`SessionCursor` d'api.ts) ; `continuite` : même identité **et** offset ≤ taille — troncature ou rotation → repartir de zéro **en le disant**. |
| `reader.rs` | `page_avant` (suivre les appends, `a_rattrape`/`reinitialisee` nommés) et `page_arriere` (l'historique : les cadres dont la somme tient dans la cible, curseur = le début de la première rendue — la page précédente y recommence sans saut ni doublon). |
| `history.rs` | L'en-tête (`type: "session"`) et la queue (même moteur, nom du fil). |
| 7 tests (14 sur la crate) | Page vide (après la semence), **coupure UTF-8 réelle** (0xC3 puis 0xA9 en deux appends — rien rendu, puis la ligne entière UNE fois), cinq appends suivis (invariant `offset ≤ taille` à chaque page), troncature + rotation réinitialisées **nommément**, record géant de 5 MiB rendu seul et **faisant avancer**, arrière qui recule sans saut, en-tête/queue. |



---

## T015 — `sessions::storage::sqlite` : le moteur commun, l'ouvrier dédié (T015)

| Livrable | Détail |
|---|---|
| `worker.rs` — `Ouvrier` | Un **fil dédié par base**, connexion `SQLITE_OPEN_READ_ONLY` (ni base, ni WAL, ni schéma ne bougent), `busy_timeout` 3 s (mesuré), file de travaux **bornée à 32** (`try_send` → `FilePleine` nommé, jamais une file infinie) ; `interroge` (dépose + attente) et `depose` (sans attente — l'API pour l'adaptateur asynchrone) ; `poignee_interruption` = `InterruptHandle` partageable — une requête en cours se coupe, l'ouvrier **survit**. SQL verbatim, paramètres **liés** (jamais interpolés) ; lignes rendues avec noms de colonnes + valeurs (blob = octets, pas une chaîne déguisée). |
| `paging.rs` | Les formes communes : avant `ASC LIMIT ?`, avant-après `> ?1 ASC`, arrière **`< ?1` DESC** (mesuré) + `borne_de` (la valeur d'ordre du dernier — le curseur de la page suivante). |
| 5 tests (18 sur la crate) | **Deux schémas factices différents** (row_id/chat_message vs seq/texte) par le MÊME moteur ; pages avant par bornes (2+2, bornes 2 puis 4) ; **mutation de borne relue** (UPDATE par connexion séparée, la relecture voit `deux-muté`) ; file bornée (33 dépôts acceptés = 1 en cours + 32 en file, le refus nommé, l'ouvrier survit à l'interruption puis au drain) ; paramètres liés (apostrophe/valeur exacte). |



---

## T016 — `sessions::families` : primitives openai, codecs Chat/Responses/Anthropic/Pi (T016)

| Livrable | Détail |
|---|---|
| `openai/arguments.rs` | `Arguments` à trois états : `Objet` (JSON décodé), `Brut` (**un JSON d'arguments invalide est conservé brut** — preuve demandée, portée), `Absents` ; `function_call` = JSON dans une chaîne, `custom_tool_call` = script dans `input`. |
| `openai/text.rs` | `texte_de_sortie` (une LISTE de blocs pour function_call_output, une chaîne ailleurs — les deux dans le même fichier, mesuré), `texte_de` (non-vide ou rien), `modele_utilisable` (**entre chevrons = substitut** — `<synthetic>` n'annonce jamais un modèle), `bloc_texte`. |
| `openai/responses.rs` | Le port fidèle de `codex.ts` : `event_msg.item_completed` (UserMessage/AgentMessage+phase/CommandExecution dernière commande+exit_code+cancelled/FileChange → edits de diff unifié), `response_item` (function_call/custom_tool_call → toolCall, *_output → toolResult, reasoning → **masquée, jamais inventée**, message → rôles user/assistant seulement — `developer` écarté), le contexte injecté (**les DEUX marques AGENTS.md ensemble** : un utilisateur qui en parle survit), réglages `turn_context`/`thread_settings_applied` → `ChangePi` (pas de fournisseur deviné). |
| `openai/chat.rs` | Le codec Chat **séparé** : une enveloppe response_item/event_msg/turn_context ne se décode PAS ici — jamais (preuve demandée, portée). |
| `anthropic/messages.rs` | Le port de `claude.ts` : **tri sur le TYPE, jamais sur le rôle** (le piège `api-request-blob`) ; les 6 marques sans demande (15 % des lignes user mesurées) ; tool_result → toolResult **à part** (+isError) ; tool_use → toolCall (input déjà objet) ; modèle sur message ; commande slash XML rendue utile (nom + arguments) ; `est_ligne_de_conversation` + `sans_message` (une ligne refusée ne se relit plus comme un message). |
| `codecs/pi.rs` | L'identité vérifiée : `type` + `message` objet requis — la forme cible se lit par validation, pas par traduction (le format PLAT du corpus se décode au profil T018). |
| 8 tests codecs (26 sur la crate) | Fixtures positives/négatives **indépendantes des agents** : chaque piège mesuré a son cas (developer, AGENTS.md parlé vs injecté, reasoning chiffrée, commande dernière, diff → edits, modèle substitut, chat/Responses séparés, api-request-blob, slash command, sans_message). |



---

## T017 — `sessions::pipeline` + registre : la chaîne sans branche sur un agent (T017)

| Livrable | Détail |
|---|---|
| `Capacites` | Quatre capacités **indépendantes** (lisible / catalogue / lancement / interactions) — posées **mesurées** par chaque profil, jamais déduites d'un voisin. |
| `Codec` + `Profil` | Le codec = deux pointeurs de fonction (ligne → pi, éventuellement réglage → pi) — un profil est une **donnée** (genre, capacités, codec) : le socle ne fait jamais `match genre {"pi" => …}` (preuve T017 : l'indépendance est structurelle). |
| `Registre` | Un genre = un profil (`BTreeMap`) ; `pose` ne touche que son genre ; `profil(inconnu)` = **`None`, jamais un repli** ; `traite` fait passer la ligne par le pipeline (codec → politique fine à T018+ → normalisation) et sort `Message`/`Reglage` par leurs étapes propres. |
| 5 tests (31 sur la crate) | Deux familles inventées passent par le même socle ; **l'inconnu avec une ligne de même forme ne bascule pas** ; **modifier Devin (codec + capacités) laisse Codex bit-pour-bit inchangé** ; quatre capacités indépendantes ; réglage vs message par leurs étapes. |



---

## T018 — `sessions::agents::pi` : le profil Pi (D11)

| Livrable | Détail |
|---|---|
| Les deux formes du corpus | **À plat** (`{type:"message", content, role…}` — mesuré sur pi/pane-01.jsonl) : enveloppée à la lecture, pour que rien en aval ne connaisse les deux formes ; **enveloppée** (la forme normalisée) : passe par identité vérifiée (codec pi T016). |
| Huit rôles + types non-message | `ROLES` (8, mesuré `MessageRole`) porté fermé ; les types hors message (`usage, compaction, custom_message, label, session_info, context_edit`…) → **`None`** — l'appelant garde la brute, rien n'est fabriqué. |
| Filiation D11 | `parentSession` (l'en-tête) = le **seul** lien inter-sessions ; un `parentId` de ligne reste un champ de ligne **intra-session** — le profil ne réinvente JAMAIS une filiation depuis parentId, et ne suggère aucun sous-agent (mesuré deux fois : aucune source de sous-agents n'existe). |
| Profil posé sur le socle | `ProfilPi::profil()` passe par le pipeline T017 (le corpus passe avec lui) ; capacités mesurées (les quatre, surface TS) ; l'inconnu ne bascule pas sur pi (revérifié ici). |
| Aucune écriture source | Testé : la source est intacte octet pour octet après lecture. |
| 7 tests (38 sur la crate) | Corpus préservé (id/timestamp/rôle/contenu), forme enveloppée (+modèle), types non-message en brut, huit rôles, filiation D11, pose sur le registre + pas de repli, source intacte. |



---

## T019 — `sessions::agents::codex` : le profil Codex (D12–D13)

| Livrable | Détail |
|---|---|
| Le profil | Le codec Responses (T016, ligne + réglages) **posé sur le pipeline** ; genre `codex`, capacités mesurées (les quatre — la surface TS traite question/`Type your own answer` et confiance). |
| D12–D13, prouvées sur le corpus FROZEN | `fixtures/codex/pane-01.jsonl` passe en entier : les contextes injectés (AGENTS.md + `<environment_context>`) sont **filtrés** (comptés, jamais servis), les VRAIS prompts (longs) **restent**, les horodatages passent, la réflexion chiffrée ne sort JAMAIS de texte inventé. |
| Le socle inchangé | Pi posé à côté de codex : les deux profils coexistent par le pipeline générique — l'ajout de codex ne change rien au socle (testé). |
| 2 tests (40 sur la crate) | Corpus complet sans perte + coexistence pi/codex. |



---

## T020 — `sessions::agents::claude` : le profil Claude (D14)

| Livrable | Détail |
|---|---|
| Le profil | Le codec Anthropic (T016) posé sur le pipeline ; genre `claude`, capacités mesurées (les quatre). |
| **La politique D14 — le piège propre à claude** | `ligne_traitee` : une ligne de conversation **refusée** est conservée **sans son message** (le reste survit — timestamp/type) ; le fallback raw ne réinjecte jamais ce qu'on vient d'écarter — sinon `[Request interrupted by user]` revenait comme « dernière demande » **alors que le filtre marchait** (mesuré). Les lignes hors conversation passent telles quelles. |
| Le corpus frozen | `fixtures/claude/pane-01.jsonl` passe : demandes + appels d'outils préservés. |
| Slash commands + erreurs d'outil | La commande XML rendue **utile** (`/rapport --bref`), l'échec d'outil porte `isError` — testés. |
| 4 tests (44 sur la crate) | Corpus sans perte, D14 jamais de retour du filtré, slash + isError, coexistence des trois profils (claude/codex/pi) sans repli. |



---

## T021 — `sessions::agents::opencode` : la base SQLite, le curseur par `seq` (D15/D17)

| Livrable | Détail |
|---|---|
| `families/codecs/opencode.rs` | Le port de `opencode.ts` : les parties `text/reasoning/tool/file` (réflexion **en clair, `redacted:false`** — contrairement à codex), l'appel **puis** le résultat dans le même message (le regroupement rattache), `state.error` = le SEUL marqueur d'échec, images `data:` base64 gardées (le reste refusé, pas interprété), `state.input` non-objet conservé **sous une clé** (la commande d'un appel ne se perd pas), `horodatage_iso` (algorithme civil sans dépendance ; 0/au-delà = rien), `variant` = le niveau de raisonnement **mesuré** mais **`default` refusé** (D17 : le nom d'« aucun niveau choisi », 52 occurrences mesurées). |
| `agents/opencode/moteur.rs` | Les requêtes **mesurées** sur l'ouvrier T015 : `session_existe` (erreur ≠ vide — diagnostic), `lire_derniere` (limite+1 descendante, la plus ancienne jetée — pas de second count), `lire_depuis` (**`seq >= ?` inclus — D15 : 97 % des lignes réécrites ; une ligne relue assumée, le client remplace par identifiant**), `lire_avant` (`< ?` DESC, remise en ordre UNE fois), `page_session` (pure, testable sans serveur), `ProfilOpencode` posé sur le socle. |
| Les types au fil | Une entrée TRADUITE porte `type: "message"` ; une ligne **non traduite** (`idle/system/synthetic/compaction` — refus délibérés et mesurés) garde son type **et fait avancer le curseur** (sinon relecture infinie). |
| 5 tests (50 sur la crate) | Requêtes sur base factice (session existe/inconnu), **D15** : réécriture relue via `>=`, id stable `opencode:m2`, `<` strict sans doublon ; **D17** : variant default ≠ thinkingLevel, image data-URI + isError, réflexion en clair ; non-traduits lus et avançant ; le profil sur le socle + pas de repli ; ISO aux bornes. |



---

## T022 — `sessions::agents::devin` : row_id comme curseur, `system` écarté, garde-fou tool_calls (T022/D16)

| Livrable | Détail |
|---|---|
| `families/codecs/devin.rs` | Le port de `devin.ts` : `system` écarté (majoritaire : 129/163 mesuré — le piège `developer`, une fois de plus) ; la réflexion **en clair** (`redacted:false`) ; `metadata.created_at` **déjà ISO** (rien à convertir) ; le modèle = `metadata.generation_model` (mesuré : `swe-1-6-slow`) ; les appels d'outils selon la forme **OpenAI-compatible — réserve écrite** : la forme n'a PAS été mesurée (8 messages, `tool_calls` tous vides) → **le garde-fou est strict** : sans `function.name`, RIEN n'est retenu (le fil perd la ligne, n'affiche jamais d'inventé) ; les arguments JSON décodés ou bruts. |
| `agents/devin/moteur.rs` | Les requêtes mesurées sur l'ouvrier — ⚠️ **le curseur = `row_id` (AUTOINCREMENT, unique à la table), jamais `node_id`** (un rang de forêt : deux sessions ont chacune le leur) ; `session_existe` (erreur ≠ vide), `lire_derniere`/`lire_depuis` (borne incluse — même correctif streaming)/`lire_avant` (`<` DESC) ; les non-traduits gardent leur type **et font avancer le curseur**. |
| Capacités mesurées | Lisible/catalogue/lancement **oui** ; interactions **NON établies** (aucune session réelle n'en montre) — la capacité reste fausse tant qu'aucune preuve (règle du dépôt : aucune capacité supposée). |
| 6 tests (56 sur la crate) | Les requêtes + le `system` écarté mais LU, **row_id ≠ node_id** (deux sessions, node_id 1 chacune — la bonne conversation relue, ids `devin:4`), réflexion en clair + modèle + ISO, le garde-fou (sans name → rien ; avec name → retenu ; sans blocs → pas de bulle vide), le profil sur le socle (pas de repli), la borne mutée relue. |



---

## T023 — `sessions::resolver` : le SEUL point de décision (C15, régression d19f98d)

| Livrable | Détail |
|---|---|
| **state_10 bat state_9** | Les bases d'index codex (`state_*.sqlite` dans CODEX_HOME) se trient par version **NUMÉRIQUE** décroissante — le tri lexicographique du fil plaçait `state_9` devant `state_10` (la régression d19f98d, corrigée et testée avec state_2/9/10). |
| Les DEUX lectures du titre | `noms_de_session_codex` : le titre porte `<nom> \| <dossier>` + un **glyphe d'état quand codex travaille** — on rend la lecture **brute ET** la lecture sans décoration, et c'est l'INDEX qui tranche : un vrai titre à glyphe reste trouvable, un faux nettoyage ne produit pas de session (le dossier doit concorder, le ` \| ` doit exister). |
| L'index qui tranche | `chemin_codex_par_nom` : nom + cwd + `archived = 0` + le rollout DOIT exister — sans les trois, `None`, jamais la session d'un autre (Herdr a cessé de publier agent_session pour codex : l'index est une preuve, pas une déduction). |
| Le cache positif/négatif invalidable | La validité = (mtime, taille) de la base : une session ajoutée change la base → le cache négatif s'invalide et la session devient **visible** (testé : négatif puis ajout puis trouvé). |
| La source unique (C15/D013) | `source_session` / `source_session_de` / `localise_session` : le seul point de décision — path fait foi, id résout par kind (codex/claude par NOM de fichier ancré `rollout-*-id.jsonl`, opencode/devin en base SQLite avec identifiant vide REFUSÉ), le repli par titre est **codex-SEUL** ; une base n'est pas un chemin (localise rend None pour opencode). |
| Racines injectées | Aucune lecture d'environnement (TECH §6) : les cinq racines viennent de la config — les tests n'écrivent jamais dans les vrais dossiers. |
| 7 tests (63 sur la crate) | Tri numérique, deux lectures du titre (mesuré « Audit PWA and webapp \| herdr-pwa », glyphe ⠼), index + les trois garde-fous, cache négatif invalidable, source unique (base ≠ chemin, identifiant vide refusé, repli codex-seul), identifiants ancrés, racines injectées. |



---

## T024 — `sessions::cursor` : les curseurs opaques versionnés (C12)

| Livrable | Détail |
|---|---|
| La forme **v2** (`hc2:…`) | Base64 du payload JSON versionné : empreinte de source + session + génération + position — liée, opaque, le seul encodage ÉMIS. |
| Le legacy fichier (compatibilité) | Le base64 de `{dev, ino, offset}` du fil se DÉCODE (l'ordre des champs n'importe pas) — jamais ré-émis ; le **reset legacy SQLite** (`{dev:0,ino:0,offset:seq}`, mesuré `curseurSqlite`) se recolle à la source de la requête qui le porte (le legacy n'a pas d'identité propre). |
| C12 — le curseur d'A ne lit jamais B | `lie_a(empreinte, session)` : le v2 VALIDE l'appariement — une source ou une session étrangère = `SessionEtrangere` (400) ; le legacy se recolle (reset). La génération est une opinion de fraîcheur, la position passe telle quelle. |
| Les erreurs 400/409 | `Illisible` (base64/JSON cassé, **version inconnue** `hc3:` refusée — jamais devinée, offset négatif, non-entier), `Exclusifs` (cursor+before ensemble), `SessionEtrangere` → **400** ; `Perime` → **409** — la cartographie vit AVEC le type (`statut()`), http-api n'en refait pas une couche (le graphe l'interdit et la règle n'a pas à être réécrite). |
| 6 tests (69 sur la crate) | Aller-retour fidèle, legacy fichier + SQLite (byte-exact du fil), A ≠ B (les deux sens + le bon appariement), les illisibilités nommées (×5), l'exclusivité, la cartographie 400/409. |



---

## T025 — le bornage du forward : `caughtUp`, pages 2 MiB/16 MiB, `observe` (C18/C26)

| Livrable | Détail |
|---|---|
| `page_bornee` (sessions) | La cible = **2 MiB**, le plafond **absolu = 16 MiB** ; un record au-dessus de la cible **mais sous le plafond** se rend **seul** (le géant avance) ; un record **hors plafond** = `ErreurBorne::RecordHorsPlafond{taille}` → **422 sans avancer son curseur** (l'appelant garde sa position) ; les I/O restent des I/O (jamais requalifiées en refus de taille). |
| `caughtUp` (contrat additif) | `SessionResponse.caught_up` : **vrai au seul watermark complet observé** — une queue pendante (l'agent écrit) le garde faux ; présent sur le fil **seulement quand vrai** (`skip_serializing_if`) : les réponses du fil actuel et le corpus gelé restent fidèles (17 tests contracts verts). |
| `observe=0/1` (défaut 1) | La query **acceptée** (registre H04 + `observe_valide`) : `"2"`/`"vrai"`/vide → refus nommé (**400**) ; `observe=0` = la lecture **sans renouveler le lease** — le paramètre est porté, la RENEWAL appartient à l'index (T027). |
| `hasMore` | **Reste historique** — l'indicateur du backward, porté par la route comme le fil l'a toujours fait ; la page bornée ne l'invente pas. |
| 4 tests (73 sur la crate) | **Le Delta 32 MiB sans perte ni duplication** (2 001 lignes paginées, chaque n vu UNE fois, ordre exact) ; `caughtUp` faux à la queue pendante puis vrai au complet (+ l'aller-retour du curseur opaque) ; le 17 MiB → 422 sans avancer vs le 3 MiB rendu seul et avançant ; `observe` aux bornes. |



---

## T026 — `sessions::metadata` : le réducteur commun (D18–D22)

| Livrable | Détail |
|---|---|
| `reduis` | Le `ResumeSource` : dernier_prompt (la DEMANDE de l'utilisateur, pas la réponse), aperçu (dernier texte assistant **ou dernier outil + indice** — l'agent bloqué montre sur quoi il attend, mesuré), horodatage (le dernier CONNU, jamais la date du jour), paire modèle/fournisseur, niveau de raisonnement. |
| `reglages_de` | Deux endroits, le plus récent gagne : les changements (`model_change`/`thinking_level_change`) OU le message lui-même — ⚠️ la **paire est une paire** : le fournisseur d'un changement plus ancien ne se colle pas au modèle d'un message récent (D22) ; les substituts entre chevrons exclus (`<synthetic>`). |
| `horodatage_de` + `iso_vers_ms` | Les horodatages pi sont des CHAÎNES ISO — le défaut mesuré (`Number(ISO)` = NaN silencieux) se corrige par un parseur propre (Hinnant inverse, aller-retour testé avec `horodatage_iso`). |
| `indice_d_arguments` | 80 caractères, la première ligne ; `title/cmd/command/path/code` — jamais de JSON déversé dans l'aperçu. |
| `CacheResumes` | **256 sources**, la plus ancienne évincée ; la **fusion incrémentale préserve** les déclarations précédentes (D19 — une fenêtre muette n'efface pas le modèle d'une vieille) ; **une source invalide n'efface pas les autres** (D20 — testé) ; invalidation explicite. |
| 8 tests (82 sur la crate) | Les cinq profils réduits **cohéremment** (la forme pi commune), le repli outil (nom seul / première ligne 80), la paire (3 cas), les placeholders, la fusion, l'éviction, l'isolement, l'ISO aller-retour. |



---

## T027 — `sessions::index` : l'index partagé par source (T027)

| Livrable | Détail |
|---|---|
| **Single-flight** | Le premier entrant lit, les autres attendent le MÊME résultat (`Arc<EnVol>` + Condvar) — **huit clients = UNE lecture sous-jacente** (compteur testé). Le résultat, bon OU mauvais, est posé UNE fois pour tous — jamais de suspension éternelle en cas d'échec (le premier bug, vu avant le commit : un échec de lecture laissait les attendants bloqués). |
| **Générations** | Une invalidation avance la génération de la source — une réponse qui arrive APRÈS l'invalidation est **ignorée** (`GenerationDepassee`, testée : la lecture lente invalidée en vol rend l'erreur, le résultat périmé n'entre JAMAIS au cache). |
| Disparition/réapparition | `invalide` = cold miss forcé (le compteur de lectures repart), la réapparition lit le NOUVEAU contenu. |
| Le lease d'observation | `observe=1` (T025) le renouvelle, `observe=0` le laisse tel quel — la préparation du lien T025→T039. |
| Les bornes de mémoire | **256 entrées, LRU** (le moins récemment utilisé part) — testé par le CACHE (l'évincée n'a plus de résumé), pas par un proxy de génération. |
| 5 tests (82 sur la crate) | Les huit clients, la réponse tardive ignorée, disparition/réapparition, le lease, les bornes. |



---

## T028 — `catalog::process` : l'exécuteur de processus borné (T028)

| Livrable | Détail |
|---|---|
| `execute(argv, délai, annulation)` | **Argv FIXE — aucun shell, jamais `sh -c`** ; délai 20 s (mesuré T028) ; sortie bornée stdout 2 MiB / stderr 64 KiB — **refusée, jamais tronquée en silence** (`SortieTropGrande`) ; les deux flux lus en parallèle (des fils) — un flux plein ne bloque pas l'enfant. |
| Fin et nettoyage | Au délai OU à l'annulation : l'enfant est **tué ET ramassé** (`kill` + `wait` — pas de zombie) ; **les seuls enfants tués sont les nôtres** (un processus qui occupe un port n'est pas un orphelin — règle du dépôt, respectée ici par construction : on ne touche que ce qu'on a créé). |
| ⚠️ Leçon du blocage (vue au test, 10 min de timeout) | Tuer le `sh` orphelinise ses ENFANTS qui tiennent le tuyau → les lecteurs s'accrochaient au `join` pour toujours. Deux corrections : **l'exécuteur ne bloque JAMAIS l'appelant sur les lecteurs après un kill** (ils s'arrêtent à la fermeture du tuyau), et les scripts de test tournent en boucle **pure sh** (aucun enfant à orpheliniser). |
| `Annulation` | Un drapeau coopératif partagé — posé par le détenteur d'un clone ; l'enfant en cours est tué, `Annule` rendu, et un exécutable **sain** marche ensuite (rien n'est « sali »). |
| 6 tests | Sortie/erreur/code non-nul portés, délai tué+ramassé (200 kills consécutifs sans épuisement), surtaille refusée, annulation + sain après, lancement impossible nommé. |



---

## T029 — `catalog::adapters` : les cinq catalogues, parseurs purs (T029)

| Livrable | Détail |
|---|---|
| `parse_pi` | La sortie tabulaire mesurée : l'en-tête écartée, le découpage sur **2+ espaces** (l'espace interne `Anthropic: Claude Opus 5` survit), l'id = `provider/model` (le `~/` des latest tombe), la colonne `thinking` = la **capacité** (oui → les 7 niveaux mesurés), **aucun libellé inventé**. |
| `parse_claude` | La **limitation dite** : « claude does not list its models outside an authenticated session » — les quatre alias du CLI + les efforts mesurés (`low..max`) ; l'alias et la limitation **visibles**. |
| `parse_codex` | Le JSON avec `supported_reasoning_levels` **par modèle** (la source la plus fidèle) ; niveaux dédupliqués dans l'ordre ; l'union pour le catalogue ; le JSON illisible/la forme inattendue/le catalogue vide = erreurs **nommées**. |
| `parse_cursor` / `parse_devin` | **Aucun niveau séparé déduit** (le niveau est DANS le nom — le choisir, c'est choisir un autre modèle) ; devin : le modèle = le **VARIANT**, jamais le slug de famille (`swe-1-6-slow` et pas `swe-2`) ; `--format json` et pas la sortie texte ; le JSON illisible se refuse. |
| L'absence explicite | `adaptateur_de(kind hors table)` = `None` → `models: []` **avec la raison** — l'interface affiche l'absence au lieu d'inventer. |
| Le chemin d'exécution | `catalogue_d_adaptateur(adaptateur, commande_injectée)` — via l'exécuteur borné T028 (les tests passent par des CLIs factices ; **aucun CLI d'agent réel jamais lancé**) ; le code non-nul + le stderr = l'échec **déclaré** (jamais stderr comme sortie). |
| 6 tests (12 sur la crate) | Les cinq formes du tableau CURRENT + l'absence + le chemin d'exécution factice. |



---

## T030 — `catalog::args` : les profils d'args de lancement (T030)

| Livrable | Détail |
|---|---|
| `construit_args` | Le vocabulaire est celui de l'agent, et nulle part ailleurs : pi `--model/--thinking`, claude `--model/--effort`, codex `-m/--config model_reasoning_effort="<n>"`, cursor `--model` **seul** (le niveau est dans le nom — un thinking demandé = refus, le modèle reste proposé) ; le kind hors table = « no verified launch mechanism » ; le trim du fil respecté. |
| La matrice complète | 4 kinds × model présent/absent × thinking présent/absent — **chaque case a son verdict testé** ; un thinking SANS modèle : claude seul l'applique (`--effort` indépendant), les autres refusent (on ne devine pas de modèle). |
| Le fournisseur | **Explicitement non appliqué** (`fournisseur_applique: false`, historiquement vrai) — le champ `provider` de la demande ne fuite jamais dans les args et rien ne le présente comme appliqué (testé sur les quatre kinds). |
| `niveau_supporte` | La vérification respecte ce que l'agent DÉCLARE : niveau offert = passe ; non offert = refus **citant les disponibles** ; modèle absent du catalogue ou muet (niveaux vides) = on ne tranche pas à sa place ; kind hors table = « unverified reasoning level » ; thinking blanc = rien à vérifier. |



---

## T031 — `catalog::cache` : le single-flight et le TTL des catalogues (C16)

| Livrable | Détail |
|---|---|
| **Deux requêtes concurrentes = UN processus** | Le single-flight (le gabarit T027 : `Arc<EnVol>` + Condvar) — huit requêtes concurrentes d'un kind : **le compteur d'invocations du CLI factice reste à UN** (testé). |
| Succès 60 s, échec réessayable | Le succès entre au cache jusqu'à `VIE_SUCCES` (60 s — `MODEL_CATALOG_CACHE_MS` mesuré) ; **un échec n'entre JAMAIS** — testé : échec puis CLI sain → succès immédiat (rien de figé). |
| La même politique pour liste et lancement | Les deux passent par la MÊME fonction `catalogue` — une exécution couvre les deux (compteur à un) ; l'absence de kind reste explicite par le même chemin. |
| Le registre partagé | `adaptateur_de` reste LE registre des intégrations (T029) ; l'invalidation explicite force la relecture (testé : 2 invocations). |
| 4 tests (19 sur la crate) | Concurrence exactement-un, échec réessayable, invalidation, la même politique. |



---

## T032 — la crate `interactions` : les questions à l'écran, le répondant (T032)

| Livrable | Détail |
|---|---|
| `ecran.rs` — le parseur | Le port fidèle de `question.ts` **sans regex** : le filet `┃` retiré (l'écran opencode mesuré, agent bloqué — sinon AUCUN choix reconnu), les choix `›? numéro. corps`, le détail au **dernier** trou de 2+ espaces des deux côtés ou sur la ligne suivante **plus indentée** (pas une ligne de choix ni d'invite — sinon `enter to submit` devenait un détail), la remontée **contiguë** (1..n exigé — une sortie d'outil numérotée n'est pas une invite), `App: Zen`/`Field 1/1` classés en contexte, l'invite `enter…`/`↑↓` (les deux formes mesurées), `OPTION_SAISIE_LIBRE` reconnue — et un écran **non reconnu n'émet aucune action**. |
| `repondre.rs` — le répondant | Le port étroit = `ControlPort` du domaine (le Pick du fil) ; **rien n'est envoyé hors des choix offerts** (la garde teste le numéro — avec le cast d'u64::MAX en i64 = -1 attrapé par le test : toute offre rendait fausse) ; la séquence saisie libre (numéro, enter, **texte, enter**) ; un texte d'espaces n'écrit rien ; **la RELECTURE après la frappe** : appliquee/transmise/refusee — jamais « envoyé » sans preuve. |
| Les profils (famille gabarit) | Le gabarit est le SOCLE : les écrans pi/codex (détail de même ligne), opencode (détail suivant + filet), la saisie libre d'opencode — aucun profil mesuré manquant remplacé par Codex (le parseur ne suppose AUCUN écran). |
| 10 tests (la crate neuve) | L'écran opencode du corpus + les garde-fous du détail, la numérotation incohérente refusée, le classement contexte/champ, la garde du numéro, les trois états du répondant (refus = valeur), la séquence libre. |

Le cast `u64::MAX as i64 = -1` (la borne haute fausse) est le genre d'incident que la preuve par test attrape : aucune relecture ne l'aurait vu.



---

## T033 — `interactions::engine` : lire → valider → plan → exécuter → relire (C03/C17)

| Livrable | Détail |
|---|---|
| **C03 — l'identité** | `preuve_reconnue` : une confirmation portant une AUTRE empreinte se rapporte en `Unknown` (le détail nomme les deux empreintes) — le client n'affiche jamais « envoyé » sur une preuve qu'il ne reconnaît pas ; les états honnêtes passent tels quels. |
| **C17 — le choix** | `question_a_change` : le texte ET la place du `›` doivent être les mêmes avant/après — une NOUVELLE question après la frappe, ou une sélection déplacée (Claude, mesuré) = un changement ; la question partie = le succès attendu ; une question apparue là où il n'y en avait pas = la frappe a visé autre chose. |
| Le moteur du prompt | `soumet_prompt` : exécuter puis rapporter l'empreinte reconnue — les résultats partiels (Unknown/Suppressed/Failed) se conservent TELS QUELS, jamais lissés en succès. |
| La relecture | `relit_apres_frappe` : l'agent sorti (écran vide) = la question partie (pas de changement) ; la même question restante = la frappe non prise. |
| 4 tests (14 sur la crate) | Les cinq cas du fil — questions périmées, sélection déjà déplacée, agent sorti, nouvelle question après frappe, empreinte étrangère — **aucun faux succès**. |



---

## T034 — `application::commands` : l'admission et les files par pane (T034)

| Livrable | Détail |
|---|---|
| `Tourniquet` | La file par pane bornée à **8** (`FILE_PANE_MAX` mesuré) : un galet d'abord (la file pleine = `Saturation` **nommé**, pas une file infinie), PUIS le tour exclusif (un seul effet à la fois par pane), PUIS l'effet ; le galet rendu après. |
| A/B indépendants | Deux panes tournent **en parallèle** (le pic de concurrence testé = 2) ; huit effets sur le MÊME pane : le pic = 1 — **les séquences d'un même pane ne s'entrelacent jamais**. |
| La saturation | Testée dans la vraie fenêtre : les 8 fentes tenues (effets de 250 ms), la 9e demande pendant → `ErreurAdmission::Saturation` (400 au fil, T050). |
| L'annulation après effet | Structurel : la file n'a AUCUNE relecture — deux appels successifs = deux tours (le compteur le prouve), jamais de rejeu. |
| 4 tests | Parallélisme inter-panes, non-entrelacement intra-pane, saturation dans la fenêtre réelle, deux tours sans rejeu. |



---

## T035 — `application::commands::prompt` : le service prompt (C05–C06)

| Livrable | Détail |
|---|---|
| L'empreinte | `empreinte_de` = SHA-256 de `cible\0texte` (32 hex) — **l'empreinte actuelle** (le contenu), par pane. |
| **D007.2, la sémantique corrigée** | Le fil cherchait le doublon dans TOUTE la fenêtre (le A→B→A bloqué à tort) — ici la règle de l'utilisateur : **le dernier envoi confirmé PAR CIBLE** ; le même texte consécutif et confirmé → `Doublon` supprimé ; **A→B→A passe** (le dernier est B — testé) ; une cible voisine reste indépendante. |
| Le retry débloqué | Un échec (timeout, transport), une preuve étrangère, une frappe partielle (le texte écrit, l'enter raté) : **RIEN n'est enregistré** — le prochain envoi passe (testé pour chaque cas ; `suivi()` = 0). |
| **C05 — le discriminateur exigé** | La confirmation portant une AUTRE empreinte = jamais un succès — rapportée en inconnu, non enregistrée (le détail cite l'empreinte portée). |
| Le repli interactif | **Sur refus connu seulement** : le texte mesuré « blocked and requires interactive input » bascule en FRAPPES (texte puis enter) — et la confirmation reste **`Inconnu`** (les frappes écrites ≠ l'application prouvée) ; un refus d'une autre nature ne bascule PAS (testé : aucun texte envoyé). |
| La fenêtre monotone | 60 s sur `Instant` (jamais la date du jour). |
| 7 tests (11 sur la crate) | SHA-256, doublon, A→B→A, échec/inconnu/frappe partielle, discriminateur, repli, fenêtre. |

Commit préfixé `T035:` contenant `crates/application/src/commands/**` (admission + prompt), `tests/unit/**` et cette section. Cargo.lock inchangé (sha2 déjà au workspace).
---

## T036 — `application::commands::stop/focus` : l'arrêt et le focus (A04–A05)

Périmètre : `crates/application/src/commands/{stop,focus}.rs`, `crates/application/tests/unit/{stop,focus}.rs`, `crates/test-support` (panne par opération), `xtask` (collecteur de graphe). Premier consommateur du faux `HerdrFaux` par une autre crate (T006).

### Livrables produits

| Livrable | Détail |
|---|---|
| `ArreteurAgent::arrete` | **Observation fraîche à chaque appel** (aucun cache — testé par relecture d'un état changé) ; agent absent → `AgentAbsent` (404 au fil) ; non-`working` → **no-op** `NonEnCours` (valeur `not-running`, jamais une panne, testé Idle/Blocked/Done/Unknown, zéro envoi) ; `working` → Ctrl+C **via le port** ; `InterruptSent` = transmission, jamais arrêt prouvé (A04). |
| La course photo→envoi | L'agent a fini entre la photo (`working`) et l'envoi : le port répond `NotRunning` → no-op honnête, pas un faux `interrupt-sent`. |
| Les causes distinctes | `SnapshotIndisponible` (amont, délai) ≠ `SnapshotIllisible` (enveloppe) ≠ `Transmission` (envoi) — chacune nommée avec sa cause réelle (502 au fil), rien n'est masqué. |
| `FocaliseurAgent::focalise` | **L'échec reste une valeur** : refus OU panne de transport → `focalise: false` (jamais une erreur — « focus échoué n'empêche pas lecture », A05) ; la cause exacte est portée. |
| La ligne de journal | `IssueFocus::ligne_journal` produit `focus <pane> (ok\|échec)` — le format exact du fil, la seule trace observable d'un POST focus (A05) ; écriture par le sink T055 côté endpoint (T051). |
| La cible | Toujours celle de l'appel, jamais la conversation affichée (capturée à l'admission T034) — l'action capture du faux prouve la cible. |
| C24 | L'**endpoint** est conservé (effet réel, `focused` porté) ; la décision d'appeler ou non focus à la lecture reste frontend (T062). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p test-support -p application` | PASS — 23 tests `application` (11 T034–T035 + 8 arrêt + 4 focus), 25 tests `test-support` (+1 panne par opération). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** : verify-layout (495 fichiers), graphe (ordre topologique conforme), format, clippy, tests. |

### Décisions et honnêteté (notées, pas masquées)

0. **Le gate de graphe lisait les dev-dependencies comme des arêtes** — l'ajout de `test-support` en dev-dependency de `application` faisait échouer `xtask verify` (« arêtes internes de «application» divergent »). TECH §2 dit explicitement : « Test-support can be a dev-dependency without inducing production dependency cycles » — le mermaid gelé décrit le graphe de **production**. Le collecteur (`xtask/src/run.rs`) ignore désormais les arêtes `kind=dev/build` (le check le plus délicat : `cargo metadata` émet `"kind": null` explicite pour les arêtes de production, et `"dev"` pour les dev-dependencies) ; commentaire synchronisé dans `xtask/src/graph.rs`. Aucun membre du graphe n'a changé, aucune `src` de production n'est concernée.
1. **Premier consommateur de `HerdrFaux`** : la capture ordonnée des actions (l'objet de T006) sert enfin la preuve « cible et ordre » — collage impossible avec les faux inline. Ajout de `panne_sur(op, panne)` : la panne d'UNE opération (le snapshot réussit, la transmission échoue) — nécessaire pour T036, réutilisable pour T051 (502 par branche). Une panne par opération et une globale restent cumulables localement, la capture note toujours l'action tentée.
2. **`pousse` partagé dans `commands/mod.rs`** : les services pollent leurs `PortFuture` au premier poll (contrat du transport T012 et de tout faux) — `Pending` est un branchement cassé signalé comme tel, jamais une attente silencieuse.

Commit préfixé `T036:` contenant `crates/application/src/commands/{stop,focus}.rs` + `mod.rs`, `crates/application/tests/unit/{stop,focus}.rs` + `mod.rs`, `crates/application/Cargo.toml` (dev-dep `test-support`), `crates/test-support/src/fake_herdr.rs` (panne par opération) + son test, `xtask/src/{graph,run}.rs` (graphe de production), `Cargo.lock` (arête workspace, aucun paquet externe) et cette section. Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

---

## T037 — `application::commands::launch` : le moteur de lancement (A06–A08, C07)

Périmètre : `crates/application/src/commands/launch.rs` (+`mod.rs`), `crates/application/tests/unit/launch.rs` (+`mod.rs`), `crates/interactions/src/confiance.rs` (+`lib.rs`, tests), `crates/domain/src/ports.rs` (port `fermer_onglet`), `crates/test-support` (file scriptée de lancements). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| **C07 — tout valider avant l'onglet** | La validation injectée (kind/modèle/raisonnement, T030) précède TOUT appel au port — une entrée invalide = `ValidationRefusee`, **zéro onglet, zéro appel** (testé : `actions()` vide). Puis snapshot frais → workspace → dossier → nom → onglet → coquille → démarrage. |
| Le dossier | `checkout_path` du worktree lié GAGNE, sinon le premier pane du projet qui porte un cwd (les agents de la photo, ordre du snapshot) — jamais deviné (`DossierInconnu` 502 si rien). |
| Le nom | Demandé → tel quel (conflit amont autoritaire) ; généré → `useful_label` + `-1..99` dès le premier, **réservé contre les concurrents du même libellé** (testé : même photo, second lancement `atelier-3`) ; 99 suffixes pris → `NomEpuise`, jamais un nom occupé repris. |
| L'onglet | `CreateTab` non focalisé, cwd connu, libellé = nom ; `CreationTab` échouée → `OngletRefuse`, rien n'existe, rien à nettoyer. |
| Le retry coquille | **Seul** `ShellNotReady` se rejoue (3 s × 10 = 30 s) ; tout autre refus casse immédiatement (testé : 1 essai, 0 attente). 10 essais → `CoquilleNonPrete` : l'agent n'a JAMAIS amorcé → **fermeture de l'onglet possédé, et lui seul** (testé : exactement `t-1`). |
| Les délais | Démarrage borné 125 s (contrat port, T012) + budget global 160 s — coupés dans la boucle ; l'horloge EST INJECTÉE (les tests avancent 130 s d'un coup, sans dormir). |
| L'ambigu | Un délai SANS verdict → `AmorcageAmbigu`, **jamais de relance, jamais de fermeture** : l'agent PEUT exister (testé : 1 démarrage, 0 fermeture). |
| La confiance | Refus `blocked` (texte mesuré) + invite à l'écran → `ConfianceRequise` (409 au fil), la décision EXPOSÉE, **aucune touche envoyée** (testé : lecture d'écran seule). Bloqué sur un AUTRE dialogue → refus normal. Détection de l'invite = nouveau module `interactions::confiance` (4 tests, détection seulement, jamais de réponse). |
| Le port | `ControlPort::fermer_onglet(tab)` — nettoyage **possédé** (jamais l'onglet d'autrui), documenté comme tel ; implémenté dans les 5 faux. |
| Le test-support | `scripte_lancements(Vec<StartEvidence>)` : joué dans l'ordre, **le dernier se répète** (testé) — le scénario de retry s'écrit d'une règle, réutilisable T051. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p test-support -p interactions -p application` | PASS — application 35 (23 + 12 lancement), interactions 18 (+4 confiance), test-support 26 (+1 file scriptée). |
| `cargo clippy … --all-targets` | zéro avertissement (alias `ConstructeurArgs` pour le type complexe). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé : `application → interactions` existe déjà dans TECH §2). |

### Décisions et honnêteté (notées, pas masquées)

0. **La réservation de noms expire d'elle-même** (180 s = budget + marge, purge à la lecture) mais l'expiration n'est PAS testable : elle repose sur `Instant` réel, comme la fenêtre 60 s de T035 — limite d'horloge assumée, l'expiration est un filet de sécurité au-delà de sa durée affichée. L'insertion précède `create_tab` : un concurrent ne peut pas piquer le nom en plein vol.
1. **Le « retry non ambigu »** : le moteur ne rejoue QUE `ShellNotReady` — les textes mesurés ne servent qu'à distinguer la confiance (`blocked`) ; il n'existe pas de deuxième branche de retry par texte.
2. **Le 125 s** : c'est le délai de la tentative port (à borner côté T012) ; le moteur le vérifie comme plafond conjoint avec le 160 s et l'exporte comme contrat.
3. **Le nettoyage au mieux** : `ferme_le_possede` ignore l'échec de fermeture (le verdict est déjà décidé — `Effect.ignore` du fil) ; on ne ferme JAMAIS un onglet qu'on n'a pas créé, ni un agent au démarrage ambigu.
4. **La lecture d'écran bornée** (256 lignes) pour la détection de confiance : une invite de fraîche démarre est en tête de log ; une lecture sans texte = pas d'invite (le fil fait de même).

Commit préfixé `T037:` contenant tout ce qui précède et cette section.

---

## T038 — `application::state/refresh` : l'observation partagée (C23, D01)

Périmètre : `crates/application/src/{state,refresh}.rs` (+`lib.rs`), `crates/application/tests/unit/refresh.rs` (+`mod.rs`), `crates/test-support` (`sans_panne`). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `ObservationBorne` | La photo complète **immuable**, horodatée par l'horloge INJECTÉE et numérotée par **génération** (le nombre de vols réussis) ; version/protocole amont portés par la provenance de la photo (TECH §4 : « complete immutable snapshot plus observation time/generation and upstream version/protocol »). |
| `ServiceSnapshots` | Possède le port, distille une seule vue partagée. `lecture()` (fenêtre 2 s) · `lecture_forcee()` (admission/racines de fichiers) · `sante()` (ping coalescé, TTL 1 s, SÉPARÉ du snapshot) · `pulse()` (battement du poller). |
| **Coalescence (C23)** | UN vol à la fois ; les signaux simultanés s'y JOIGNENT par condvar — tests : 8 lecteurs périmés = 1 appel amont, même génération pour tous ; 8 forces pendant un amont RETENU (port à sas) = 1 appel. |
| **Cache vide valide** | Un snapshot vide (zéro agent, zéro workspace) est une OBSERVATION, servie 2 s sans rappel (`un_snapshot_vide_est_une_observation_valide`). |
| **Jamais du périmé servi** | La panne du rafraîchissement est remontée telle quelle (502 au fil) — l'ancienne observation est CONSERVÉE mais refusée ; la reprise après panne envoie un nouveau vol (testée avec `sans_panne`). |
| **Force** | Quitte la fenêtre de cache en partageant seulement un vol déjà en cours ; une force qui rejoint un vol RÉUSSI sert la génération commitée (corrigé en test : 8 générations relancées à tort → 1). |
| **Horloge injectée** | `SourceMaintenant` — TOUTES les fenêtres (2 s, 1 s) se testent sans dormir (le faux avance à la main), TTL mesurés en constantes exposées. |
| **Verrous courts** | Aucun verrou tenu pendant l'appel amont (le vol est un drapeau + condvar, TECH §4) ; garde double : le porteur ne commit que sous le verrou, après libération de l'E/S. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p test-support -p application` | PASS — application 47 (35 + 12 refresh), test-support 26. |
| `cargo clippy … --all-targets` | zéro avertissement (`if let` chaînés refondus, helpers de test sans `expect`). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé — aucun membre touché). |

### Décisions et honnêteté (notées, pas masquées)

0. **Le seul bug de comportement trouvé par les tests** : ma première horloge de test reculait dans le passé (`now − offset`) — les fenêtres ne vieillissaient jamais et le test « panne non masquée » servait du frais à tort. Le faux `base + déplacement` a rendu les fenêtres réelles ; l'incident est la preuve que l'horloge injectée fonctionne.
1. **Le mode forcé a d'abord relancé 8 vols** pour 8 forces (chaque joineur recommençait après le succès du vol joint). Corrigé : un joineur d'un vol RÉUSSI sert la génération commitée ; seul un forcer qui rejoint une PANNE relance (son autorisation dépend de la fraîcheur réelle).
2. **Le « sleep de 150 ms » du test de force partagée** est délibéré : la fenêtre d'envolement ne peut pas exister avec un faux qui résout au premier poll — le port à sas retient la photo amont jusqu'au signal. Un joineur simulé en retard briserait l'assertion, ce qui est exactement la propriété voulue (commentaire posé dans le test).
3. **Le forcer qui rejoint un vol échoué relance** — c'est le contrat « force » (elle exige une fraîcheur réelle) ; le lecteur ordinaire joint reçoit la panne partagée et ne relance pas (une seule requête par génération de demande).
4. **`pulse()` rend l'échec** pour le journal du poller (la composition T056 décide de le logguer) — il n'est pas un point de décision.
5. **Le câblage réel** (admission → `lecture_forcee`, santé → `sante`, poller → `pulse`) arrive avec les endpoints (T050/T051+), comme T034–T037 avant lui : le service est livré, prouvé, prêt à être fils au moment venu.

Commit préfixé `T038:` contenant `crates/application/src/{state,refresh}.rs` + `lib.rs`, `crates/application/tests/unit/refresh.rs` + `mod.rs`, `crates/test-support/src/fake_herdr.rs` (`sans_panne`) et cette section.

---

## T039 — `application::overview/conversations` : l'accueil et la liste (D01–D05, D18–D20)

Périmètre : `crates/application/src/{overview,conversations,visibilite}.rs` (+`lib.rs`), `crates/application/tests/unit/{overview,conversations,visibilite}.rs` (+`mod.rs`), `crates/domain/src/naming.rs` (`panes_situes` partagé). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `ComposeurOverview` | La vue d'accueil sur **UNE génération** d'observation (T038) : vues agent/workspace homologues `domain::observation::{AgentView, WorkspaceView}` — worktree lié gagne sur cwd de pane (D02), compteurs du SNAPSHOT (jamais reconstruits), workspace vide gardé, tri-état du cwd (`CwdMatch::Unverifiable` ≠ faux, D03), libellé numérique supprimé + rang depuis la disposition (D04), version/protocole portés par l'observation. |
| `visibilite.rs` | La règle D05 en **un seul corps** (accueil ET liste) : source lisible, état `blocked/working`, tab multi-panes, type à lecture vérifiée ; `repartir_agents` = le `withoutSession` (le COMPTE des masqués). |
| `ServiceConversations` | Une ligne par pane **visible** même sans session (`absent` distinct de `error`) ; titre Herdr → onglet utile → projet → pane_id ; aperçu = dernier texte d'assistant sinon dernier outil (`nom · indice`) ; dernière DEMANDE utilisateur ; modèle/fournisseur **en paire** (D22) + pensée en vigueur ; horodatage jamais fabriqué. |
| **Isolation par ligne (D20/C23)** | Une session illisible → SA ligne `error` + SA cause (jamais générique) ; les voisines restent riches ; panne bénigne = `available` et vide. |
| **Permis à 4 lectures** | `SasDeLecture` + `std::thread::scope` (workers bornés, index atomique) — le plafond du contrat, prouvé par le PIC derrière une porte (8 panes, pic ≤ 4). |
| **Invitation mesurée à l'écran** | Question (interactions::ecran), confiance (interactions::confiance, EXPOSÉE jamais répondue, dossier = cwd du pane), attente brute (bloqué sans question) ; on lit un agent qui n'a RIEN à montrer ou `blocked`, jamais `working` ; zéro frappe envoyée (testé). |
| **Branche injectée** | `BrancheDeProjet` (le vrai cache 30 s arrive au T040) ; la branche vient du **cwd du pane**, pas du projet. |
| **Frontière sessions** | Le graphe interdit `application → sessions` : `LitSessions`/`ResoutSessions` (résolution + fenêtre normalisée `EntreeLu`) sont INJECTÉS — herdrchat les compose au T056 ; `application` assemble les résumés, `sessions` lit et normalise. |
| `domain::naming::panes_situes` | Le mapper agents→panes situés déplacé du moteur de lancement vers le domaine : T037 et T039 partagent la MÊME construction du dossier de travail. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p application --test unit_tests` | PASS — **78 tests** (47 + 7 visibilité + 8 overview + 16 conversations). |
| `cargo clippy … --all-targets` | zéro avertissement. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé : aucun membre ajouté). |

### Décisions et honnêteté (notées, pas masquées)

0. **Le fil n'a pas de `name` dans le titre** : `titleOf` = titre Herdr → onglet → projet → pane_id ; le NOM étiquette l'agent (carte), il n'entre pas dans la ligne — deux tests écrits sur une hypothèse contraire ont été corrigés par la référence.
1. **Le permis est réel** : en monde synchrone, `std::thread::scope` avec des workers bornés est le véhicule du plafond « 4 sessions en lecture » — la preuve par le pic derrière une porte (le seul sleep de test, délibéré, commenté). L'enrichissement d'écran reste séquentiel (le `Promise.all` sans plafond du fil n'est pas reproduit : chaque lecture cible déjà exactement les lignes qui n'ont rien à montrer).
2. **La résolution est la même pour l'accueil, la liste ET la lecture** (U14) : `ResoutSessions` est la porte unique — le fil l'avait dédoublée, et les deux chemins ont divergé sur les agents muets ; ici une seule décision, une seule implémentation à venir (T056).
3. **Le 80 caractères de l'indice d'outil** (règle mesurée du fil) vit dans l'assemblage applicatif ; le plafond d'octets de l'aperçu (`PREVIEW_BYTES`) reste au fil (contracts/http-api, T050) — les limites de taille du fil ne sont pas dupliquées.
4. **`application` ne produit pas les DTO filaires** : les homologues `domain::observation::{AgentView, WorkspaceView}` existaient (T005) ; la traduction vers `contracts::http::overview` appartient à http-api (T050), les règles de remplissage sont ici (T039) — exactement la répartition que la doc de `domain` annonçait.

Commit préfixé `T039:` contenant tout ce qui précède et cette section.

---

## T040 — `application::git` : la branche par git, bornée et partagée (D21)

Périmètre : `crates/application/src/{git,permis}.rs` (+`lib.rs`), `crates/application/tests/unit/git.rs` (+`mod.rs`), `crates/application/src/conversations.rs` (le sas partagé). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `LecteurBranches` | `git -C <dossier> rev-parse --abbrev-ref HEAD` — la SEULE source de branche (Herdr n'en expose aucune) ; **argv fixe** (la frontière de test remplace le PROCESSUS, jamais la commande) ; cache 30 s avec horloge injectée + purge des entrées expirées à chaque lecture ; trois absences (pas de dépôt, délai, git absent) confondues en une branche ABSENTE, jamais une erreur (D21). |
| **Un job par cwd** | Les demandes concurrentes du même dossier s'y joignent (vol + condvar) et retrouvent le cache à leur réveil — jamais deux git pour la même branche (prouvé : 2 threads, 1 lancement). |
| **Exécuteur borné** | `SasDeLecture` extrait dans `permis.rs` (le plafond partagé, utilisé par les lectures de session T039 et git ici) ; au plus `GIT_CONCURRENTS = 2` processus en même temps, pic mesuré derrière une porte. |
| **Délai 3 s** | Le poll tue le processus RETARDATAIRE, et lui seul (un compteur de tués prouve qu'aucun voisin n'est touché) ; la capture est bornée à `MAX_SORTIE = 4096` PENDANT la lecture (le lecteur de sortie s'arrête au plafond, le reste est jeté). |
| **HEAD détaché** | `HEAD` n'est pas une branche : la réponse littérale est une branche absente (mesuré). |
| **Câblage T039→T040** | `LecteurBranches` implémente `BrancheDeProjet` : la liste reçoit la vraie branche par le trait déjà injecté. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p application --test unit_tests` | PASS — **89 tests** (78 + 11 git). |
| `cargo clippy -p application --all-targets` | zéro avertissement (les `expect()` de test remplacés par des `panic!` nommés, convention du repo). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé). |

### Décisions et honnêteté (notées, pas masquées)

0. **Le délai se teste sans dormir 3 s** : le lecteur accepte un délai injecté (`avec_delai`, 60 ms en test) ; le processus réel garde `DELAI_GIT = 3 s`. Le délai d'un processus réel s'écoule en TEMPS RÉEL (le poll dort 10 ms), le TTL du cache suit l'horloge injectée — deux temps, deux rôles, honnêtement distincts.
1. **Le pic de l'exécuteur se mesure sur les processus RETENUS** : compter les lancements donnait toujours 1 (le faux rend son processus instantanément) ; le compteur vit dans l'interrogation d'état bloquée par la porte — la mesure réelle du plafond.
2. **Le joineur revient à la case cache** : la première version relançait un job après un réveil (2 lancements pour 2 threads) ; le vol n'est qu'une porte, le cache est la réponse — corrigé par le test.
3. **La purge précède la lecture** : à l'expiration, TOUTES les entrées périmées partent avant la relecture (le test de purge a d'abord été écrit sur un raisonnement faux, corrigé par l'exécution).
4. **Le lecteur de sortie est un fil par git** : borné par l'exécuteur (2), il s'arrête à la fin de la sortie ou au plafond — un `recv` court après la sortie du processus, jamais une lecture sans fin.

Commit préfixé `T040:` contenant tout ce qui précède et cette section.

---

## T041 — `application::events::watcher` : le veilleur du direct (E01–E03, E06)

Périmètre : `crates/application/src/events/{mod,watcher}.rs` (+`lib.rs`), `crates/application/tests/unit/events/{mod,watcher}.rs` (+`mod.rs`). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `Veilleur` | Le diff par **signature** (statut, titre, cwd, type, session — E02) ; apparu (jamais au premier parcours, E03), statut (métadonnées peuvent émettre de→vers identiques), disparu avec la **dernière vue conservée** (E03 : l'agent sortant reste nommable). |
| `CibleDeChangement` | `Statut(AgentStatus) | Disparu` — « gone » n'est PAS un état Herdr, c'est un artefact du veilleur ; l'union fermée du domaine n'est pas polluée. |
| `faut_notifier` | E06 : `working`→tout autre état ; `working`/`blocked`→gone ; `idle`/`done` disparus = fin normale, pas de bruit ; cause jamais inventée (Herdr ne rend ni code ni raison). |
| `BoucleDeVeille` | E01 : itération complète PUIS 2 s (une lecture à la fois, prouvé par le pic derrière une porte) ; cache des dernières vues, instant du dernier succès (horloge injectée), compte d'erreurs ; **panne ≠ disparition** : une source injoignable compte une erreur, ne publie rien, ne vide pas le parc ; au rétablissement, le diff repart de la dernière vue réussie (un agent réellement nouveau est annoncé, jamais la masse). |
| Frontières | `SourceDeVues` (la panne est un `Err`, jamais une liste vide) et `PublicateurDeChangements` (le journal T042 le câblera) sont INJECTÉS — le veilleur ne connaît ni Herdr ni le journal. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p application --test unit_tests` | PASS — **104 tests** (89 + 15 watcher). |
| `cargo clippy -p application --all-targets` | zéro avertissement. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé). |

### Décisions et honnêteté (notées, pas masquées)

0. **La réapparition après disparition TOTALE est muette** : le fil teste `before.size > 0` — un parc précédent vide est traité comme un premier passage (pas de rafale). Mesuré sur la référence, reproduit à l'identique, documenté par un test dédié ; la réapparition pendant que d'autres agents restent est, elle, annoncée.
1. **Le publicateur reçoit les tours vides** : le fil publie chaque tick (le journal T042 filtrera ou non) — la preuve « la panne ne publie rien » compare le NOMBRE de publications, pas leur contenu.
2. **Le premier tour d'un veilleur vierge ne publie rien** : la règle E03 vit dans le diff, pas dans la boucle — une boucle qui démarre sur un parc non vide annonce les apparitions dès le premier tour (c'est le cas normal après un démarrage à froid ? non : le premier tour d'un veilleur neuf est TOUJOURS muet, le parc précédent est vide). La boucle ne fait que consommer le diff.
3. **La cadence se teste par le pic, pas par le compteur** : « 2 s après une itération complète » se prouve par « jamais deux lectures simultanées » (porte + pic = 1), pas par un décompte d'itérations qui serait flaky.
4. **`en_marche` est un drapeau de sortie, pas un mutex** : la boucle vérifie au point de contrôle ; `arreter` ne coupe pas une lecture en cours (une lecture en cours finit, puis la boucle sort).

Commit préfixé `T041:` contenant tout ce qui précède et cette section.

---

## T042 — `application::events::journal` : la mémoire du direct (E04, E05, C11)

Périmètre : `crates/application/src/events/journal.rs` (+`mod.rs`), `crates/application/tests/unit/events/journal.rs` (+`mod.rs`). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `Journal` | Le journal borné en mémoire (E04) : **500 événements ET 4 MiB d'octets** — la cardinalité ne prétend pas borner une taille de payload arbitraire ; l'éviction par octets rompt la continuité EXPLICITEMENT (resync), jamais en silence. Publication = UNE étape de possession courte (attribution de l'identifiant, rétention, éviction) — prouvé par 8 publicateurs concurrents : 800 publiés, 500 retenus, séquences contiguës sans trou ni doublon. |
| `IdJournal` | L'identifiant opaque `<boot>:<sequence>` (C11) — le boot change à CHAQUE démarrage (le journal est en mémoire, un redémarrage le perd) ; séquences monotones à partir de 1. Boot généré sans dépendance (nanos + compteur de processus), l'opacité suffit — EventSource ne parse pas les IDs. |
| `Rattrapage` | Le rattrapage depuis un curseur : trou/éviction, curseur futur, boot étranger et curseur **legacy numérique** provoquent UN resync ; le resync porte `reprendre_de` = frontière courante (un seul resync, jamais deux, B04) ; **curseur absent → frontière courante après ready, sans rejouer l'historique** (C11). |
| `ErreurJournal` | Un événement au-delà de **256 KiB** est REFUSÉ, jamais tronqué (contrat des budgets). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p application --test unit_tests` | PASS — **117 tests** (104 + 13 journal). |
| `cargo clippy -p application --all-targets` | zéro avertissement (les `expect()` de test remplacés par des `panic!` nommés). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé). |

### Décisions et honnêteté (notées, pas masquées)

0. **Le filtre reste honnête sur un resync** : `depuis` rend ce qui est strictement après le curseur MÊME quand la continuité est rompue (comme le fil, qui envoie les deux) — c'est le consommateur (T053) qui décide de les envoyer ou non après un resync. Le journal ne tranche pas, il signale.
1. **La frontière du resync est `ancien−1`, pas `ancien`** : un curseur juste avant le plus ancien retenu rejoue tout ce qui reste (continu) ; un curseur plus bas a manqué des événements disparus (resync). Mes deux premiers tests l'avaient mal calibré — corrigés par l'exécution, documenté dans le test de bord.
2. **Le boot n'est pas un UUID RFC-4122** : aucune dépendance aléatoire dans le workspace ; nanos + compteur de processus suffisent à distinguer les époques. Documenté dans le code — l'opacité est le contrat, pas le format.
3. **`depuis("")` ne rejoue rien** : C11 corrige le fil (qui rejouait tout l'historique sur un Last-Event-ID absent) — un nouveau client part de la frontière courante après `ready`, il ne reçoit pas l'historique entier dans une nouvelle fenêtre.

Commit préfixé `T042:` contenant tout ce qui précède et cette section.

---

## T043 — `application::events::subscription` : les flux du direct (E05, C11)

Périmètre : `crates/application/src/events/subscription.rs` (+`mod.rs`), `crates/application/src/permis.rs` (`tente_acquiere` + `GardeDePermis` RAII), `crates/application/tests/unit/events/subscription.rs` (+`mod.rs`). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `ServiceAbonnements` | La publication passe PAR LE SERVICE (jamais par le journal directement) : le journal d'abord, puis la sonnette des abonnés — sous la MÊME possession que la création d'abonnement, pour que rien ne tombe entre rattrapage et live. |
| `abonne(curseur)` | Le rattrapage ET le récepteur live sous UNE possession (TECH §7) — un événement publié pendant la création est soit dans le rattrapage, soit dans la sonnette, jamais perdu, jamais doublé (prouvé des deux côtés). |
| **8 permis RAII** | `GardeDePermis` (chute = rend la place EXACTEMENT une fois) ; le 9e flux est REFUSÉ (503), jamais mis en attente ; 100 cycles connect/disconnect → les 8 places toujours disponibles, aucun émetteur orphelin. |
| **Sonnette bornée** | `sync_channel(CANAL_LIVE = 16)` + `try_send` : un consommateur lent ne bloque JAMAIS la publication et ne grossit pas la mémoire — un événement tombé reste dans le journal (l'autorité de relecture), retrouvé au prochain heartbeat. |
| **Heartbeat 15 s** | `attend(délai)` rend `None` après le délai — la cadence du flux ; la relecture depuis le curseur retrouve ce que la sonnette a laissé tomber. |
| **Nettoyage honnête** | Le Drop de l'abonnement pose un drapeau `ferme` (jamais de faux événement pour tester la connexion) ; les morts partent à la prochaine opération — le compte reflète les vivants. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p application --test unit_tests` | PASS — **126 tests** (117 + 9 abonnements). |
| `cargo clippy -p application --all-targets` | zéro avertissement. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé). |

### Décisions et honnêteté (notées, pas masquées)

0. **`let _ = abonne()` droppe immédiatement** : mon premier test « 9e refusé » ne tenait jamais les 8 abonnements — la 9e place semblait libre. Le test a été corrigé pour RETENIR les abonnements (Vec), et l'assertion est devenue exacte.
1. **Le canal plein ne désabonne pas** : `try_send` sur un canal plein renvoie `Full` — l'abonné est vivant mais lent, il RESTE ; seul `Disconnected` ou le drapeau de fermeture le retire. Sans cette distinction, un consommateur lent aurait été déconnecté par sa propre lenteur.
2. **Le drapeau `ferme` plutôt qu'un faux événement** : ma première version testait la connexion en envoyant un événement factice — un abonné vivant aurait reçu du bruit. Le Drop pose un drapeau `AtomicBool`, le service le lit sans envoyer.
3. **Le journal reste l'autorité** : la sonnette est une sonnette — le heartbeat vide déclenche la relecture depuis le curseur, qui retrouve tout. C'est le modèle TECH §7 (« broadcast receiver is a wakeup hint; replay authority is the journal »).

Commit préfixé `T043:` contenant tout ce qui précède et cette section.

---

## T044 — `notifications::store/vapid` + `files::atomic` (E08, C14)

Périmètre : `crates/files/src/atomic.rs` (+`lib.rs`), `crates/files/tests/unit/atomic.rs` (+`mod.rs`), `crates/notifications/src/{store,vapid}.rs` (+`lib.rs`), `crates/notifications/tests/unit/{store,vapid}.rs` (+`mod.rs` + `unit_tests.rs`). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `files::atomic::ecrit_atomique` | temp + flush (sync_all) + rename dans le MÊME répertoire ; répertoire parent créé 0700, fichier final 0600 (l'inode du temporaire survit au rename) ; panne à chaque étape → temporaire supprimé, ancien fichier intact (prouvé : rename sur un répertoire cible échoue, l'ancien contenu reste, aucun `.tmp` ne traîne). |
| `notifications::store` | La forme legacy EXACTE (`{subscriptions, vapidKeys}` camelCase, indenté) — clés et abonnements existants inchangés (test d'aller-retour + forme filaire vérifiée) ; fichier absent = store vide ; fichier corrompu = ERREUR visible (jamais de régénération silencieuse) ; `GardienDeStore` = écrivain sérialisé (E08), upsert par endpoint, désabonnement par endpoint. |
| `notifications::vapid` | `depuis_env` : paire partielle REFUSÉE, paire complète vérifiée par **équivalence** (la privée doit dériver la publique — une paire mélangée est refusée avant toute utilisation, TECH §7) ; génération persistée (env > store > génération) ; forme des clés Node : publique = point P-256 non compressé 65 octets, privée = scalaire 32 octets, base64url sans padding (vérifié). |
| `rapatrie_store` | Migration du store ENTIER (abonnements ET VAPID — les abonnements sont liés à la clé publique qui les a créés) ; nouveau store absent ou vide seulement ; nouveau peuplé = vérité intacte ; pas d'ancien store = installation neuve, pas une panne. |
| Dépendances | `jwt-simple` (déjà vendu par web-push, `pure-rust` sans défaut — le conflit de features avec web-push a été évité) + `base64` (déjà au workspace). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p files` | PASS — **18 tests** (12 + 6 atomic). |
| `cargo test -p notifications` | PASS — **18 tests** (14 store + 4 vapid). |
| `cargo clippy -p notifications -p files --all-targets` | zéro avertissement. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé : `notifications → files` était déjà l'arête TECH §2). |

### Décisions et honnêteté (notées, pas masquées)

0. **`jwt-simple` en `pure-rust`, sans défaut** : les features par défaut entrent en conflit avec l'usage de web-push (compile_error) — la même configuration que web-push lui-même, version alignée.
1. **La clé publique non compressée passe par le trait `ECDSAP256PublicKeyLike`** : `ES256PublicKey::to_bytes()` est la forme COMPRESSÉE (33 octets) — inutilisable pour VAPID ; le trait expose le point non compressé (65 octets, `0x04` en tête), vérifié par test.
2. **Divergence volontaire : un NOUVEAU store corrompu est une erreur visible** au rapatriement — le fil le traitait comme « non peuplé » et l'écrasait en silence. C'est exactement la régénération silencieuse que C14 interdit ; documenté dans le code et le test.
3. **`sync_all` est le « flush » honnête** : `File::flush` est un no-op pour un fichier — la durabilité réelle (octets sur disque avant le rename) passe par `sync_all`.
4. **La validation d'équivalence s'applique aux paires importées** (env ET store) : une paire du store mélangée est une erreur visible, jamais une régénération silencieuse qui invaliderait les abonnements.

Commit préfixé `T044:` contenant tout ce qui précède et cette section.

---

## T045 — `notifications::payload/delivery` (E07, E09, C14)

Périmètre : `crates/notifications/src/{payload,delivery,webpush}.rs` (+`lib.rs`), `crates/notifications/tests/unit/{payload,delivery}.rs` (+`mod.rs`). Aucun service réel contacté, aucun agent de l'utilisateur, aucun test sous `src/` — la livraison est testée contre un FAUX service.

### Livrables produits

| Livrable | Détail |
|---|---|
| `payload_de_notification` | E07 : trois profils distincts — `waiting`/`done`/`gone` (titres, corps, étiquettes) ; une question en attente n'est jamais remplacée par un « finished » ; un agent disparu n'a pas « fini » (cause jamais inventée) ; lien profond `/#/agent/<paneId encodé>` (`:` → `%3A`), accueil sans pane. |
| `nom_de_notification` | Qui, hors de l'écran : projet · onglet · pane · type — la place du pane vient de la MÊME fonction que l'écran (`domain::naming::pane_label`), libellé numérique → numéro d'onglet, libellé répétant le projet écarté, rien d'inventé. |
| `Livreur` | Le worker borné : **file 64** (refus compté, les chemins du veilleur continuent), **concurrence 4** (sémaphore, pic prouvé derrière une porte), **délai 15 s** par envoi (injectable pour les tests — un service muet est un échec compté, jamais une expiration), **TTL 60 s** posé sur chaque message. |
| `elague_versionne` | C14 : un endpoint expiré (404/410) n'est retiré que si l'abonnement COURANT est exactement celui qui a expiré (mêmes clés) — un **réabonnement pendant l'envoi** a une nouvelle version, il survit (prouvé : envoi retenu par une porte, réabonnement pendant, l'élagage retire 0). |
| **Aucune livraison sous lock du store** | Le worker livre sur une PHOTO (la porte du store n'est tenue que le temps d'une lecture), l'élagage ré-ouvre la porte APRÈS — un abonnement pendant un envoi passe sans attendre (prouvé). |
| `LivraisonWebPush` | L'implémentation réelle : `web-push` (feature `hyper-client`), clé privée brute base64url (les clés Node), 404/410 → `Expire`, tout le reste → `Autre` compté. Le futur est boxé pour rester dyn-compatible (pas de `async fn` dans le trait). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p notifications` | PASS — **35 tests** (18 + 9 delivery + 8 payload). |
| `cargo clippy -p notifications --all-targets` | zéro avertissement. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé). |

### Décisions et honnêteté (notées, pas masquées)

0. **`async fn` natif n'est pas dyn-compatible** : le trait `LivraisonPush` renvoie un futur boxé (`Pin<Box<dyn Future + Send>>`) — pas de dépendance `async-trait`.
1. **Les tests du worker exigent un runtime multi-thread** : `std::thread::sleep` dans `attend_envois` bloquait le runtime current-thread — le worker ne tournait jamais (« 0 vus »). Corrigé par `#[tokio::test(flavor = "multi_thread")]`.
2. **La file tient 64 EN ATTENTE** : le job en cours de traitement est hors file — 69 jobs = 1 en vol + 64 en file + 4 refus (mon premier test comptait 5). Et le démarrage du worker est une course : le test attend que le premier job soit EN VOL avant d'enfiler le reste.
3. **L'élagage versionné retire 0 quand la version a changé** : l'upsert du réabonnement a REMPLACÉ l'ancienne version — il n'y a rien à retirer, et c'est exactement la preuve demandée (« suppression ne retire pas un nouvel abonnement »).
4. **Le délai est un échec compté, pas une expiration** : un service muet ne fait pas retirer l'abonnement — la cause est réelle, jamais inventée.

Commit préfixé `T045:` contenant tout ce qui précède et cette section.

---

## T046 — `files::authorized_file` + `files::mime` (S05–S07)

Périmètre : `crates/files/src/{authorized_file,mime}.rs`, `confined.rs` (+`RacineAutorisee::brute`), `contracts/src/limits.rs` (+`MAX_FILE_BYTES`), tests `crates/files/tests/unit/{authorized_file,mime}.rs`. Aucun service réel, aucun agent, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `lit_fichier_autorise` | S05–S06 : racines **réévaluées à chaque demande** (le snapshot Herdr est la seule source — pas de racine globale, pas de Desktop/Downloads/Pictures implicites) ; résolution puis vérification (le `..` et le frère ne passent pas) ; racines résolues AUSSI (piège macOS `/var` → `/private/var`) ; contrôles sur le descripteur (régularité, taille ≤ 12 MiB) ; longueur servie = octets réellement lus. |
| `RacineAutorisee::brute` | Une racine du snapshot qui a disparu reste dans sa forme brute : elle ne sert rien, mais ne fait pas échouer la lecture des autres (le fil : `realpathSync` en `catch`). |
| `content_type_de` / `est_inline` | S07 : la liste blanche EXACTE du fil — images + pdf inline, textes en `text/plain; charset=utf-8`, **SVG jamais inline** (script possible → téléchargé), l'inconnu en octet-stream. |
| `ErreurFichier` + `describe_erreur_fichier` | Les raisons exactes du fil (`no authorized project`, `outside the project folders`, `symlink escaping the project folders`, `not a file`, `fichier trop gros (N Mo, maximum 12 Mo)`, `fichier introuvable`) — une cause réelle, jamais générique. |
| `contracts::limits::MAX_FILE_BYTES` | La valeur canonique (12 MiB), miroir de `packages/shared/src/limits.ts` ; `files` la porte aussi en local (le graphe interdit `files → contracts`) — même recours que `MAX_SESSION_READS`. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p files` | PASS — **35 tests** (18 + 10 authorized_file + 6 mime + 1). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé). |

### Décisions et honnêteté (notées, pas masquées)

0. **Le répertoire demandé directement** : le fil l'ouvre puis le refuse via `isFile()` ; ici l'ouverture relative d'un chemin vide échoue avant le fstat. La vérification porte sur le chemin résolu (`canonique` + `is_dir`), et le descripteur re-valide la régularité — la course (fichier remplacé entre les deux) reste fermée : un répertoire devenu fichier est servi, un fichier devenu répertoire est refusé par le fstat.
1. **Le type MIME suit le chemin RÉEL, pas l'extension d'appel** : un lien interne vers un `.png` sert un png — le nom aussi vient de la cible réelle (prouvé).
2. **La taille du fichier PNG de test** : `\x89PNG\r\n\x1a\n` + `contenu` = 15 octets, mon premier `assert` comptait 14 — corrigé par l'exécution.
3. **`MAX_FILE_BYTES` en double** (contrats + files) : le graphe l'impose ; la valeur canonique vit dans `contracts` (la source de vérité pour http-api en T052), le local de `files` est documenté comme miroir.

Commit préfixé `T046:` contenant tout ce qui précède et cette section.

---

## T047 — `files::scan` (S08, S09)

Périmètre : `crates/files/src/scan.rs` (+`lib.rs`), tests `crates/files/tests/unit/scan.rs` (+`mod.rs`). Aucun service réel, aucun agent, aucun test sous `src/` — balayage contre de vrais fichiers temporaires.

### Livrables produits

| Livrable | Détail |
|---|---|
| `liste_images_recentes` | S08 : png/jpg/jpeg/gif/webp/avif (SVG jamais — script possible), profondeur ≤ 3, plafond **global** 400 (C13 : le budget est partagé entre les racines, même concurrentes), 120 par dossier, **4 racines concurrentes**, tri par récence décroissant (stable — à modification égale, l'ordre du disque reste), limite de réponse (60 par défaut). |
| `CompteurDeBalayage` | Le **pic mesuré**, pas une opinion : `promene` compte les parcours en vol ; le test observe pic ∈ [2, 4] sur 4 racines × 120 fichiers — la concurrence est réelle ET bornée. |
| Exclusions (S09) | Entrées pointées (`.`) et dossiers de dépendances/build (`node_modules`, `dist`, `build`, `target`, `vendor`, `coverage`, `.next`, `.nuxt`, `.turbo`, `Pods`, `__pycache__`, `.venv`, `venv`) jamais parcourus — la liste exacte du fil. |
| Dégradation (S09) | Dossier illisible ou disparu : ignoré, le reste est servi ; AUCUNE notion de complétude n'apparaît — le type de retour est la liste, rien d'autre. |
| Liens suivis (S09) | `metadata` suit les liens : un lien vers un dossier est descendu, un lien vers une image est collecté. |
| Suffixe exact | `est_image` insensible à la casse, suffixe exact — `image.png.txt` n'est pas une image (le fil fait `endsWith`). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p files` | PASS — **46 tests** (35 + 11 scan). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé). |

### Décisions et honnêteté (notées, pas masquées)

0. **Le parcours est séquentiel, assumé, pas un oubli** : chaque `stat` conditionne la descente et l'ordre du disque remplit la collecte (le fil le commente mot pour mot) ; un `Promise.all`/spawn par fichier renommerait l'ordre et dépasserait les plafonds avant le court-circuit.
1. **Le plafond global est re-vérifié SOUS le verrou** au moment du dépôt : la course entre le contrôle « ai-je encore droit à un fichier » et le push reste fermée — c'est ce qui rend le comptage déterministe (3×120 + 40 = 400 exactement).
2. **Le pic mesuré atteint bien la borne** (3–4 avec 4 racines × 120 fichiers, sondé 5 fois) — le test exige pic ≥ 2 : la concurrence est prouvée réelle, pas seulement bornée par construction.
3. **Flakiness PRÉEXISTANTE de `herdr-client` sous charge parallèle** (découverte pendant cette tâche, pas causée par elle) : les tests de délai/EOF du transport échouent parfois en run workspace complet — prouvé en l'absence de mes changements (`git stash` : run 1 OK, run 2 échec sur un AUTRE test du même crate). Mécanisme identifié : le test de délai attend `DelaiDepasse` (serveur dort 300 ms, deadline 50 ms) mais un fil déschedulé > 300 ms sous charge trouve la réponse déjà en attente. Réduction du volume de mes propres tests scan (~2800 → ~1400 fichiers) pour ne pas amplifier la charge ; le correctif du test herdr-client est un chantier hors périmètre T047 (le journal ne la cache pas).
4. **`LIMITE_DEFAUT` = 60** exportée avec la signature `limite` explicite — le fil a `limit = 60` en défaut ; la route (T052) décidera.

Commit préfixé `T047:` contenant tout ce qui précède et cette section.

---

## T048 — `herdrchat::config` (C10, O02, matrice CURRENT §8)

Périmètre : `crates/herdrchat/src/{lib,config}.rs` (le crate devient lib+bin), `main.rs` réduit au stub, tests `crates/herdrchat/tests/unit/config.rs`. Aucun service réel contacté (la CLI Tailscale n'est JAMAIS lancée par les tests), aucun agent, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `Config` immuable | Les 17 variables de CURRENT §8, figées à la lecture ; `HERDR_SOCKET` (couche B) délibérément JAMAIS lue (D008/E5) ; HOME/PATH injectés — aucune bibliothèque ne lit l'environnement. |
| `config_depuis_avec` | La lecture + le lanceur Tailscale **injectés** : `config_depuis` monte le lanceur réel, les tests passent un stub — sans cela, `config_depuis` lançait la VRAIE CLI sur cette machine (Serve configuré) et le test des défauts voyait l'origine du tailnet réel. |
| Bind strict (C10) | Par défaut `[IP_ADDRESS]` (le loopback — le code du fil ; les docs écrivent « [IP_ADDRESS] » par convention) ; toute autre valeur est PARCÉE en `IpAddr` et doit tomber dans `[IP_ADDRESS]/10` ou `fd7a:115c:a1e0::/48` — le préfixe textuel du fil (« 100. » / « fd7a: ») est remplacé par les plages (un `[IP_ADDRESS]` est refusé, un `fd7a:9999::1` aussi) ; wildcard et adresses publiques jamais. |
| Port strict (C10) | `parse::<u16>` + ≥ 1 : « 8791abc », « 0 », « 65536 » refusés — pas d'`parseInt` permissif. |
| `origines_de_serve` | Pure et testée contre les fixtures RÉELLES du fil (relevé 2026-10-15 : notre backend sur 8790, `print-cost-report` sur 8765 — autoriser les deux élargirait la porte) ; port 443 omis de l'origine (le navigateur l'omet — le défaut qui mettait toute la PWA en 403) ; comparaison par hôte ET port, jamais par chaîne ; hôte local = `[IP_ADDRESS]`/`localhost`/`::1` ; relevé illisible → liste vide, jamais un arrêt. |
| `hote_url` | IPv6 entre crochets pour une URL analysable (`fd7a:…` seul donnerait `http://fd7a:…:8791` inanalysable). |
| CLI Tailscale | `resolve_tailscale_bin` : chemins absolus macOS/Linux (sous `systemd` le PATH est minimal — sans eux, aucune origine, toute la PWA en 403), PATH en dernier recours ; argv exact `serve status --json`, délai 5 s, processus tardif tué par `try_wait` ; absence/non-JSON → liste vide (confort, pas dépendance). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p herdrchat` | PASS — **15 tests**. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé — herdrchat reste au sommet). |

### Décisions et honnêteté (notées, pas masquées)

0. **Découverte d'investigation : l'affichage de mes outils redacte les adresses IP en « [IP_ADDRESS] ».** Une grande partie de la lecture initiale de `config.ts` était corrompue : le code réel utilise `[IP_ADDRESS]` comme bind par défaut et comme hôte loopback (vérifié par HEXDUMP des octets, pas par l'affichage). Les docs (CURRENT §8, baseline) écrivent « [IP_ADDRESS] » par convention. Le port Rust suit le CODE, pas l'affichage.
1. **Le quirk de `new URL` de bun** : selon l'environnement, `new URL("http://[IP_ADDRESS]:8791")` jette ou parse — les tests TS passent dans leur suite (l'import graph de config.ts charge un URL laxiste), mais un probe isolé jette. Le contrat EMPIRIQUE (23 tests verts) est porté tel quel : le placeholder est accepté, hôte + port exacts.
2. **`config_depuis` doit être injectable** : sans `config_depuis_avec`, le test des valeurs par défaut lançait la vraie CLI Tailscale et découvrait l'origine du tailnet RÉEL de cette machine — le test devenait dépendant de la machine. L'injection garde les tests hermétiques ; la production monte le lanceur réel.
3. **Le test « une autre machine ne suffit pas » du fil** repose sur le quirk de bun (URL sans barre finale qui jette dans certains environnements) : porté par l'INTENTION (un proxy vers un hôte non local est refusé), pas par le quirk.

Commit préfixé `T048:` contenant tout ce qui précède et cette section.

---

## T049 — `http-api::router/extractors/origin` (C08, C09)

Périmètre : `crates/http-api/src/{origin,router,corps}.rs`, `lib.rs`, tests `crates/http-api/tests/unit/{origin,router,corps}.rs`. Aucun service réel contacté, aucun agent, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `origin.rs` | La garde des mutations (S02), pure : **méthode** (405+`Allow: POST`), **origine** absente/étrangère (403, les DEUX origines dites — attendue | reçue), **Content-Type** non JSON (415), **taille déclarée** > 64 KiB (413, refusée avant lecture). `est_loopback` : `localhost`/`[IP_ADDRESS]`/`::1` tous ports confondus (le port change sans que la sécurité change), hôte extrait à la main (schéma casse libre, crochets, IPv6 brute écartée) — l'équivalent de `new URL(...).hostname` du fil. `est_autorisee` : liste EXACTE ou loopback, jamais de motif. `describe_refus` : la cause, jamais un refus muet. |
| `router.rs` | Le routeur axum : **lectures = GET + HEAD, mutations = POST** (C08 — le fil liait par chemin seulement, les lectures acceptaient tout). La garde court en couche sur les mutations, **méthode d'abord** (l'ordre du fil : un GET sans origine est un 405, pas un 403). 405 avec `Allow` (POST pour mutations, « GET, HEAD » pour lectures) et corps JSON `{error}`. Fallback : `/api/*` inconnu → **JSON 404** (C08 — le fil servait du HTML par accident) ; hors `/api` → 503 « PWA not built » honnête (T054 montera les assets). Les handlers sont des `fn(Request) -> Response` stubs — les vrais arrivent en T050+ (la politique ne change pas). |
| `corps.rs` | **C09 : la taille RÉELLE est tranchée à la lecture** — `lire_corps_borne` lit le flux et refuse 413 au-delà de 64 KiB même sans `Content-Length` (chunked) ou avec une déclaration mensongère. `CorpsBorne`, l'extracteur des handlers (T050+). `verifie_prompt` : prompt ≤ 32 KiB **octets UTF-8** (pas caractères — « é » × 20 000 = 40 KiB refusé). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p http-api` | PASS — **52 tests** (12 origin + 9 corps + 31 routeur). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (graphe inchangé). |

### Décisions et honnêteté (notées, pas masquées)

0. **La redaction d'affichage a de nouveau joué sur MES entrées** : des littéraux `[IP_ADDRESS]` ont été écrits dans les tests (octets réels) au lieu de `[IP_ADDRESS]`. Corrigé par remplacement binaire (codes hex, insensibles à la redaction) et VÉRIFIÉ par hexdump — le code compare `[IP_ADDRESS]`, les commentaires gardent la convention.
1. **Le 405 des lectures est une correction C08, pas le comportement du fil** : le fil liait par chemin sans carte de méthodes — un POST sur `/api/health` exécutait le handler. Le port impose GET/HEAD + 405 `Allow: GET, HEAD` (délibéré, listé dans le baseline).
2. **`fn(Request) -> Response` synchrone n'est pas un Handler axum** : enveloppé en closure async (`en_async`) — les vrais handlers (T050+) remplaceront les stubs par les mêmes enveloppes ou des handlers axum directs ; la politique de méthodes et le fallback ne bougent pas.
3. **La garde vérifie la taille DÉCLARÉE (413 avant lecture) ET la taille RÉELLE (413 à la lecture, C09)** : les deux existent, la première économise la mémoire, la seconde ferme le chunked.
4. **Une origine `[IP_ADDRESS]` sur un AUTRE port est loopback** (tous ports confondus, comme le fil) : mon premier test l'affirmait refusée — c'était faux, corrigé. La porte reste fermée : une page servie par la machine ne peut pas être un site tiers.

Commit préfixé `T049:` contenant tout ce qui précède et cette section.

## T050 — `http-api::handlers::health/overview/conversations/sessions` (H01–H04)

Périmètre : `crates/http-api/src/{services,convertir}.rs`, `crates/http-api/src/handlers/{sante,overview,conversations,session,mod}.rs`, `router.rs` (les stubs T049 remplacés pour H01–H04, politique et fallback inchangés), `crates/domain/src/{session,ports}.rs` (le port de session), tests `crates/http-api/tests/unit/{sante,overview,conversations,session,support}.rs` + `router.rs` réécrit. Aucun service réel contacté, aucun agent, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `domain::session` | `SessionPage.rattrape` (**C18** — vrai au seul watermark complet observé, présent sur le fil seulement quand vrai) ; `SessionPageOutcome` : `Absente(SessionPage)`/`Vide(SessionPage)` portent désormais le contexte de réponse (curseur, reset, incremental), `Invalide{detail}`/`Io{detail}` nommés. |
| `domain::ports` | `SessionFuture` : le port de session rend désormais des **`ErreurDomaine` typées** (pas des `PortError` de transport) — la carte H04 (400 curseurs / 403 chemin / 404 source / 409 périmé / 422 illisible / 502 io / 503 base manquante) se consomme sans re-décision. |
| `http-api::services` | `Services` : le monde du démon composé (snapshots, port de contrôle, conversations, résolution, port de session, socket, horloge injectée, uptime, journal) — l'assemblage réel arrive en T056 ; les tests composent des faux. |
| `handlers/sante.rs` (H01) | 200 `HealthResponse` (protocol/version/socket/log/uptimeMs) ; Herdr injoignable → **503 même schéma** `ok:false, reachable:false` ; ping résolu mais illisible → 500 nommé (`Unsupported`/`PathRejected`). |
| `handlers/overview.rs` (H02) | 200 vue composée via `ComposeurOverview` ; échec de snapshot → 500 `{error}`. |
| `handlers/conversations.rs` (H03) | 200 une ligne par pane visible (T039) ; pas de snapshot → **503 `{conversations:[]}`** ; snapshot illisible → 502 même forme vide — jamais une liste devinée. |
| `handlers/session.rs` (H04) | La cartographie pure : `tail` (entier positif plafonné 512 KiB, `0`/illisible → défaut, JAMAIS de `parseInt` permissif), `cursor`/`before` opaques portés tels quels, agent cherché dans le snapshot (404), `resolve` (404 `Ok(None)`), clauses → 200 (cause `vide` même non vide, vocabulaire mesuré) / 400 / 403 / 404 / 409 / 422 / 502 / 503, causes de lecture nommées (C04). |
| `router.rs` | H01–H04 branchés (GET+HEAD) ; les routes restantes répondent **501 nommé** — jamais un faux 200 — jusqu'à T051/T052/T053. La méthode (405+`Allow`), la garde et le fallback 404 JSON ne bougent pas. |
| Tests | **76 http-api** : 5 sante + 3 overview + 5 conversations + 16 session + 12 routeur (réécrit) ; `FauxSessionPort` scripté (résolutions/pages, dernière demande de page enregistrée), `FauxSessions` partagé, horloge injectée. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p http-api` | PASS — **76 tests**. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (2 passages consécutifs). |

### Décisions et honnêteté (notées, pas masquées)

0. **`sessionPath`/`session_id` du hint construits depuis le snapshot, jamais depuis Herdr** (D008) : le handler ne lit pas le fichier — il demande une page au port, et le port est composé en T056.
1. **L'échec « tests » d'une passe intermédiaire était un flake** — la flakiness transport `herdr-client` pré-existante (T047, prouvée indépendante) sous charge ; les deux passages suivants sont verts. Rien de nouveau introduit.
2. **Le `caughtUp` absent (null) quand `rattrape` est faux est mesuré, pas un choix** : C18 dit « présent seulement quand vrai » ; mon premier test l'assertait `false` — corrigé (le NULL JSON est la preuve de l'omission).
3. **`test-support` est un dev-dependency de http-api** : l'ajout dans `[dependencies]` a fait diverger le graphe (TECH §2 ne compte que les arêtes de production) — déplacé en `[dev-dependencies]`, le graphe est resté identique.
4. **Le 404 de session sans agent et le 404 de repli partagent le statut** : le test routeur prouve la route branchée par le CORPS (message H04 documenté), pas par le statut seul — sinon un repli « route inconnue » passerait pour un handler.
5. **Le port de session rend des `ErreurDomaine`** : `PortError` est l'erreur de TRANSPORT (Herdr) ; la lecture de session (fichier/base) a ses propres clauses — mélanger les deux aurait re-décidé la carte H04 au port.

Commit préfixé `T050:` contenant tout ce qui précède et cette section.

## T051 — `http-api::handlers::commands` (H05–H07, H10–H12 ; C03, C05–C07, C17)

Périmètre : `crates/http-api/src/handlers/{prompt,arret,lancement,reponse,focus,confiance,mod}.rs`, `services.rs` (les services de commande + leurs dépendances injectées), `router.rs` (six routes branchées, politique et fallback inchangés) ; `crates/interactions/src/confiance.rs` (répondeur + touches par famille), `crates/application/src/{types_installes.rs, commands/mod.rs, commands/prompt.rs}` ; `crates/test-support/src/fake_herdr.rs` (écrans et snapshots scriptés) ; tests `crates/http-api/tests/unit/{prompt,arret,lancement,reponse,focus,confiance,support,mod}.rs`, `crates/interactions/tests/unit/confiance.rs`, `crates/application/tests/unit/types_installes.rs`. Aucun service réel contacté, aucun agent, aucun test sous `src/`.

### Livrables produits

| Livrable | Détail |
|---|---|
| `handlers/prompt.rs` (H05) | Corps `{text}` (400 nommé, jamais un envoi à moitié décidé) ; **413 en octets UTF-8** sur le TEXTE, avant toute action ; mode `saisie` relu **depuis Herdr** (`lecture_forcee`) et non du client — une lecture de statut qui échoue ne bloque pas l'envoi, elle laisse `saisie=false` (comme le fil) ; 200 `PromptSentResponse` (confirmed/unknown), 200 **suppressed** sur doublon (aucune action rejouée), 502 `PromptFailedResponse` avec l'état **B05** décidé sur la NATURE de la panne (`attente` = délai, `inconnu` = transport muet, `erreur` = refus amont). |
| `handlers/arret.rs` (H06) | Décision sur photo fraîche (le moteur T036) ; 200 `interrupt-sent`, 200 `not-running` (agent au repos **ou** course « fini entre la photo et l'envoi »), 404 agent absent, 502 snapshot indisponible / illisible (causes **distinctes**) / transmission refusée. |
| `handlers/lancement.rs` (H07) | Corps `LaunchAgentRequest` (400 `kind` manquant) ; **la liste réellement installée** vérifiée AVANT tout onglet (C16) : 400 `agent type not installed: “x”` + indice des types offerts, 503 découverte en panne **avec sa cause** ; 201 `LaunchAgentResponse` (onglet puis agent), **409 `TrustRequiredResponse`** quand l'agent est bloqué sur l'invite (aucune touche envoyée), 502 pour validation/onglet/agent/ambigu (l'onglet gardé est dit). |
| `handlers/reponse.rs` (H10) | Corps `{numero, texte?}` (400 nommé) ; 200 `QuestionAnsweredResponse` avec les trois états (`appliquee | transmise | refusee`) — un refus est une **valeur**, et rien n'est envoyé hors des choix offerts ; 502 échec Herdr. |
| `handlers/focus.rs` (H11) | 200 `{focused, status}` — **l'échec Herdr reste une valeur** (`focused:false`), la ligne de journal porte le verdict. |
| `handlers/confiance.rs` (H12) | Corps `{accept}` (400 nommé) ; la **famille** vient de Herdr (jamais du client) ; 200 `TrustResolvedResponse` **avec `state`** (C03 — le fil l'omettait, la validation de contrat rendait 500 pour tout résultat) ; 502 échec Herdr. |
| `interactions::confiance` | `touches_de_confiance` par famille **mesurée** (claude : `down,enter` / `enter` ; codex : `1,enter` / `2` ; toute autre : **aucune** touche) et `repondre_confiance` : lire avant, refuser une famille inconnue, relire après, **et exiger que l'agent soit encore vivant** (une invite disparue sur un agent mort ne prouve rien). |
| `application::types_installes` | La politique, une seule fois : `TypeInstalle::kind` (la commande si elle est au vocabulaire connu, sinon la cible), `types_lancables` (installé **ET** lisible — `cursor` est écarté), `verifie_type` → `RefusType::{Decouverte, Inconnu}`. Le menu (T052/H08) lira la même liste. |
| `test-support` | `scripte_ecrans` (file d'écrans, le dernier se répète) et `scripte_snapshots` (file partagée par `snapshot` et `list_agents`) — les scénarios « invite avant / disparue après » et « l'agent disparaît entre la lecture et la preuve » s'écrivent sans état dans le test. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p http-api` | PASS — **121 tests** (dont 28 nouveaux : 12 prompt, 7 arret, 7 lancement, 7 reponse, 3 focus, 9 confiance, 1 routeur réécrit). |
| `cargo test -p interactions` | PASS — **25 tests** (7 nouveaux sur le répondeur). |
| `cargo test -p application` | PASS — **132 tests** (6 nouveaux sur les types lançables). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (2 passages). |

### Décisions et honnêteté (notées, pas masquées)

0. **`RefusEnvoi::NonConfirme` porte désormais sa `cause: PortError`** : l'état B05 se décide sur la **nature** de la panne, jamais en relisant une phrase. Le fil devinait sur le texte (`timeout`, `econnrefused`…) — un message réécrit aurait changé le statut affiché. Le `Display` et la forme restent compatibles (les tests T035 matchent avec `..`).
1. **Le 404 d'arrêt ne peut pas interpoler le paneId** : le port retire les identifiants internes de tout message destiné à l'écran (`supprime_identifiants`, la règle de `describe()`), et l'interpolation produisait « no Herdr agent in pane le nouvel onglet ». Le message devient « no Herdr agent in this pane » — vrai, sans identifiant mangé ; le client sait quel pane il a demandé. **Écart assumé** avec le texte du fil, noté ici.
2. **Le 409 de confiance nomme le dossier par le libellé du projet** (`pixel`), exactement comme le fil (`folderLabel`) — pas le chemin interne. Mon premier test attendait `/projets/atelier` : c'était mon erreur, corrigée.
3. **Les touches de codex à l'acceptation sont `1` puis `enter`** (le fil) : `1` sélectionne, `enter` valide. J'avais d'abord écrit `1` seul — corrigé sur le code du fil, pas sur une intuition.
4. **La file d'admission (T034) n'est PAS branchée sur ces routes** : aucune réponse de surcharge n'est prévue au baseline/CURRENT pour H05–H12, et en inventer une (503) créerait une capacité non listée. Le service existe et reste composable ; le branchement viendra avec une entrée de correction explicite. **Ce n'est pas un oubli, c'est un report nommé.**
5. **`provider` du corps de lancement n'est pas consommé** (mesuré : il ne l'a jamais été) — il n'est ni rejeté ni présenté comme appliqué ; la réponse ne le mentionne pas.
6. **La famille d'agent lue par `lecture_forcee` peut manquer** (agent absent ou snapshot illisible) : le répondeur refuse alors **toute** touche (`non-applicable`) — surtout pas un repli codex, le défaut mesuré qui faisait SORTIR l'agent claude.
7. **Le contrat `TrustResolvedResponse` n'a pas de `detail`** (contrairement au retour interne du fil) : mes tests l'assertaient — c'est le contrat partagé qui fait foi, assertions corrigées.
8. **`types_installes` duplique le vocabulaire de 25 commandes du fil** : c'est la politique du lancement (C16), pas une liste d'invitation — un type absent du vocabulaire prend sa cible comme `kind`. Le filtre de lisibilité, lui, est **réutilisé** (`visibilite::type_lisible`), pas recopié.

Commit préfixé `T051:` contenant tout ce qui précède et cette section.

## T052 — `http-api::handlers::catalog/files/push/log` (H08–H09, H13, H15–H18)

Périmètre : `crates/http-api/src/handlers/{catalogues,journal_client,push,fichiers}.rs`, `services.rs` (catalogue, artefacts, notifications, racines médias), `router.rs` (sept routes branchées ; `/api/events` seul reste en 501) ; `crates/domain/src/ports.rs` (contrats des ports artefacts/notifications) ; `crates/test-support/src/push_sink.rs` (clef fallible, abonnements capturés) ; tests `crates/http-api/tests/unit/{catalogues,journal_client,push,fichiers,support,router,mod}.rs`, `crates/test-support/tests/unit/push_sink.rs`. Aucun service réel contacté, aucun fichier de l'utilisateur lu (les faux rendent le corps), aucun agent.

### Livrables produits

| Livrable | Détail |
|---|---|
| `handlers/catalogues.rs` (H08) | 200 `InstalledKindsResponse` depuis la **même liste que le lancement** (C16 : `types_lancables`) — `cursor` installé mais illisible n'y est pas, `gemini` absent non plus ; 502 nommé quand la découverte échoue, **avec la cause réelle** (jamais une liste vide présentée comme vraie). |
| `handlers/catalogues.rs` (H09) | 200 `ModelCatalogResponse` ; **aucune branche non-200** (CURRENT §2) : un type sans mécanisme de listage et une panne du port sont des **valeurs** du 200 (`error` nommé, `models` vide). `error` est nullable **obligatoire** — présent, souvent null. |
| `handlers/journal_client.rs` (H13) | 200 `{ok:true}` ; 400 `{ok:false}` pour un corps sans `message` ou un niveau ≠ `error` (le fil ne connaît qu'un niveau) ; **jamais 500** — un journal en panne ne casse pas l'écran qui signale une panne. |
| `handlers/push.rs` (H15) | 200 **texte brut** `text/plain; charset=utf-8` + `no-store` ; 503 texte brut quand le service est **absent** ou sans clé ; 500 JSON quand la **résolution** échoue (panne de magasin ≠ capacité absente). La clé **privée** n'apparaît dans aucun corps ni journal (message = cause seule). |
| `handlers/push.rs` (H16) | 204 **sans corps** + `no-store` (jamais un `{ok}` inventé) ; **désabonnement prioritaire** quand les deux formes sont reçues (précédence mesurée) ; 400 endpoint non `https://` ou corps incomplet ; 503 service absent ; 500 écriture/lecture ratée. |
| `handlers/fichiers.rs` (H17) | 200 avec `content-type` mesuré, `content-disposition` (`inline` si la liste blanche l'autorise, **`attachment` sinon** — SVG jamais rendu), `content-length` = octets réellement servis, `no-store` ; 403 nommé (paramètre absent/vide, refus du port avec **sa raison**, snapshot illisible ⇒ aucune racine autorisée). |
| `handlers/fichiers.rs` (H18) | 200 `RecentImagesResponse` ; 502 nommé sur balayage ou snapshot en panne. |
| Ports du domaine | `AuthorizedFileRequest { roots, requested }` — le chemin voulu **et** les racines voyagent ensemble (la résolution puis le contrôle d'appartenance restent dans le port, S03/S04) ; `ArtifactBody.inline` (la politique d'affichage vient de la couche qui mesure le type) ; `NotificationPort` gagne `subscribe`/`unsubscribe` et une clef **fallible** (`PortFuture<Option<…>>`) — une panne de magasin n'est pas « pas de clef ». |
| `test-support` | `PuitsPushFaux` : panne de résolution, panne d'abonnement, endpoints abonnés/désabonnés capturés. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p http-api` | PASS — **152 tests** (dont 31 nouveaux : 5 catalogues, 5 journal client, 9 push, 11 fichiers, 1 routeur réécrit). |
| `cargo test -p test-support` | PASS — **28 tests** (2 nouveaux : panne de résolution ≠ absence, abonnements capturés). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (2 passages). |

### Décisions et honnêteté (notées, pas masquées)

0. **La liste de H08 est littéralement celle du lancement** : `types_installes::types_lancables` est appelée par les deux handlers. Une seconde liste aurait divergé — c'est exactement le défaut B07 (menu proposant ce que le lancement refuse).
1. **`ArtifactPort` change de forme** (`roots` + `requested` au lieu de `root` + `relative_path`) : l'ancienne forme obligeait le handler à découper lui-même le chemin, c'est-à-dire à réécrire la garde S03/S04 hors de la crate qui la possède. Aucun autre utilisateur du port n'existait.
2. **`vapid_public_key` devient fallible** : le fil a trois issues (200 / 503 capacité absente / 500 panne de setup) ; un `Option` seul ne peut pas distinguer « pas de clé » de « magasin illisible » — les confondre aurait affiché une capacité absente là où il y a une panne réparable.
3. **H09 n'a pas de 502** : le contrat du fil le dit explicitement. Le réflexe « panne ⇒ 502 » aurait introduit un statut que le baseline ne liste pas ; la panne est donc **dans le corps du 200**, nommée.
4. **Le niveau de journal ≠ `error` est un 400** : le fil décode `level: "error"` littéral. Accepter d'autres niveaux serait une capacité nouvelle, pas un portage.
5. **`expirationTime` n'est pas transmis au port** : `BrowserSubscription` du domaine ne le porte pas (mesuré : le store ne le conserve pas non plus). Il est **décodé puis ignoré explicitement** — pas silencieusement perdu dans un `serde(flatten)`, et pas présenté comme appliqué.
6. **H17 sans branche 500 documentée** : le fil a un 500 « résultat interne illisible » que le port ne peut pas produire (il rend `Ok(ArtifactBody)` ou `Err`). Je ne l'ai pas inventé : toutes les issues du port ont un statut du baseline (200/403).
7. **`requete_get` refuse un corps non JSON, exprès** : deux tests l'ont révélé (clef VAPID en texte, corps de fichier). Un helper brut (`get_brut`) a été ajouté plutôt que de rendre le décodeur tolérant — un JSON illisible doit se voir.

Commit préfixé `T052:` contenant tout ce qui précède et cette section.

## T053 — `http-api::handlers::events` (H14 ; C11, C26)

Périmètre : `crates/http-api/src/{publication.rs, handlers/events.rs, services.rs, router.rs}` (le flux branché, plus AUCUN 501 dans le routeur) ; `crates/contracts/src/events.rs` (l'événement `session_changed`, **ajouté**) ; `crates/application/src/events/{watcher,journal,subscription}.rs` (matière de la source + rattrapage par séquence + compte des abonnements vivants) ; publications dans `handlers/{prompt,lancement}.rs` ; tests `crates/http-api/tests/unit/{events,support,router,mod}.rs`, `crates/application/tests/unit/events/{watcher,journal}.rs`. Aucun service réel contacté, aucun agent, aucun fichier de l'utilisateur.

### Livrables produits

| Livrable | Détail |
|---|---|
| `handlers/events.rs` (H14) | 200 `text/event-stream` + `no-cache`, keep-alive 15 s ; `ready` **sans identifiant** à l'ouverture (`{cursor}` = frontière) ; `last-event-id` rejoue **exactement** ce qui a été manqué ; continuité rompue (journal tronqué, autre époque, curseur legacy numérique) ⇒ **un seul** `resync` avec le curseur de reprise du journal ; **pas de `Last-Event-ID` = pas d'historique** (C11) ; 9e flux ⇒ **503** nommé. |
| Le travailleur du flux | Un `spawn_blocking` possède l'`Abonnement` et pousse dans une file **bornée** (64) ; la réponse est asynchrone (`unfold` sur le récepteur). Après un battement muet, il **relit le journal** depuis la dernière séquence émise : une file pleine ne perd rien (la sonnette n'est qu'une porte). Il s'arrête dès que la réponse tombe (`is_closed`) — donc **la coupure rend le permis**. |
| `publication.rs` | Le pont application → **charges du contrat** → journal : `agent_status` (from null = apparition, `to:"gone"` = disparition), **`session_changed`** si et seulement si la source a changé, `prompt` (confirmation = **preuve**, jamais intention), `prompt-suppressed` (motif mesuré), `agent-launched`. Une fonction par genre : deux publications ne peuvent pas diverger. |
| `contracts::events::SessionChanged` | **Événement ajouté (C26)**, jamais mesuré sur le fil : `{paneId, path}` — `path` nullable (source disparue). Nom `session_changed` (soulignement, comme `agent_status` ; le `rename_all` aurait donné un trait d'union). |
| `application::events::watcher` | `Changement.source_avant/source_apres` + `source_change()` : la matière vient des **observations de source** (le chemin publié par Herdr), jamais d'une lecture de messages — Herdr n'expose aucun compteur. |
| `application::events::journal/subscription` | `Journal::depuis_sequence(n)` et `Abonnement::rattrapage_apres(n)` (relire après un battement muet sans reconstruire un curseur opaque) ; `nb_abonnes()` ne compte que les **vivants** (drapeau du Drop). |
| Publications dans les commandes | H05 publie `prompt` (avec sa preuve) et `prompt-suppressed` ; H07 publie `agent-launched` avec son projet. Un journal plein ne défait pas l'action : l'échec est rendu, l'appelant l'ignore **explicitement**. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p http-api` | PASS — **160 tests** (dont 8 SSE + 1 routeur réécrit). |
| `cargo test -p application` | PASS — **137 tests** (4 sur la source, 1 sur le rattrapage par séquence). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (2 passages). |

### Décisions et honnêteté (notées, pas masquées)

0. **Le travailleur bloquant ne voyait pas partir le client** (journal muet = boucle d'attente infinie). Deux tests ont *paru* se figer alors qu'ils passaient : le runtime attend les tâches bloquantes avant de rendre la main. Corrigé par `emetteur.is_closed()` à chaque tour — **et c'est ce qui rend vrai le test de coupure**, pas un délai de grâce.
1. **`nb_abonnes` comptait les abonnements fermés** jusqu'à la publication suivante : un compte faux pendant une fenêtre. Il filtre maintenant sur le drapeau (le `Drop` le pose immédiatement), et c'est le contrat que le test de coupure vérifie.
2. **Le battement du flux est injectable** (`Services::battement_flux`, défaut 15 s, 20 ms en test) : sans cela, chaque test laissait un fil bloqué 15 s derrière lui — et la suite devenait lente par accident.
3. **`session_changed` n'est pas dans le fil** : c'est un AJOUT (C26), documenté comme tel dans le contrat et le module. Sa forme (`{paneId, path}`) est la plus petite qui permette au client d'invalider — pas de `from`, pas de compteur inventé.
4. **`agent_status`/`session_changed` sont construits ici mais PUBLIÉS par la composition du veilleur** (T056, hors de ce crate) : `publication::evenements_de_changement` est la fonction unique, testée ; les trois autres genres sont publiés dès maintenant par les handlers H05/H07.
5. **Pas de heartbeat comme événement nommé** : le client EventSource n'en a pas besoin, et axum écrit le commentaire `:` — un faux événement serait du bruit à décoder.
6. **Le 9e flux est refusé avec sa cause** (« trop de flux ouverts (maximum 8) »), jamais une attente silencieuse.
7. **`publie` rend son `ErreurJournal`** (clippy refusait `Result<_, ()>`) : l'échec est nommé, l'appelant choisit de l'ignorer — les handlers écrivent `let _ =` en le documentant.

Commit préfixé `T053:` contenant tout ce qui précède et cette section.

## T054 — `herdrchat::assets` + `http-api::assets` (O05–O07)

Périmètre : `crates/http-api/src/assets.rs` (+ `services.rs`, `router.rs` : le repli passe aux assets), `crates/herdrchat/{build.rs, src/assets.rs, src/lib.rs}`, tests `crates/http-api/tests/unit/{assets,support,router,mod}.rs`, `crates/herdrchat/tests/unit/assets.rs`. Aucun fichier de l'utilisateur lu par un test (le fournisseur de test porte ses octets), aucun service réel.

### Livrables produits

| Livrable | Détail |
|---|---|
| `http-api::assets` | La **politique** de service : `normalise` (décodage `%XX` **avant** normalisation, `..` refusé au-delà de la racine, encodage invalide ⇒ pas un asset), `content_type_asset` (table par extension, inconnu ⇒ `application/octet-stream`), `est_volatil` (index/`sw.js`/`push-sw.js`/manifest ⇒ `no-cache, no-store, must-revalidate`), `reponse_asset` (fichier → index SPA → **503 « PWA not built »** avec son indice), `statique` (le repli du routeur : `/api/*` inconnu reste un **JSON 404**, tout le reste va aux assets). |
| `FournisseurAssets` | Le trait : `fichier(chemin)` / `index()` → des **octets**, jamais un chemin disque. `SansAssets` = le binaire sans build (503 dit). |
| `herdrchat::build.rs` | Embarque `apps/web/dist` au link (`include_bytes!` générés dans `OUT_DIR`) ; **refuse un build de publication sans PWA** (profil release, ou `HERDRCHAT_REQUIRE_PWA=1` — la variable existe pour *prouver* que la porte échoue). Rerun si le build change. |
| `herdrchat::assets` | `AssetsEmbarques` : la table générée, recherche linéaire, **aucune lecture disque à l'exécution** — donc indépendance au cwd (O05) et confinement par construction (O06 : un chemin absent de la table n'a pas d'octets). |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p http-api` | PASS — **172 tests** (12 nouveaux sur les assets + repli réécrit). |
| `cargo test -p herdrchat` | PASS — **20 tests** (5 nouveaux sur le fournisseur). |
| `HERDRCHAT_REQUIRE_PWA=1 cargo build -p herdrchat` | **ÉCHEC attendu** : « le build de publication exige la PWA compilée (…absent) » — la porte est prouvée capable d'échouer. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (2 passages). |

### Décisions et honnêteté (notées, pas masquées)

0. **Le confinement change de nature, et c'est un gain** : le fil résolvait des chemins disque (`realpath`, comparaison par segments) parce que le build vivait à côté de sa source. Ici il n'y a **aucun chemin disque à l'exécution** — la table embarquée EST la surface. Les tests prouvent quand même la garde sur l'entrée hostile (`..`, `%2e%2e%2f`, `%` isolé), parce qu'un chemin d'URL reste une entrée non fiable.
1. **Pas de dépendance `include_dir`** : `build.rs` génère un module `FICHIERS: &[(&str, &[u8])]` avec `include_bytes!` — même résultat, et le générateur est lisible (donc vérifiable) plutôt qu'une boîte noire.
2. **`mod assets_pwa { include!(...) }` et non `mod assets_pwa;`** : `rustfmt` cherchait `src/assets_pwa.rs` (le `#[path]` vers `OUT_DIR` le déroute). L'`include!` garde le code généré hors de `src/`.
3. **Le garde-fou de publication a une variable dédiée** (`HERDRCHAT_REQUIRE_PWA=1`) : un `cargo build --release` complet prendrait des minutes pour prouver une ligne de `build.rs`. La porte est testée pour de vrai — pas seulement affirmée.
4. **Le repli `/api` ne sert jamais de HTML** : la branche JSON 404 (C08) est vérifiée alors même que des assets existent — c'est le piège que le test couvre.
5. **Le MIME vit dans `http-api`**, pas dans le fournisseur : la fourniture ne porte que des octets, donc la politique de type et de cache est une seule fois, testée, et ne peut pas diverger entre le vrai build et un faux.

Commit préfixé `T054:` contenant tout ce qui précède et cette section.

## T055 — `herdrchat::logging` + `application::diagnostics` (S10–S13)

Périmètre : `crates/application/src/diagnostics.rs`, `crates/herdrchat/src/logging.rs`, `crates/http-api/src/{services.rs, handlers/journal_client.rs}` (H13 branché sur le puits), tests `crates/application/tests/unit/diagnostics.rs`, `crates/herdrchat/tests/unit/logging.rs`, `crates/http-api/tests/unit/support.rs`. Aucun test n'écrit dans le journal de l'utilisateur (dossier temporaire unique par test), aucun service réel.

### Livrables produits

| Livrable | Détail |
|---|---|
| `application::diagnostics` | La **politique**, sans I/O : `Niveau` (libellés `ERROR|WARN|INFO`), `EntreeDiagnostic` (+ `cle()` = chemin\|source\|niveau\|message, **sans le détail**), `ligne_de` (`ISO [LEVEL] [source] message \| detail`), `iso_8601` (calendrier civil calculé — zéro dépendance, testé sur 1970, une bissextile et le réveillon), `tronque` **en caractères** (2000, aucun accent coupé), `AntiRepetition` (fenêtre **glissante** de 60 s, compte des répétitions supprimées, remis à zéro après annonce), `MemoireAntiRepetition` (par **chemin** : deux instances ne se masquent pas), `SinkDiagnostic` (rend `()` — un journal ne peut pas changer l'issue d'une commande), `SinkMuet`. |
| `herdrchat::logging` | Le journal réel : dossier créé en 0700, fichier en 0600, **rotation à 4 MiB** vers `.1` (une génération, la plus ancienne écrasée), écriture `append` + flush, **horloge injectable** (la fenêtre se teste sans dormir), compteurs `ecrites()`/`supprimees()`. Toute panne d'écriture part sur `stderr` et s'arrête — elle ne remonte jamais. `journal_par_defaut(dossier_maison)` = `~/.herdr-remote/herdr-remote.log` (jamais le cwd, A03). |
| H13 branché | `Services::diagnostics` reçoit les remontées du navigateur (`source: "client"`), en plus de la trace console. Le corps accepte `error` seul ; le détail est **déjà sérialisé** par le handler (le contrat `detail: unknown` reste inconnu du domaine). |
| Rédaction (S13) | La ligne passe par `supprime_identifiants` : le journal parle de « le nouvel onglet », pas de `w1:p2`. Même règle que les messages d'erreur du fil — une seule fonction, dans le domaine. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p application` | PASS — **147 tests** (10 nouveaux sur les diagnostics). |
| `cargo test -p herdrchat` | PASS — **27 tests** (7 nouveaux sur le journal réel). |
| `cargo test -p http-api` | PASS — **172 tests** (H13 branché, aucun comportement de route changé). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (2 passages). |

### Décisions et honnêteté (notées, pas masquées)

0. **`iso_8601` est calculé, pas emprunté** : le calendrier civil (Hinnant) tient en quinze lignes, se teste exactement, et évite une dépendance d'horodatage pour un seul format. Trois ancres le vérifient (époque, 29 février, 31 décembre 23:59:59).
1. **La fenêtre d'anti-répétition est GLISSANTE** (chaque répétition repousse l'échéance) : c'est le comportement du fil, et c'est le bon — une erreur qui continue reste silencieuse, une erreur qui revient après une accalmie réapparaît.
2. **Le compte des répétitions est ANNONCÉ** avec l'écriture suivante (`— 3 repetitions supprimees`) : S12/TASKS demande un compteur, et un journal qui cache 300 occurrences sans le dire mentirait sur la fréquence.
3. **Le détail n'entre pas dans la clé de déduplication** : deux piles d'appels différentes du même message sont la même erreur qui se répète ; les compter séparément rendrait la suppression inutile.
4. **L'anti-répétition est par chemin** : deux instances (ou deux tests parallèles) ne se masquent pas — c'était le défaut d'une table globale, et il aurait rendu les tests dépendants les uns des autres.
5. **Le test de rotation écrit 4 MiB dans un dossier temporaire** (et le supprime) : c'est le seul moyen de prouver la rotation, et il ne touche à rien de l'utilisateur.
6. **Le chemin impraticable est testé** (parent = fichier) : le journal ne lève pas, n'écrit rien, et le compte `ecrites()` reste à zéro — la preuve que l'échec est avalé sans devenir un succès trompeur.

Commit préfixé `T055:` contenant tout ce qui précède et cette section.

## T056 — `herdrchat::main/composition/cycle` (O01–O04)

Périmètre : `crates/herdrchat/src/{cycle.rs, composition.rs, main.rs}`, `crates/application/src/{refresh,conversations}.rs` (les services prennent des `Arc` — une seule instance partagée), `crates/application/src/lib.rs` (`ports` réexportés pour l'assembleur), tests `crates/herdrchat/tests/unit/{cycle,composition,mod}.rs`. Aucun agent lancé, aucun service réel : sockets loopback et faux ports.

### Livrables produits

| Livrable | Détail |
|---|---|
| `cycle::Arret` / `Declencheur` | Un `watch` partagé : tous les composants voient le MÊME signal, un second signal ne casse rien, un arrêt déjà demandé ne bloque pas. |
| `cycle::sert` | Sert le routeur ; à l'arrêt : **admission fermée** (graceful shutdown), **drain borné** (10 s, injectable), puis **flush** (une ligne de diagnostic) et fermeture. Rend un `RapportArret { drain_interrompu, requetes_coupees, taches_vivantes }` — l'**issue partielle est tracée** (Warn nommé avec le compte), jamais un silence. |
| `cycle::ecoute` | Le bind est fait AVANT d'annoncer le démarrage : port occupé ⇒ `ErreurDemarrage::Bind { adresse, detail }` (adresse et cause système conservées). |
| `cycle::{EnCours, Taches}` | Compteur de requêtes en vol (l'issue partielle) et compteur de tâches de fond avec garde RAII — `vivantes()` à zéro est la preuve qu'aucun worker ne survit. |
| `cycle::signaux` | `SIGINT` **et** `SIGTERM` (systemd/launchd) ; si `SIGTERM` est indisponible, on le dit et Ctrl+C reste actif (aucun `unwrap`). |
| `composition::Ports` + `services` | Les cinq ports (contrôle, sessions, catalogue, artefacts, notifications) + résolution/lecture des conversations + types lançables + branche git + validation d'args entrent ; les `Services` du routeur sortent, avec le socket et les chemins **de la configuration**. Aucun substitut fabriqué : `notifications: None` reste une capacité absente. |
| `main.rs` | Compose config → cycle ; **refuse de démarrer** tant que les adaptateurs ne sont pas composés : `ports non composés : control (herdr-client), sessions (sessions), catalog (catalog), artifacts (files), notifications (notifications) — le démon refuse de démarrer à moitié` (exit 1). Un `main` qui « marcherait » sans adaptateur serait le mensonge le plus coûteux de la migration. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `cargo test -p herdrchat` | PASS — **37 tests** (8 cycle + 2 composition + 7 journal + 5 assets + 15 config). |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (2 passages). |
| `./target/debug/herdrchat` (HOME vide) | **exit 1** avec la liste exacte des ports manquants — vérifié à la main, sans socket ni journal créés. |

### Décisions et honnêteté (notées, pas masquées)

0. **Le démon ne démarre pas à moitié, et le dit.** Les adaptateurs des ports (T028–T033) sont encore ouverts : `main` s'arrête avec la liste exacte de ce qui manque. Le cycle et la composition sont, eux, complets et testés — dès que les adaptateurs existent, `main` les branche sans réécriture.
1. **`ServiceSnapshots`/`ServiceConversations` prennent des `Arc`, pas des `Box`** : une seule instance de port partagée entre le routeur et les services (TECH §4). Deux boîtes auraient interdit l'assemblage — c'est le changement minimal qui rend la composition possible.
2. **`herdrchat` ne dépend PAS de `domain` en production** (graphe TECH §2) : les types de port sont nommés via `application::ports` (réexport documenté). Les tests, eux, déclarent `domain` en **dev-dependency** — une arête de dev ne crée pas de dépendance de production (la porte de graphe l'ignore, comme pour `test-support`).
3. **Le drain est borné et l'issue est un COMPTE** : un flux SSE ouvert ne doit pas empêcher l'arrêt, et une commande coupée doit être dite. Le test le prouve (drain 150 ms, requête de 1 s ⇒ `drain_interrompu: true`, `requetes_coupees: 1`, ligne Warn).
4. **Trouvaille mesurée** : après le délai, larguer le futur d'`axum::serve` ferme l'écoute mais **ne tue pas** les tâches de connexion déjà lancées — elles finissent leur propre délai. C'est acceptable ici (le processus sort ensuite, l'OS ferme les sockets), et c'est écrit au journal plutôt que masqué par un test complaisant.
5. **Aucun agent n'est tué ni fermé** (O04) : le test de cycle utilise un `HerdrFaux` dont le journal d'actions reste **vide** après l'arrêt.
6. **Le test de déconnexion** se connecte puis part sans requête complète : le serveur répond encore, l'arrêt reste propre — le cas « request disconnect » du fil.

Commit préfixé `T056:` contenant tout ce qui précède et cette section.

## T057 (tranche A) — la façade de contrat générée (C01, C18, C26)

Périmètre : `scripts/contracts-schemas.ts` (nouveau), `xtask/src/contracts.rs` (6ᵉ document généré), `crates/contracts/src/schema.rs` (`SessionChanged` nommée), `packages/shared/generated/schemas.ts` (généré), `packages/shared/src/api.ts` (`caughtUp`, `SessionChanged`), `packages/shared/tests/contrat-genere.test.ts` (nouveau). Aucun service réel, aucun agent.

### Livrables produits

| Livrable | Détail |
|---|---|
| `scripts/contracts-schemas.ts` | Le générateur **JSON Schema → schemas Effect**. Formes reconnues (mesurées sur le bundle) : `$ref`, `enum`, `const`, `oneOf` de littéraux **et** unions de formes (l'enveloppe SSE), `anyOf` + nullabilité, tableau, objet (requis/omissibles), schéma booléen (`true` → `Unknown`, `false` → `Never`). **Toute autre forme lève avec le nom du schéma et de la clé** — un générateur qui saute en silence produirait un client plus permissif que le serveur. |
| `xtask contracts export/check` | Le fichier `schemas.ts` entre dans l'ensemble **fermé** des six documents : généré deux fois, comparé octet pour octet, puis comparé au dépôt. Une modification de DTO sans régénération échoue. |
| `packages/shared/generated/schemas.ts` | 61 définitions, noms triés, déterministe. `EvenementSse` est une **union de formes** `{event, data}` (les six genres), pas une union de littéraux : le client décode la même enveloppe que le serveur émet. |
| `api.ts` (ajouts mesurés) | `SessionResponse.caughtUp` (**C18**, omissible) et `SessionChanged` (**C26**, `{paneId, path nullable}`) — les deux côtés du contrat les portent maintenant. |
| `contrat-genere.test.ts` | **Parité** : pour 7 DTO représentatifs (santé, erreur, session, question, conversations, catalogue, confiance), la façade générée et les schemas manuels rendent le **même verdict** (accepté/refusé) et la **même valeur**. Plus : `session_changed` décodé, les six genres d'enveloppe SSE acceptés, un genre inconnu refusé, **et la couverture du basculement** : chaque DTO du client existe dans la façade (sous son nom ou son alias), les alias pointent des définitions réelles, et la liste `HORS_CONTRAT` nomme les types qui ne sont pas des DTO de notre HTTP. |

### Commandes et résultats

| Commande | Résultat |
|---|---|
| `bun test packages/shared/tests/contrat-genere.test.ts` | PASS — **12 tests**. |
| `bun test` (racine) | PASS — **1092 tests** (+12). |
| `cargo xtask contracts check` | PASS — corpus JS 214 échantillons « acceptés/refusés comme serde », **et** `schemas.ts` identique entre deux passes et au dépôt. |
| `cargo run --locked -p xtask -- verify` | **5 portes vertes** (3 passages). |

### Décisions et honnêteté (notées, pas masquées)

0. **Ce n'est PAS le basculement complet de T057.** La façade générée existe, est déterministe, et sa parité avec les schemas manuels est **prouvée** ; `api.ts` reste l'autorité active pour cette tranche. Le basculement (T057b) est mécanique : il consiste à faire de `api.ts` un ré-export de `schemas.ts` plus les alias de noms.
1. **La liste exacte du travail restant est écrite dans le test** (`RENOMMAGES`) : `AgentView` ↔ `AgentViewSchema`, `RecentImage` ↔ `RecentImageSchema`, `SessionEntry` ↔ `SessionEntrySchema`, `WorkspaceView` ↔ `WorkspaceViewSchema`. Ce ne sont pas des oublis : le bundle Rust nomme les DTO, le client historique suffixe les schémas.
2. **Les noms non-DTO restent côté client** : `PaneLayout`, `SnapshotPayload`, `SnapshotPane`, `TabInfo`, `SessionCursor`, `encodeCursor`/`decodeCursor` — vérifié : le web ne les importe pas, et les charges Herdr amont appartiennent à `herdr-client` (T13) ou au domaine, pas au contrat HTTP (TECH §5). Les mettre dans `contracts` aurait été un mélange.
3. **`SessionChanged` est désormais une définition de premier niveau** du bundle : elle était inlinée dans l'enveloppe SSE, donc non typable séparément. Le test l'a révélé (export absent) ; la correction est dans le contrat, pas dans le test.
4. **Une flake est apparue une fois sur la porte `tests`**, sans reproduction sur les trois passages suivants (mécanisme connu : `herdr-client` sous charge parallèle, T047). Elle n'est pas effacée du journal, et elle n'est pas imputée à cette tranche.
5. **Effect 4** : `Schema.Union` prend un **tableau** de membres et `decodeUnknownOption` rend un `Option` — le générateur et le test suivent l'API réelle, pas mes souvenirs d'Effect 3.

Commit préfixé `T057a:` contenant tout ce qui précède et cette section.

## Correctif — `session_changed` : `sourceRevision`, **sans chemin** (T053, TECH §7)

**Défaut introduit par ma T053, corrigé ici.** TECH §7 dit : « T053 adds the named `session_changed` invalidation event with `{paneId,sourceRevision:string}` from actual source observations. **No prompt text/path is included.** » J'avais livré `{paneId, path}` (nullable), en m'appuyant sur la commodité du veilleur (il portait déjà `source_avant/apres`) au lieu du texte de la spec. Le payload ne correspondait donc pas, et il **faisait traverser le chemin de session** par le flux — exactement ce que la spec interdit.

| Avant | Après |
|---|---|
| `SessionChanged { pane_id, path: Nullable<String> }` | `SessionChanged { pane_id, source_revision: String }` |
| `Changement.source_avant/apres: Option<String>` (chemins) | `Changement.revision_avant/apres: String` (**opaque**) |
| Le veilleur exposait `session_path` | `revision_de(vue)` = empreinte **16 hex** de l'identité `(kind, path\|id)` — réversible vers rien |
| — | `revision_absente()` : l'absence de source est une identité stable, distincte de toute source |

Ce qui reste vrai et vérifié : deux observations de la **même** source donnent la même révision ⇒ le veilleur ne publie rien (T053 : « repeated observations of the same revision are coalesced ») ; la disparition éteint la source (`revision_absente`) ; un changement de statut à source constante n'émet **pas** `session_changed`.

| Commande | Résultat |
|---|---|
| `cargo test -p application` | PASS — **148 tests** (dont la stabilité de la révision et l'absence de chemin). |
| `cargo test -p http-api` | PASS — **172 tests** (SSE : la charge porte `sourceRevision`, et un `path` est **refusé**). |
| `bun test` | PASS — **1092 tests** (le test de parité refuse désormais un `path` à la place de la révision). |
| `cargo xtask contracts check` | PASS — corpus 214 identique, génération déterministe. |
| `cargo xtask verify` | **5 portes vertes**. |

Note : la lecture de la spec est ce qui a rattrapé le défaut — pas un test. J'ajoute donc au test de parité deux charges **de refus** (`sourceRevision` manquante, `path` fourni) pour que le contrat ne puisse plus dériver silencieusement dans ce sens.

Commit préfixé `T053-fix:`.

**Note de traçabilité** : le message de commit de ce correctif a perdu un fragment (`le test de parité REFUSE un path` → `REFUSE un`) parce que le shell a interprété les accents graves du message. Le code, les tests et le journal ci-dessus sont complets ; seul le message a été tronqué. Corrigé par le commit de journal suivant, qui ne change aucun code.

## T057b — le basculement : `api.ts` devient une façade (C01, C18, C26)

Périmètre : `packages/shared/src/{api.ts, protocol.ts, index.ts}`, `packages/shared/scripts/build_contract_corpus.ts`, `packages/shared/tests/contrat-genere.test.ts`. Aucun service réel, aucun agent.

### Ce qui a changé

| Avant | Après |
|---|---|
| `api.ts` : **674 lignes** de schemas Effect écrits à la main (tous les DTO HTTP) | **173 lignes** : `export * from "../generated/schemas.ts"` + 5 alias + le codec de curseur + les charges **amont Herdr** |
| Deux définitions du contrat (TS + Rust) | Une seule : le bundle Rust. `api.ts` décode avec ce que le serveur sérialise |
| `protocol.ts` redéclarait `AgentStatus` et `ReadSource` (copies identiques au bundle) | ces deux énumérations viennent du bundle ; `protocol.ts` les importe pour ses propres schémas |
| `AgentViewSchema`, `RecentImageSchema`, `SessionEntrySchema`, `WorkspaceViewSchema`, `Choix` | **alias** des noms du contrat (`AgentView`, `RecentImage`, `SessionEntry`, `WorkspaceView`, `Choice`) — les imports existants ne bougent pas |

**Ce qui reste écrit à la main, et pourquoi** (vérifié par le test de couverture, liste `HORS_CONTRAT`) :
- `SessionCursor` + `encodeCursor`/`decodeCursor` — format **interne** du serveur, le client ne fait que le transporter ;
- `TabInfo`, `SnapshotPane`, `PaneLayout{,Pane,Rect}`, `SnapshotPayload` — charges **amont Herdr** (TECH §5 : elles appartiennent au protocole, pas à notre API).

### Preuve

| Commande | Résultat |
|---|---|
| `bun run typecheck` | PASS — aucun import cassé par le basculement. |
| `bun test` | PASS — **1092 tests**, dont `apps/server/tests/http/Api.test.ts` qui décode de **vraies réponses** du serveur via `decoderOf(...)` : le validateur est désormais **le schéma généré**, et il refuse une réponse hors contrat. |
| `bun test packages/shared/tests/contrat-genere.test.ts` | PASS — **12 tests** (parité, SSE, couverture, alias). |
| `cargo xtask contracts check` | PASS — corpus 214 identique, génération déterministe. |
| `cargo xtask verify` | **5 portes vertes**. |

### Décisions et honnêteté

0. **Le basculement n'a pas touché une ligne de code applicatif** : les alias portent les noms historiques, et les tests du serveur (qui produisent de vraies réponses) décodent avec les schémas générés. C'est la preuve demandée par T057 (« contrat invalidé refusé par le vrai client »), pas une affirmation.
1. **`AgentStatus`/`ReadSource` quittent `protocol.ts`** : deux copies strictement identiques (vérifié) devenaient une duplication au moment du basculement. Le bundle les portait déjà ; `protocol.ts` les importe. Sans ce retrait, `tsc` refusait deux `export *` du même nom — le conflit a servi de détecteur.
2. **Les commentaires riches de `api.ts` sont perdus côté TS** : le générateur n'émet que la première ligne de description d'un DTO. La connaissance vit désormais dans les DTO Rust (et dans `EXECUTION.md`). C'est le prix de la génération, assumé ici plutôt que découvert plus tard.
3. **`caughtUp` (C18) et `SessionChanged` (C26) sont dans la façade** ; leur **consommation** côté client (invalidation immédiate au lieu du sondage 400 ms) reste **T059**, comme la table de couverture du plan le prévoit.

Commit préfixé `T057b:`.

## T061 — libellés des cinq états (C22)

Périmètre : `apps/web/src/mot-etat.ts` (nouveau), `apps/web/src/ConversationRow.tsx`, `apps/web/tests/mot-etat.test.ts` (nouveau). Les tableaux Markdown étaient déjà corrigés (T0?? antérieur, `markdown.test.ts`).

### Défauts corrigés (mesurés, pas supposés)

| Défaut | Conséquence | Correction |
|---|---|---|
| `blocked` affichait « working » | l'utilisateur croyait l'agent au travail alors qu'il **attendait une réponse** — donc il ne la donnait pas | le mot vient de `STATUS_LABEL` (« waiting for input »), la table partagée par les autres écrans |
| `idle` affichait « finished il y a 3 min » | une **fin inventée**, calculée sur l'horloge de l'écran et un horodatage qui ne dit rien d'une fin de travail | `idle` dit « idle », point. La durée n'est ajoutée que pour `done`, et seulement si la session fournit l'horodatage |

Le libellé vit maintenant dans **un module** (`mot-etat.ts`) : `ConversationRow` l'importe, et la table des mots reste celle de `labels.tsx` — deux endroits ne peuvent plus diverger.

### Preuve

| Commande | Résultat |
|---|---|
| `bun test apps/web/tests/mot-etat.test.ts` | PASS — **8 tests** : les cinq états, `blocked ≠ working`, `idle` sans « finished », `done` avec/sans horodatage, et **la ligne réellement rendue** (`renderToStaticMarkup`) pour `blocked` et `idle`. |
| `bun test` | PASS — **1105 tests**. |
| `bun run verify` + `cargo xtask verify` | verts. |

## T063 — une frappe ne recalcule plus l'historique (C27)

Périmètre : `apps/web/src/blocks.ts` (mémoïsation de `toItems`/`touchedFilesOf`), `apps/web/src/ChatScreen.tsx` (`useMemo`), `apps/web/tests/calcul-historique.test.ts` (nouveau).

### Ce qui a changé

| Avant | Après |
|---|---|
| `toItems(messages, working)` et `touchedFilesOf(messages)` appelés **dans le rendu** | `useMemo` sur `(messages, enCours)` dans `ChatScreen` |
| Chaque frappe refaisait le découpage de **tout** l'historique | cache **par identité du tableau** (et par état du dernier tour) dans `blocks.ts` : même tableau ⇒ zéro travail, quel que soit l'appelant |
| — | `WeakMap` : naviguer entre conversations ne retient pas les anciens tableaux |

### La mesure (pas un chronomètre)

Le tableau de messages est enveloppé dans un `Proxy` qui **compte les accès aux éléments** : sur **2 000 messages**, le second appel lit **zéro** message (compteur identique avant/après) et rend **le même objet**. Un tableau nouveau (message reçu) recalcule ; un changement d'état du dernier tour a son propre résultat mémorisé.

| Commande | Résultat |
|---|---|
| `bun test apps/web/tests/calcul-historique.test.ts` | PASS — **5 tests** (2 000 messages). |
| `bun test` | PASS — **1105 tests**. |

### Notes d'honnêteté

- **T062 n'est pas faite** : `ChatScreen` POSTe encore `/api/agents/:id/focus` **automatiquement** à l'ouverture et à chaque changement de statut. C24/T062 demandent « action explicite seulement », mais `TECH.md:340` dit que « whether the webapp automatically invokes it is a separate frontend product decision, outside backend parity ». **Les deux textes du plan se contredisent** : retirer l'appel change un comportement visible (les agents resteraient `done`), donc je ne le fais pas sans arbitrage.
- **C25 (fond inerte des feuilles)** n'est pas prouvable ici : aucun harnais DOM (`happy-dom`/`jsdom`) n'est installé ; les tests existants vérifient le piège de focus par fonctions pures. Ajouter le harnais est un choix de toolchain, pas une ligne de code.

Commit préfixé `T061+T063:`.

## T060 — mise à jour PWA différée et explicite (C21)

Périmètre : `apps/web/src/mise-a-jour.ts` (nouveau), `apps/web/src/BandeauMiseAJour.tsx` (nouveau), `apps/web/src/envois-en-cours.ts` (nouveau), `apps/web/src/{main.tsx, App.tsx, brouillons.ts, ChatScreen.tsx}`, `apps/web/tests/mise-a-jour.test.ts` (nouveau).

### Le défaut, et ce qui le ferme

| Avant | Après |
|---|---|
| `controllerchange` rechargeait la page **tout seul** | le rechargement n'a lieu que si **nous** avons appliqué la mise à jour (`doitRecharger()`), jamais sur un `controllerchange` subi |
| Le nouveau worker prenait la main à la première occasion | le worker **attend** ; `signaleMiseAJour` ne fait que publier le fait |
| Rien ne demandait l'avis de l'utilisateur | un bandeau dit qu'une version est prête, avec un bouton **désactivé** tant qu'un brouillon ou un envoi non résolu existe |
| Perte silencieuse d'un brouillon / d'un envoi incertain | la règle `blocageDeMiseAJour` refuse **et nomme la cause** (« draft » / « being sent ») |
| — | **aucun stockage persistant de prompt** ajouté : on attend, on ne sauvegarde pas |

Les deux faits qui bloquent sont publiés, pas devinés : `unBrouillonExiste()` (le store de brouillons, déjà par agent) et `envoiEnCours()` (un booléen publié par `ChatScreen` dès qu'un envoi est `queued`/`sending`/`uncertain`).

### Preuve

| Commande | Résultat |
|---|---|
| `bun test apps/web/tests/mise-a-jour.test.ts` | PASS — **8 tests** : la règle (aucun / brouillon / envoi, avec l'ordre de gravité), le geste (un seul `SKIP_WAITING`, refus sans effet, worker conservé après refus), les abonnés, et une registration sans worker qui n'annonce **rien**. |
| `bun test` | PASS — **1113 tests**. |
| `bun run verify` + `cargo xtask verify` | verts. |

### Notes d'honnêteté

- **Le bouton n'est pas testé « monté »** : aucun harnais DOM dans le dépôt. Ce qui est prouvé, c'est la **règle** (pure) et le **geste** (store), c'est-à-dire les deux endroits où une erreur coûte des données. Le rendu du bandeau est vérifié par le typecheck, pas par un test de navigation.
- **`ServiceWorker.postMessage` n'a pas de `targetOrigin`** : le lint applique la règle de `window.postMessage` et signale une absence qui n'existe pas. La désactivation est locale à la ligne, avec sa raison écrite — pas une exception globale.
- **Les types du store sont structurels** (`WorkerEnAttente`, `RegistrationAvecWorker`) : le faux de test n'a besoin d'aucune assertion `as`, et une évolution du DOM ne cassera pas silencieusement la règle.

Commit préfixé `T060:`.

## T062 — focus explicite (C24) et feuilles réellement modales (C25)

Périmètre : `apps/web/src/{ChatScreen.tsx, Feuille.tsx, dialogue.ts}`, tests `apps/web/tests/{focus-explicite,dialogue-modal}.test.ts`.

### C24 — le focus desktop est un geste, plus un effet de bord

| Avant | Après |
|---|---|
| un `useEffect` POSTait `/api/agents/:id/focus` **à l'ouverture** et **à chaque changement de statut** | aucun effet ne touche au focus |
| lire une conversation volait le clavier du Mac | un bouton d'en-tête `Focus this pane on the Mac` (icône + `aria-label`) |
| l'acquittement d'un agent dépendait de la navigation | l'acquittement dépend d'un **geste** : c'est la correction demandée |
| — | l'échec est une **valeur** : la notice dit « Could not focus on the Mac: … », jamais un succès supposé |

La cible est **capturée** avant l'attente (`const cible = agent.paneId`) : la réponse ne peut pas viser un autre agent que celui de la conversation ouverte.

**Arbitrage assumé entre deux textes du plan.** `C24` (table des corrections) et `T062` demandent « action explicite seulement » ; `TECH.md:340` dit que « whether the webapp automatically invokes it is a separate frontend product decision, outside backend parity ». J'ai suivi **C24** : c'est la correction numérotée, elle a un propriétaire de tâche, et l'endpoint reste intact (parité backend préservée). La conséquence — un agent reste `done` jusqu'à un geste — est exactement ce que C24 décrit comme souhaitable.

### C25 — la feuille devient **réellement** modale

| Avant | Après |
|---|---|
| `<dialog open aria-modal="true">` : le fond restait **interactif** (clic dans la marge, focus clavier tenu par notre JS seul) | `showModal()` : le dialogue passe en *top layer*, le reste du document devient **inerte — pointeur ET clavier — par le navigateur** |
| — | repli explicite (`open` simple) quand le moteur n'a pas `showModal` ; le mode rendu (`modale`/`simple`) est **dit**, jamais supposé |
| — | pas de second `showModal()` sur un dialogue déjà ouvert (il lèverait) |

Ce qui existait déjà et reste : capture de l'élément focalisé **avant** l'ouverture, restitution à la fermeture si l'élément est encore connecté, piège de `Tab` recalculé à chaque appui, `Échap` sans modificateur.

### Preuve

| Commande | Résultat |
|---|---|
| `bun test apps/web/tests/focus-explicite.test.ts` | PASS — **4 tests** : le bouton existe dans le rendu ; `focusAgent(` n'apparaît **qu'une fois**, dans `focusDesktop`, **aucun** `useEffect` ne l'appelle, et aucun effet ne porte plus la dépendance `[agent.paneId, agent.status]`. |
| `bun test apps/web/tests/dialogue-modal.test.ts` | PASS — **3 tests** : modal quand disponible, repli `open`, pas de double `showModal`. |
| `bun test` | PASS — **1120 tests**. |
| `bun run verify` + `cargo xtask verify` | verts. |

### Limites dites

- L'inertie du fond **ne peut pas être testée ici** (aucun harnais DOM) : c'est le navigateur qui la fournit, et c'est la raison pour laquelle on lui délègue au lieu de la simuler. Le test prouve la **décision** (modal si possible) et le **repli**.
- La garde « aucun focus automatique » lit la source : c'est une **garde anti-régression**, pas une preuve de comportement. Elle est écrite comme telle.

Commit préfixé `T062:`.

## T059 — le client de données partagé (C23, C26)

Périmètre : `apps/web/src/rafraichissement.ts` (nouveau), `apps/web/src/App.tsx` (lecture et cadence), `apps/web/tests/rafraichissement.test.ts` (nouveau).

### Les trois défauts mesurés, et ce qui les ferme

| Avant | Après |
|---|---|
| `Promise.all` **tout-ou-rien** : un `health` en panne jetait l'overview et la liste pourtant lus, et l'écran affichait une erreur *globale* | chaque lecture a **son issue** (`Issue`), appliquée pour elle-même : une panne partielle n'efface plus les données saines |
| **aucun vol unique** : minuteur + SSE + retour au premier plan + resync = huit lectures simultanées | **un seul vol** sert tous les appelants ; `vols()` compte les vols RÉELS |
| **aucune génération** : une réponse lente écrasait une plus récente (la liste revenait en arrière) | chaque vol porte une génération ; `doitAppliquer` ignore un résultat plus ancien |
| une seule cadence (4 s, y compris onglet caché) | **deux cadences** : 4 s visible, **60 s cachée**, et **relecture immédiate au retour** |

### Preuve

| Commande | Résultat |
|---|---|
| `bun test apps/web/tests/rafraichissement.test.ts` | PASS — **7 tests** : 8 appels simultanés ⇒ **1** lecture par endpoint (compteurs) ; health en panne ⇒ overview + conversations **lisibles** ; trois pannes ⇒ « au moins une réussie » faux ; générations strictement croissantes et règle d'application ; cadences. |
| `bun test` | PASS — **1127 tests**. |
| `bun run verify` + `cargo xtask verify` | verts. |

### Notes d'honnêteté

- **Les types sont génériques** (`Resultat<O, H, C>`, `Lectures<O, H, C>`) : l'écran reçoit ses vraies données. La première version imposait des `as Overview` / `as Health` — refusés par le lint du dépôt, et c'était justifié : une assertion aurait masqué une divergence de contrat.
- **Le « drain `caughtUp` » et l'invalidation `session_changed`** restent au chat (T058 côté store) : ce tour livre le client de lecture partagé, pas le store de conversation.
- **La cadence cachée est plus lente, pas « suspendue »** : un onglet en arrière-plan doit encore voir arriver un agent bloqué ; il le voit avec au plus 60 s de retard, et immédiatement au retour.

Commit préfixé `T059:`.

## T058 — le store d'envois par pane (C19, C20)

Périmètre : `apps/web/src/envois.ts` (nouveau), `apps/web/src/ChatScreen.tsx` (les envois quittent l'état du composant), tests `apps/web/tests/envois-store.test.ts` (nouveau) + deux assertions de source déplacées (`composeur`, `feuilles`).

### Les trois défauts mesurés

| Défaut | Conséquence | Correction |
|---|---|---|
| la cible était **celle du rendu** (`agent.paneId` lu au moment de l'appel) | échec sur A → ouvrir B → « réessayer » envoyait le texte à **B** | la cible est **capturée** à la création de l'envoi : `reessaye` vise A, toujours |
| la minuterie de 900 ms était un `setTimeout` **du composant**, annulé au démontage | changer de conversation dans les 900 ms **annulait l'envoi sans le dire** | la minuterie appartient au **magasin** : elle survit à la navigation |
| les états vivaient dans l'état **du composant affiché** | une réponse tardive de A pouvait se poser sur B | chaque envoi est rangé **sous son pane** : une réponse ne traverse pas |

### Preuve

| Commande | Résultat |
|---|---|
| `bun test apps/web/tests/envois-store.test.ts` | PASS — **10 tests** : cible capturée (A→B→retry n'appelle que A), pas de réessai d'un envoi délivré, minuterie qui survit à l'ouverture d'une autre conversation (les deux partent, chacun sur sa cible), annulation avant départ (zéro appel), réponse tardive de A invisible dans B, `uncertain` quand la confirmation manque, `suppressed` = succès assumé, lanceur qui lève ⇒ `failed/inconnu`, `oublie` d'un délivré, abonnés. |
| `bun test` | PASS — **1137 tests**. |
| `bun run verify` + `cargo xtask verify` | verts. |

### Décisions et honnêteté

0. **Le lanceur et le planificateur sont INJECTÉS** : le magasin ne connaît ni `fetch` ni `setTimeout`. Les tests n'attendent jamais 900 ms (planificateur manuel) et ne touchent aucun réseau.
1. **Deux tests de source ont dû suivre le déplacement** (`composeur.test.ts`, `feuilles.test.ts`) : ils vérifiaient que l'affichage optimiste porte `queued` + le texte et que la restitution du brouillon passe par `ecrireAuChamp`. Le déplacement ne change pas la règle, mais l'assertion devait viser le nouveau propriétaire — c'est fait, avec la raison écrite dans le test.
2. **Le store ne persiste rien** : un envoi non confirmé meurt avec l'onglet. Le produit n'écrit pas de texte non envoyé sur le disque (même règle que les brouillons).
3. **Ce qui reste de T058** : les **feuilles et questions** gardent leur état local dans `ChatScreen` (elles ne traversent pas la navigation, et les séparer demanderait de déplacer aussi leur rendu). Le store livré couvre les trois défauts nommés par C19/C20 ; la séparation complète feuilles/questions est notée comme reste, pas comme faite.

Commit préfixé `T058:`.

## T064 (tranche A) — la porte de couverture (89 capacités, C01–C27)

Périmètre : `xtask/src/coverage.rs` (nouveau), `xtask/src/{lib,main}.rs` (commande `coverage`), `compatibility/coverage.json` (candidats), `xtask/tests/unit_tests.rs` (8 tests).

### Ce que la porte vérifie

| Règle | Pourquoi |
|---|---|
| une preuve nommée doit **exister** sur le disque | un test renommé laissait une couverture « verte » dans un document et fausse dans la réalité |
| une preuve ne doit **jamais** être sous `src/` | du code de production ne prouve pas un comportement |
| `status: "proven"` **sans** fichier = défaut | c'est le pire cas : un document qui se déclare couvert sans rien nommer |
| un identifiant en double est refusé | deux entrées pour la même capacité rendraient le compte faux |
| un `status` absent = **en attente** | on ne suppose jamais qu'une preuve existe |

### Le scoreboard, aujourd'hui

```
couverture : 0 prouvée(s), 116 en attente (89 avec un candidat à examiner), 0 défaut(s)
```

**Pourquoi 0 « prouvée » alors que 89 entrées ont un candidat** : le premier passage a produit ces candidats par **grep** de l'identifiant dans les fichiers de test. Un grep n'est **pas** une preuve — un test peut nommer `H05` sans en vérifier le comportement. Les candidats sont donc inscrits dans `coverage.json` (`candidateTests`) et le statut reste `pending` jusqu'à examen. Marquer 89 capacités « prouvées » sur un grep aurait été exactement le mensonge que ce projet refuse.

### Preuve que la porte peut échouer

`xtask/tests/unit_tests.rs` — **8 tests** : preuve existante acceptée ; preuve sous `src/` refusée ; preuve introuvable ; `proven` sans fichier ; statut absent = en attente ; doublon refusé ; liste absente refusée ; **un candidat n'est pas une preuve** (le compteur `avec_candidats` le dit sans changer `prouvees`).

| Commande | Résultat |
|---|---|
| `cargo test -p xtask` | PASS — **21 tests** (dont 8 nouveaux). |
| `cargo run --locked -p xtask -- coverage` | `0 prouvée(s), 116 en attente (89 avec un candidat), 0 défaut(s)` — **exit 0** (matrice cohérente, pas complète). |
| `cargo xtask verify` + `bun run verify` | verts. |

### Ce qui reste de T064 (et pourquoi je ne le déclare pas fait)

- **Examiner les 89 candidats** un par un : pour chacun, lire le test et confirmer qu'il vérifie le comportement de la capacité, puis passer `status` à `proven` avec ses `tests`. C'est un audit, pas une génération.
- **Prouver les 27 entrées sans candidat** : ce sont des capacités dont la preuve n'existe pas encore sous forme de test nommé — notamment `O01`/`O02`/`O03` (cycle de vie, config), `O06`/`O07` (assets, cache), `O08`–`O10` (release, packaging), `D06`–`D10`/`D16` (lecteurs), `A02`/`A09`–`A15` (interactions/catalogues), `E10`, `S01`/`S10`/`S12`/`S14`.
- Le texte de T064 demande aussi les tests négatifs **sécurité/concurrence/propriétés** et les cinq profils : les suites existent pour une large part (files/scan, journal/concurrence, sessions/profils), mais les **nommer** dans la matrice fait partie du même audit.

La porte est donc en place, honnête et capable d'échouer ; la matrice reste à remplir.
