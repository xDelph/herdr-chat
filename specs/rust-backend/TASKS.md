# Migration Rust — tâches d'exécution

État : **T001–T057, T060–T063 terminées** (chacune livrée, testée et journalisée dans `EXECUTION.md`) ; la suite : **T058, T059** (store de conversation, data client partagé). Branche `plan/rust-backend`, worktree `.worktrees/rust-backend`, base d’exécution `d19f98d23b02cacf7d6d9d97facf8d6360b0546b` (inventaire historique `576bbf4902a00d3ef9702b4df315c943c7ac5680`). Les chemins ci-dessous sont relatifs à ce worktree.

Références : [inventaire](CURRENT.md), [architecture](TECH.md), [composition des adaptateurs](ADAPTERS.md), [contrats](CONTRACTS.md), [couverture des sources](SOURCE-MAP.md), [complément de baseline](BASELINE-DELTA.md). H/D/A/E/S/O désignent les capacités de CURRENT ; C désigne les corrections de TECH §10.

## Règles d'exécution

- **Ordre strict T001 → T070.** T001 n'a pas de prérequis ; chaque tâche suivante dépend de la précédente terminée avec sa preuve. Aucun parallélisme ou lancement d'agent implicite. Le développeur exécute uniquement le périmètre qui lui sera confié.
- Une case ne se ferme qu'avec sa preuve : livrer les fichiers concernés et les tests indiqués, exécuter ces tests, consigner commande/résultat et commit dans `EXECUTION.md`. Un test ignoré ou une preuve manquante bloque la tâche suivante — la case reste alors ouverte. Ne pas réécrire l'inventaire historique pour faire disparaître une différence.
- **Un seul contrat exécutable** à chaque étape. Jusqu'au basculement T057, les schémas TS actuels restent autoritaires ; le futur contrat Rust est comparé à ce corpus. À T057, le contrat Rust et ses exports générés deviennent la référence, et les schémas TS manuels sont retirés du chemin actif.
- **Aucun test sous `src/`**, y compris les tests TS historiques : déplacer à T004. Rust : `crates/<crate>/tests/unit_tests.rs` + `tests/unit/mod.rs`, `integration_tests.rs` + `integration/`, `contract_tests.rs` + `contracts/`, `property_tests.rs` + `properties/`. Un fichier racine déclare les sous-modules correspondants. TS : `apps/server/tests/`, `apps/web/tests/`, `packages/shared/tests/`.
- Pas de `#[test]`, `#[tokio::test]`, module `#[cfg(test)]`, `include!` de tests ou réinclusion de `src` dans un test. Les cibles Cargo externes servent aussi aux tests logiquement unitaires ; tester les API publiques et comportements observables, sans rendre une fonction publique uniquement pour un test. Les exécutables factices et builders vont dans `test-support`, leurs assertions sous `tests/`.
- Port Herdr factice, horloge contrôlée, racines temporaires et sink push factice obligatoires. Aucun vrai CLI d'agent, input à un agent, socket de production, session utilisateur ou abonnement push réel. Aucun changement du service installé.
- Les socles ne connaissent pas les agents concrets. Un changement spécifique reste dans le profil d'agent ; changer un socle exige les tests de tous ses consommateurs. Forme inconnue = erreur/absence explicite ou raw conservé, jamais fallback vers un autre agent.
- En cas de différence avec la base : ne la conserver que si CURRENT la décrit ou si une correction C l'autorise. Une nouvelle différence non décrite bloque la tâche et doit être ajoutée explicitement au plan avant implémentation.

## 1. Référence, workspace et contrats

| État / ID | Périmètre | Livrable précis | Preuve de fin |
|---|---|---|---|
| [x] T001 | `compatibility/, EXECUTION.md` | Geler la base d’exécution et son complément BASELINE-DELTA.md. Créer `compatibility/baseline.json`, `compatibility/coverage.json`, `EXECUTION.md` et corpus synthétique de référence. Indexer les 89 capacités, 18 routes, 17 env, 171 déclarations/11 schémas et corrections C01–C27. Capturer contrôles/mesures TS et un bundle de benchmark fixture gelé avec hash, sans main ni socket/CLI réel. | Chaque ID a une attente et une future cible de test ; aucun endpoint/env/source omis. Les défauts connus ont une attente corrigée distincte. Le bundle de référence ne dépendra pas de la façade TS remplacée à T057 et reste exclusivement dev ; commandes/versions/fixtures/résultats enregistrés. |
| [x] T002 | `Cargo manifests, rust-toolchain.toml` | Créer les 13 membres Cargo décrits par TECH : `domain`, `contracts`, `herdr-client`, `sessions`, `catalog`, `interactions`, `files`, `notifications`, `application`, `http-api`, `herdrchat`, `test-support`, `xtask`. Édition 2024, toolchain/MSRV **1.94.1**, versions et features des dépendances centralisées, Cargo.lock suivi ; packages internes `publish=false`. | Workspace se compile `--locked`, graphe acyclique conforme à TECH, aucun préfixe `hc-`, aucune version flottante git/latest/*, aucune dépendance de test dans le daemon publié. |
| [x] T003 | `xtask, .github/workflows` | Ajouter `xtask verify` et CI pour format/clippy/tests externes/graphe ; `verify-layout` analyse les fichiers du worktree, suivis ou nouveaux, sans builds/dépendances/worktrees imbriqués. Contrats ajoutés à T009, frontend complet à T057. | Sur corpus de structure synthétique : test src/module inline/dépendance interdite font échouer la porte ; sondes retirées. Violations TS historiques listées explicitement jusqu'à T004, sans les rendre autorisées définitivement. |
| [x] T004 | `apps/*/tests, packages/shared/tests` | Déplacer tous les tests TS de `apps/*/src` et `packages/shared/src` vers leurs dossiers `tests/`. Corriger imports et lectures de fixtures/CSS/source, sans affaiblir leurs assertions ; activer verify-layout global sans exception historique. | Même manifeste de cas exécutés qu'à T001, zéro cas perdu/ignoré, portes TS vertes, zéro fichier/déclaration de test sous src. Aucun refactoring fonctionnel dans ce déplacement. |
| [x] T005 | `domain` | Implémenter `domain` : IDs distincts, observations/générations, statuts, causes, preuve partielle, messages/réglages/raw, noms/rangs et ports étroits. | Exhaustivité des enums ; null/absence/inconnu distincts ; ordre y/x/ID, nom non répétitif et sourceId≠paneId couverts. |
| [x] T006 | `test-support` | Implémenter `test-support` : faux ControlPort, capture ordonnée des actions/cibles, horloge, faux processus de catalogue, stores JSONL/SQLite jetables, fake push et génération de charges. Fixtures classées par stockage/famille/agent/version. | Les tests de l'infrastructure prouvent isolation, échec injecté, cleanup, absence d'accès HOME/socket/CLI réel et reproductibilité sur seed fixe. |
| [x] T007 | `contracts` | Implémenter tous les DTO publics dans `contracts`, dont corps inline, SSE, push et résultats non JSON. Créer Field/Nullable et renames exacts. | Corpus positif/négatif couvre chaque schéma, champs obligatoires/omis/null, nombres et littéraux français ; aucun raw perdu ni champ inventé. C01. |
| [x] T008 | `contracts::registry` | Implémenter le registre typé des **18 routes**, méthodes, corps/query, variantes de statuts, Content-Type et politique mutante ; DTO amont séparés dans `herdr-client`. | Le manifeste du registre correspond aux H01–H18 et à toutes leurs variantes documentées ; test négatif d'une route/réponse absente. |
| [x] T009 | `xtask, shared/generated` | Implémenter `xtask contracts export/check` : JSON Schema, OpenAPI 3.1, types TS et validateurs Ajv standalone ; garder les imports frontend actuels jusqu'à T057. | Deux exports sont identiques octet pour octet ; modification de DTO fait échouer check ; corpus accepté/refusé identiquement par serde et JS. Générateurs figés dans lockfiles. |
| [x] T010 | `domain::errors, http-api::errors` | Implémenter erreurs domaine et mappings par endpoint, journal diagnostic structuré et messages sûrs. Conserver les formes atypiques documentées, corriger les erreurs aval masquées. | Chaque erreur injectée obtient code/cause/corps prévu ; invalide≠vide≠absent≠IO, détail utile conservé, aucun secret exposé. C04. |

## 2. Socles et lecteurs de sessions

| État / ID | Périmètre | Livrable précis | Preuve de fin |
|---|---|---|---|
| [x] T011 | `files::confined, sessions::path_policy` | Implémenter l'ouverture confinée portable macOS/Linux et `AuthorizedFile`/`AuthorizedSource` : roots canoniques, descripteurs, régularité, liens internes sûrs, RAII. | Refus de sortie/sibling/encodage/swap de lien/FIFO/device ; lien interne légitime accepté ; descripteurs fermés après chaque échec. C13. |
| [x] T012 | `herdr-client::transport` | Implémenter le transport Unix : JSONL, corrélation ID, taille de frame 16 MiB, fragmentation UTF-8, fermeture, cancellation et deadline par méthode. | Faux socket : fragments, mauvais ID, JSON/enveloppe invalide, EOF, timeout, surtaille ; aucune fuite ni retry mutante automatique. |
| [x] T013 | `herdr-client::wire/client` | Implémenter les 13 méthodes Herdr utilisées et leurs réponses vérifiées. Représenter les capacités historiques sans activer les méthodes seulement déclarées. | Fixtures de requêtes exactes target/pane_id/tab_id, visible sans lines, strip_ansi ; mauvais discriminant de succès ne confirme pas un prompt. C05. |
| [x] T014 | `sessions::storage::jsonl` | Implémenter `sessions::storage::jsonl` : header, tail, forward, backward, identité et framing par octets ; corriger définitivement pending/offset. | Propriétés sans perte/duplication sur toutes coupures UTF-8/newline, plusieurs appends, troncature/rotation, page vide/record géant ; offset ≤ octets effectivement consommés. C02. |
| [x] T015 | `sessions::storage::sqlite` | Implémenter le moteur SQLite commun : worker dédié par DB, connexion readonly, bound params, timeout 3 s, file 32 jobs, interruption et pagination configurable. | Schémas factices différents utilisent le même moteur ; seq/row_id inclus en forward, `<` en backward, mutation de borne relue ; pas de blocage du runtime ni écriture DB/WAL/schema. |
| [x] T016 | `sessions::families/codecs` | Implémenter primitives `families::openai` puis codecs **Chat** et **Responses** séparés ; codec Anthropic et Pi séparés. Partager arguments/texte uniquement lorsque les fixtures établissent la même forme. | Fixtures positives/négatives indépendantes des agents ; JSON d'arguments invalide conservé brut ; Chat ne décode pas une enveloppe Responses par hasard. |
| [x] T017 | `sessions::pipeline/registry` | Implémenter pipeline/registre de profils : stockage→enveloppe→codec→politique→normalisation ; capacités lisible/catalogue/lancement/interactions indépendantes. | Socles sans dépendance ni branche sur agent concret ; inconnu ne bascule pas sur un autre profil ; modification du profil Devin laisse les résultats Codex inchangés. |
| [x] T018 | `sessions::agents::pi` | Profil **Pi** : JSONL/header, huit rôles, réglages/usage/custom/contexte/compaction, lineage. | Corpus Pi actuel préservé ; parentId jamais assimilé à un sous-agent ; pas d'écriture source. D11. |
| [x] T019 | `sessions::agents::codex` | Profil **Codex** : enveloppes Responses/event_msg, contexte injecté filtré, commandes/diffs/outils custom, réglages/phase/IDs, raisonnement masqué. | Corpus D12–D13 complet ; vrais longs prompts conservés ; réflexion chiffrée jamais inventée ; socle commun inchangé par ces politiques. |
| [x] T020 | `sessions::agents::claude` | Profil **Claude** : user/assistant, tool_use/result/error, UUID/modèle, notices exclues et XML de commandes. | Aucun retour du message filtré par le fallback raw ; slash commands et erreurs d'outil préservées. D14. |
| [x] T021 | `sessions::agents::opencode` | Profil **opencode** : queries session_v2/session_message, seq, parties texte/reasoning/tool/file et modèle/provider/variant. | Streaming d'une ligne réécrite remplace l'ID stable ; images data URI et erreur d'outil gardées ; default variant non inventé. D15,D17. |
| [x] T022 | `sessions::agents::devin` | Profil **Devin** : queries sessions/message_nodes, row_id, chat_message, metadata/thinking et composition Chat. | node_id jamais utilisé comme curseur ; texte/réflexion/modèle et raw préservés ; tool_calls garde son statut non vérifié tant qu'aucune fixture réelle autorisée ne le prouve. D16–D17. |
| [x] T023 | `sessions::resolver/index` | Résolution partagée : path/id, archive indexée, cache positif/négatif invalidable, Codex titre+cwd+index unarchived avec versions numériques de DB. | Source identique pour overview/list/session ; ambigu/nonconcordant inexploité ; ajout de session après cache négatif visible ; state_10 prioritaire sur state_9 ; titre Codex brut puis candidat sans glyphe de travail, chaque candidat prouvé par nom exact + cwd dans l’index ; conserver un vrai titre commençant par un glyphe. Reprendre les régressions d19f98d. C15. |
| [x] T024 | `sessions::cursor, contracts` | Curseurs opaques versionnés liés à source/session/génération ; compatibilité legacy fichier ; reset SQLite legacy ; initial/historique/rotation et erreurs 400/409. | Curseur d'A ne lit jamais B ; remplacement/reset remplace la vue ; backward garde sa position forward ; dev/ino, nombre invalide et version inconnue couverts. C12. |
| [x] T025 | `sessions, contracts` | Bornage du forward : ajouter `caughtUp` et query `observe=0`/`observe=1` (défaut 1) ; pages cibles 2 MiB JSON, plafond absolu 16 MiB, record seul au-delà cible si réponse ≤ plafond. Record hors plafond : 422 sans avancer son curseur. `hasMore` reste historique. | Delta32MiB sans perte ; caughtUp vrai au seul watermark complet observé ; observe=0 ne renouvelle pas le lease, valeur invalide400 ; texte partiel non affiché, aucun saut silencieux. C18,C26. |
| [x] T026 | `sessions::metadata` | Réducteur commun de métadonnées : user prompt, preview texte/outil, timestamp, modèle/provider en paire, thinking, cause ; cache 256 sources et budget 32×64 KiB. | Résultats cohérents pour les cinq profils, métadonnées précédentes préservées sans remplacement, placeholders exclus, une source invalide n'efface pas les autres. D18–D22. |
| [x] T027 | `sessions::index` | Index/lecteur partagé par source et génération, bornes de cache, déduplication des lectures en vol, reconciliation des lignes SQLite récentes et invalidation des panes réaffectés. | 8 clients ne multiplient pas les lectures identiques ; réponse tardive d'ancienne génération ignorée ; disparition/réapparition/cold miss et limites de mémoire couverts. |

## 3. Catalogues, interactions et commandes

| État / ID | Périmètre | Livrable précis | Preuve de fin |
|---|---|---|---|
| [x] T028 | `catalog::process, domain::ports` | Exécuteur de processus commun pour commandes fixes : argv, timeout 20 s, stdout 2 MiB/stderr 64 KiB, fin et cleanup des seuls enfants créés. | Exécutables factices : sortie/erreur/timeout/surtaille/annulation ; pas de shell ni vrai CLI d'agent. |
| [x] T029 | `catalog::adapters` | Profils catalogues Pi/Claude/Codex/Cursor/Devin, IDs/labels/niveaux/provenance et absence explicite pour autre kind. | Toutes les formes du tableau CURRENT passent ; alias Claude et limitation visibles ; aucune déduction de niveau pour Cursor/Devin. |
| [x] T030 | `catalog::args` | Profils d'args de lancement et validation modèle/raisonnement séparés du moteur : flags exacts et demandes non supportées refusées. | Matrice complète kind×model présent/absent×thinking présent/absent ; provider non consommé historiquement reste explicitement non appliqué, jamais présenté comme appliqué. |
| [x] T031 | `catalog::cache, application` | Cache/single-flight commun des catalogues, succès 60 s, échec non figé ; registre partagé des intégrations listables/lisibles/lancables. | Deux requêtes concurrentes d'un kind lancent exactement un processus ; échec suivant réessayable ; liste et lancement appliquent la même politique. C16. |
| [x] T032 | `interactions::families/agents` | Crate `interactions` : familles numérotée/sélection/saisie libre et profils Pi/Codex/Claude/opencode/Devin ; parsing question/contexte/détails/gouttière et fallback waiting. | Corpus par profil ; aucun profil mesuré manquant remplacé par Codex ; écrans non reconnus n'émettent aucune action. |
| [x] T033 | `interactions::engine/plan/verify` | Moteur commun lire→valider fingerprint→plan→exécuter→relire ; preuves d'identité/choix, confiance explicite, saisie libre ordonnée, résultats partiels conservés. | Questions périmées, sélection Claude déjà déplacée, agent sorti, nouvelle question après frappe, Enter échoué et famille inconnue ne donnent aucun faux succès. C03,C17. |
| [x] T034 | `application::commands` | Admission/file par pane (8 opérations), cible et session capturées, exclusion des séquences prompt/question/trust/stop/focus concurrentes. | A/B indépendants ; séquences d'un même pane non entrelacées ; saturation explicite ; annulation après effet ne rejoue rien. |
| [x] T035 | `application::commands::prompt` | Service prompt : relecture état, fallback interactif seulement sur refus connu, fingerprint SHA256 actuel, dernier texte confirmé par pane sur 60 s monotones. | Doublon simultané supprimé après preuve ; A→B→A autorisé ; timeout/inconnu/saisie partielle ne bloque pas un retry ; success discriminator exigé. C05–C06. |
| [x] T036 | `application::commands::stop/focus` | Services stop/focus avec observation fraîche ; Ctrl+C seulement working ; effet desktop et focused:false conservés côté endpoint. | Agent absent 404, nonworking no-op, stop transmis≠arrêt confirmé ; focus échoué n'empêche pas lecture. A04–A05. |
| [x] T037 | `application::commands::launch` | Moteur de lancement et profils : tout valider avant tab, réserver nom, tab unfocused/cwd, start avec deadline 125 s, retry shell 3 s×10 seulement sur refus explicite ; cleanup possédé seulement. | Entrée invalide crée zéro tab ; collision de nom ne reprend pas un nom occupé ; timeout ambigu ne double pas l'agent ; confiance renvoyée sans action automatique. C07. |

## 4. État, événements, push et fichiers

| État / ID | Périmètre | Livrable précis | Preuve de fin |
|---|---|---|---|
| [x] T038 | `application::state/refresh` | Snapshot/ping partagé, snapshots complets immuables horodatés/générés, poll 2 s, coalescence et cache vide valide ; aucun vieux résultat ne remplace un neuf. | Un refresh upstream pour requêtes simultanées ; panne distingue données périmées et zéro agent ; contrôle du nombre d'appels sous 8 clients. |
| [x] T039 | `application::overview/conversations` | Overview/conversations depuis même génération : workspace/cwd/enrichissement/visibilité, résumé indépendant par ligne, question→trust→waiting, quatre lectures globales. | Tous D01–D05,D18–D20 ; empty workspaces gardés ; erreur d'une session n'efface pas la liste ; provenance et fraîcheur conservées. |
| [x] T040 | `application::git` | Branche Git via exécuteur borné, argv fixe, cache 30 s et un job par cwd ; timeout 3 s, capture limitée pendant lecture. | Git absent/detached/échec = branche absente ; changement après TTL visible ; job bloqué annulé sans toucher un autre processus. D21. |
| [x] T041 | `application::events::watcher` | Watcher diff et transitions de notification ; pas de rafale initiale, panne de snapshot≠disparition ; identité précédente conservée si gone. | Apparition/changement inchangé/disparition/panne/rétablissement, working→blocked et blocked→gone vérifiés sur horloge fake. E01–E06. |
| [x] T042 | `application::events::journal` | Journal borné 500 événements/4 MiB, max événement 256 KiB ; IDs boot:seq ; publish/rattrapage/abonnement atomiques. | Trou, éviction par bytes, future cursor, ancien boot et legacy numeric provoquent un seul resync ; événement à la frontière replay/live ni perdu ni doublé. C11. |
| [x] T043 | `application::events::subscription` | Abonnements sans polling par client, 8 permis RAII, heartbeat 15 s, lag/fin/erreur bornés ; epochs et payloads historiques préservés. | Après 100 cycles connect/disconnect au repos : zéro tâche/permis orphelin ; 9e connexion refusée ; consommateur lent ne grossit pas la mémoire. C11. |
| [x] T044 | `notifications::store/vapid, files::atomic` | Store push compatible, VAPID import/env/génération, writer sérialisé et sauvegarde temp+flush+rename, permissions 0700/0600, migration legacy entière. | Clés et abonnements existants synthétiques inchangés ; fichier corrompu visible ; panne à chaque étape laisse ancien ou nouveau store valide ; paire env partielle refusée. C14. |
| [x] T045 | `notifications::payload/delivery` | Profils de payload métier et delivery worker (file 64, concurrence 4, délai 15 s, TTL 60 s), liens/tag waiting/done/gone, prune 404/410 versionné. | Faux service : offline/expire/timeout/réabonnement pendant envoi ; suppression ne retire pas un nouvel abonnement ; aucune livraison sous lock du store. E07–E09. |
| [x] T046 | `files::authorized_file/mime` | Fichiers via handles autorisés, roots de projets réévaluées, plafond 12 MiB, MIME/disposition exacts et longueur réellement servie. | Projet révoqué, fichier tronqué, lien échappant, SVG/téléchargement/texte/image/PDF et erreur détaillée couverts. S05–S07,C13. |
| [x] T047 | `files::scan` | Scan images commun confiné : profondeur 3, exclusions existantes, **400 images globalement**, 120 par répertoire, 60 rendues, concurrence 4. | Budget non dépassé en concurrence, ordre mtime stable, liens sortants jamais parcourus/listés, root inaccessible n'efface pas les autres. S08–S09,C13. |

## 5. HTTP, configuration et cycle de vie

| État / ID | Périmètre | Livrable précis | Preuve de fin |
|---|---|---|---|
| [x] T048 | `herdrchat::config` | Config immutable des 17 env, precedence existante, HOME/PATH injectés, bind IP autorisé, port strict, Serve status argv/timeout et origins normalisées. | Matrice CURRENT §8 ; 100.64/10 et fd7a:115c:a1e0::/48 seuls en tailnet, refus wildcard/public ; HTTPS443 supprimé, nondefault gardé ; aucun env lu dans les bibliothèques. C10. |
| [x] T049 | `http-api::router/extractors/origin` | Axum/extracteurs : méthodes GET/HEAD ou POST, origine, vrai body≤64 KiB même chunked, prompt UTF-8≤32 KiB, cache JSON et erreurs contrôlées. | Cas absent/étranger/mauvaise méthode/Content-Type/surtaille : 403/405+Allow/415/413 exacts ; aucune action avant validation ; `/api` inconnu = JSON404. C08–C09. |
| [x] T050 | `http-api::handlers::health/overview/conversations/sessions` | Brancher H01–H04 : santé, overview, conversations, sessions et tous leurs statuts/cursors/caughtUp. | Matrice HTTP du registre et corpus C02,C04,C12,C18 ; aucune exception SQLite non mappée, aucune lecture erronée remplacée par vide. |
| [x] T051 | `http-api::handlers::commands` | Brancher H05–H07,H10–H12 : prompt/stop/launch/answer/focus/trust vers les services ; TrustResolved comprend state. | Chaque succès/refus/inconnu/502/409/201 prévu validé ; capture du faux contrôle confirme cible et ordre, refus = zéro effet. C03,C05–C07,C17. |
| [x] T052 | `http-api::handlers::catalog/files/push/log` | Brancher H08–H09,H13,H15–H18 : kinds/models/log/VAPID/subscriptions/file/images avec corps JSON, texte, binaire et 204 exacts. | Les sept handlers respectent statuts/media/headers et erreurs ; clé privée absente des réponses/logs ; unsubscribe prioritaire si les deux formes sont reçues. |
| [x] T053 | `http-api::handlers::events` | Brancher H14 SSE : headers, ready/resync, 5 types de journal, ajout `session_changed` issu des seules observations de sources pour invalider le chat. | Client EventSource factice décode les anciens payloads ; nouvel event nommé validé/généré ; limite 503 ; cancellation de réponse ferme réellement l'abonnement. C11,C26. |
| [x] T054 | `herdrchat::assets, http-api::assets` | Provider d'assets embarqués du build PWA ; confinement, SPA, index/worker/manifest no-cache, MIME ; build de release impossible si assets manquent. | Binaire fixture lancé depuis cwd arbitraire sert index/asset/manifest ; aucun chemin disque arbitraire exposé ; unknown `/api` ne retombe pas sur HTML. O05–O07. |
| [x] T055 | `herdrchat::logging, application::diagnostics` | Logs/diagnostics : sink compatible, rotation 4 MiB/.1, suppression bornée avec compteur, redaction, erreurs sink vers stderr ; H13 connecté. | Injection d'erreur, message répétitif, disque refusé, rotation et fuite de secret testés ; commande ne devient pas un succès vide ou un échec à cause du logger. S10–S13. |
| [x] T056 | `herdrchat::main/composition/shutdown` | Composer daemon, workers et cancellation racine ; arrêt d'admission→drain limité 10 s→flush→close ; issue partielle tracée pour commandes encore en cours. | Faux processus : SIGINT/SIGTERM, socket indisponible, bind occupé, request disconnect ; zéro tâche/FD/worker persistant, aucun agent tué/fermé ni retry automatique. O01–O04. |

## 6. Frontend compatible et corrections existantes

| État / ID | Périmètre | Livrable précis | Preuve de fin |
|---|---|---|---|
| [x] T057 | `packages/shared, apps/web/src/api.ts` | Remplacer l'autorité active `packages/shared/src/api.ts` par la façade générée Rust, adapter imports/décodeurs et conserver helpers frontend utiles. Brancher caughtUp et nouveaux événements. | Aucun schéma HTTP manuel en double ; tests TS/Rust mêmes attentes ; contrat invalidé refusé par le vrai client. C01,C18,C26. |
| [ ] T058 | `apps/web/src/ChatScreen.tsx, conversation store` | Store conversation par pane+session : brouillon, pending/failed/unknown, cible capturée et retry immuable ; chargements annulables/génération ; séparer état des feuilles/questions. | UI montée fake : échec A→ouvrir B→retry n'appelle que A ; réponse tardive A n'écrit rien dans B ; timer 900 ms survit navigation ou rend explicitement le texte au bon brouillon. C19–C20. |
| [ ] T059 | `apps/web/src/App.tsx, api.ts` | Data client partagé : refresh en vol unique, ordre des réponses, résultats partiels indépendants, cadence visible/arrière-plan, resync immédiat sur nouvel EventSource ; drain caughtUp sans faux état frais. | 8 signaux simultanés = 1 refresh ; health en échec ne jette pas liste réussie ; ancien résultat ignoré ; retour foreground/fichier long reprend sans perte. C23,C26. |
| [x] T060 | `apps/web/src/main.tsx, vite.config.ts` | Mise à jour PWA différée : worker en attente, activation/reload explicites seulement sans brouillon ni action non résolue ; aucun stockage persistant de prompts ajouté. | Browser fake : nouvelle version pendant frappe/queue/inconnu ne recharge pas ; brouillon et état de livraison conservés ; update sûr fonctionne après résolution. C21. |
| [x] T061 | `apps/web/src/Markdown.tsx, ConversationRow.tsx` | Corriger rendu Markdown tables/listes et libellés des cinq statuts, idle affiché comme activité sans fausse fin. | Rendu réel de header/cellules/rows/listes imbriquées ; blocked dit attente, jamais working ; pas d'HTML script exécuté. C22. |
| [x] T062 | `apps/web/src/ChatScreen.tsx, Feuille.tsx` | Focus desktop seulement via action explicite ; conserver endpoint focus ; feuilles avec fond inert, clavier/Escape/restauration focus ; distinction connexion/contenu périmé. | Ouvrir/lire une conversation = zéro POST focus ; clic explicite = cible correcte ; navigation clavier/pointeur derrière feuille interdite ; pas de compteur non-lu inventé. C24–C25. |
| [x] T063 | `apps/web/src/ChatScreen.tsx, Blocks.tsx` | Isoler composeur et mémoïser fichiers/items par messages+statut ; garder ancre de scroll et signal nouveaux messages. Ne pas reconstruire tout l'historique à chaque touche. | 2 000 messages fake : une frappe ne réexécute ni normalisation ni calcul d'items/fichiers ; message reçu en lecture ancienne ne saute pas au bas ; keyboard viewport stable. C27. |

## 7. Validation globale et livraison au développeur/reviewer

| État / ID | Périmètre | Livrable précis | Preuve de fin |
|---|---|---|---|
| [ ] T064 | `tests par crate, compatibility/coverage.json` | Exécuter matrice de parité complète et corrections, tests négatifs sécurité/concurrence/propriétés, cinq profils et tous consommateurs des bases communes. Mettre coverage.json à jour. | 89 capacités + C01–C27 ont une preuve exécutée ; 18 routes conservées ; pas de test ignoré/remplacé par assertion de source ; gate peut échouer. |
| [ ] T065 | `benchmark harness, compatibility/results` | Benchmark TS/Rust mêmes fixtures et même hôte : 1/10/50 panes, 1/4/8 clients, 5 runs, cold/warm, delta32MiB/lockDB/SSE idle ; stocker commandes et médianes p50/p95/CPU/RSS/bytes/compteurs. | Latence p95, CPU et RSS Rust n'excèdent pas la référence dans ces charges ; au moins une mesure s'améliore ; 1 refresh/source partagé, 0 tâche orpheline et budgets respectés. Échec documenté bloque livraison, pas d'affirmation « plus rapide » sans mesure. |
| [ ] T066 | `xtask::release, release workflow` | Build release native avec PWA embarquée : macOS arm64/x86_64, Linux x86_64/aarch64 ; archives/checksums/licence, manifest de toolchain/deps/assets. Préparer formule/service sans les publier. | Chaque cible compile en CI ; tests sur runners natifs disponibles ; binaire fixture sans Bun/Node, SQLite bundlé, pas d'OpenSSL système implicite. Les plateformes non exécutées sont marquées compile-only, jamais « validées ». |
| [ ] T067 | `apps/web/tests, daemon fixture` | Scénarios navigateur contre daemon **fixture uniquement** : liste→chat→historique→question/trust→fichier→reconnexion→update ; tailles320×568/390×844/desktop et clavier simulé ; protocole iPhone installé pour revue humaine. | Captures/rapports locaux, tous appels vers contrôles factices ; aucun service réel/agent ciblé ; limitations de Safari physique indiquées sans prétendre les avoir testées automatiquement. |
| [ ] T068 | `apps/server, bin/herdrchat, release/docs` | Retirer le runtime backend TS du chemin build/release et les schémas devenus morts ; conserver uniquement le harnais de comparaison et les helpers frontend nécessaires. Mettre launcher/scripts/docs en cohérence native. | Release/serveur exécutables sans Bun/Effect côté backend ; tests encore utiles hors src ; aucun contrat en double ; harnais TS uniquement dev, non livré. |
| [ ] T069 | `workspace gates, EXECUTION.md` | Exécuter porte finale verrouillée et revue statique des dépendances/layout/artefacts/limites ; compléter EXECUTION et tableau de couverture. | `xtask verify`, contrôles frontend et builds ciblés verts ; working diff expliqué ; zéro tests src ; aucun secret/fixture utilisateur/ancien préfixe ; aucune tâche marquée faite sans résultat. |
| [ ] T070 | `release review / rollback docs` | Livrer dossier de revue et procédure de bascule/rollback : versions, arrêt de l'ancien propriétaire, sauvegarde store push, démarrage du nouveau, health/read checks et retour arrière. **Ne pas exécuter cette procédure.** | Reviewer a les 70 preuves, artefacts/checksums, limites connues, différences corrigées et commandes exactes ; toute publication/bascule attend une nouvelle instruction utilisateur. |

## Couverture des corrections

| Correction | Tâches qui la livrent |
|---|---|
| C01 Autorité de contrat unique | T007–T009,T057,T068 |
| C02 Lignes partielles/offsets | T014,T025–T027 |
| C03 Réponse trust complète | T033,T051 |
| C04 Erreurs de lecture masquées | T010,T050 |
| C05 Preuve de prompt | T013,T035,T051 |
| C06 Déduplication atomique par pane | T034–T035 |
| C07 Validation/nom/deadline/nettoyage lancement | T030,T037,T051 |
| C08 Méthodes et /api inconnu | T049,T054 |
| C09 Taille réelle des corps | T049 |
| C10 Bind/origines/port | T048 |
| C11 SSE cancellation/replay/restart | T042–T043,T053 |
| C12 Curseur lié à la source | T024–T025,T050 |
| C13 Chemins/descripteurs/scan | T011,T046–T047 |
| C14 Store push atomique | T044–T045 |
| C15 Index Codex numérique | T023 |
| C16 Politique intégrations cohérente | T031,T037 |
| C17 Vérification question/confiance | T032–T034 |
| C18 Forward borné et caughtUp | T025,T050,T057,T059 |
| C19 Actions UI vers mauvaise cible | T058 |
| C20 Réponse async UI périmée | T058–T059 |
| C21 Update PWA destructif | T060 |
| C22 Tables/listes/statuts erronés | T061 |
| C23 Refresh redondant et erreurs couplées | T038–T039,T059 |
| C24 Focus desktop implicite | T036,T062 |
| C25 Accessibilité des feuilles | T062,T067 |
| C26 Polling chat remplacé par invalidation + reprise | T027,T053,T057,T059 |
| C27 Travail historique à chaque frappe | T063,T065 |

## Couverture de toutes les capacités existantes

Ce tableau fixe les propriétaires à reporter dans coverage.json à T001 ; T064 valide chaque cas, T069 la complétude. Une plage inclut ses deux bornes.

| Capacités CURRENT | Tâches de livraison |
|---|---|
| O01–O04 / O05–O07 / O08–O10 | T056 / T054 / T066,T068–T070 |
| H01–H04 / H05–H07,H10–H12 / H08–H09,H13,H15–H18 / H14 | T050 / T051 / T052 / T053 |
| D01–D05 | T005,T023,T038–T039 |
| D06–D10 | T011,T014–T015,T017,T023–T024 |
| D11 / D12–D13 / D14 / D15 / D16 | T018 / T019 / T020 / T021 / T022 |
| D17 / D18–D20,D22 / D21 | T015,T021–T022 / T026–T027,T039 / T040 |
| A01–A03 / A04–A05 / A06 / A07–A08 | T035 / T036 / T013,T031 / T037 |
| A09–A12 / A13 / A14–A15 | T032–T034 / T028–T029,T031 / T030 |
| E01–E03,E06 / E04 / E05 | T041 / T042 / T043,T053 |
| E07,E09 / E08,E10 | T045 / T044 |
| S01–S03 / S04 / S05–S07 / S08–S09 | T048–T049 / T011,T014–T015 / T046 / T047 |
| S10–S13 / S14 | T010,T055 / T003–T004,T006,T064 |

## Critère de sortie

Les 70 tâches sont livrées et prouvées, les bases communes ont passé tous leurs profils, l'API et les données utilisateur sont préservées sauf corrections explicites, et aucun test ne réside sous src. Le résultat est **prêt pour revue et décision de déploiement** ; cette checklist ne constitue pas une autorisation de déployer.
