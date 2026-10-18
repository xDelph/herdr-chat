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

Commit préfixé `T014:` contenant `crates/sessions/src/storage/**`, `crates/sessions/src/lib.rs`, `crates/sessions/tests/**` et cette section. Cargo.lock inchangé.