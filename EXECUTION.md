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
