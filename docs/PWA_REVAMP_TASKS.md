# Herdr Remote — PWA revamp task list

> **Objectif.** Refondre la PWA (`apps/web`) pour la rendre **maintenable, évolutive et à jour**, en exploitant pleinement le framework **Effect** (services, streams, fibers, layers, erreurs typées, resources) et en ajoutant une **couche d'animation professionnelle** (Motion, View Transitions, springs, micro-interactions). Sans réécriture big-bang : chaque phase livre de la valeur indépendamment et l'application ne s'arrête jamais de fonctionner.

> **Source normative.** Ce document complète `docs/RELEASE_BACKLOG.md` (backlog de release) et `docs/IDEAS.md` (évolutions proposées). Les IDs `R*` renvoient au backlog, `I*` aux idées, `T*` aux tâches historiques. Les capacités non exposées par la source restent `inconnu`.

> **Règle.** Aucune tâche ne démarre tant que la porte de la tâche dont elle dépend n'est pas verte. `Fait` exige la preuve indiquée, avec cas passant et cas qui doit échouer.

---

## 0. Conventions et portes

- **Ordre.** Les phases sont numérotées ; une phase N+1 ne démarre pas avant la porte de la phase N verte, sauf mention explicite.
- **Portes (G).** G0 = décomposition verte, G1 = service layer Effect verte, G2 = état consolidé, G3 = animation/polish vert, G4 = release validée.
- **Preuve.** Chaque tâche se termine par `bun run verify` vert **et**, pour les tâches UI, une capture ou une mesure sur les tailles 320×568 et 390×844.
- **Interdiction.** Aucun test sous `src/`. Aucun `as` non justifié. Aucune dépendance sans version exacte. Aucun succès d'action anticipé (D007.2).
- **Accessibilité.** `prefers-reduced-motion` respecté partout. Zones tactiles ≥ 44×44 px. Contraste texte normal ≥ 4,5:1.
- **Performance.** Bundle initial ≤ 200 Ko gzip. Première interaction utile ≤ 1,2 × référence P01. Aucun layout shift visible au chargement.

---

## 1. Phase 0 — Arrêter le saignement (décomposition et fondations)

> **Porte G0.** `App.tsx` < 200 lignes, chaque écran dans son module, un seul propriétaire de route/SSE/overview, bundle code-splitté, tokens extraits. Aucun changement de comportement.

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| P0.1 | — | **Extraire `AppShell`.** Créer `apps/web/src/AppShell.tsx` qui est le **seul** propriétaire de la route, du flux SSE et de l'overview. `App.tsx` ne fait que rendre `<AppShell />`. | `App.tsx` < 30 lignes ; `AppShell` < 250 lignes ; tests existants verts ; aucun fetch dans `App.tsx`. |
| P0.2 | P0.1 | **Extraire `ConversationList`** (écran liste + sections + recherche + tri + groupement). | Module autonome avec props typées ; rendu identique capturé à 390×844 ; tests de sections inchangés. |
| P0.3 | P0.1 | **Extraire `ProjectDetail`** (détail projet, liste de conversations, action « Nouvel agent »). | Module autonome ; navigation projet → chat → retour conservée ; tests de routing verts. |
| P0.4 | P0.1 | **Extraire `ChatView`** (en-tête, historique, composeur, feuilles, trust card). | Module autonome ; brouillon et position conservés au retour ; tests de chat verts. |
| P0.5 | P0.1 | **Extraire `SettingsView`** (réglages, thème, préférences). | Feuille derrière engrenage ; aucune route dédiée ; tests de préférences verts. |
| P0.6 | P0.2–P0.5 | **Code splitting.** `React.lazy` + `Suspense` pour `ChatView`, `ProjectDetail`, `Viewer`, `Markdown`/`Blocks`. | `vite build` produit ≥ 4 chunks ; bundle initial ≤ 200 Ko gzip ; aucune régression de rendu. |
| P0.7 | — | **Extraire les tokens.** Créer `apps/web/src/tokens.css` avec couleurs, espacements, rayons, durées de motion, typographie. `styles.css` consomme les variables. | Aucune valeur hexadécimale ni px magique dans les composants ; `contrast.test.ts` vert ; rendu identique. |
| P0.8 | P0.7 | **Extraire les services (interfaces).** Créer `apps/web/src/services/` avec `HerdrClient`, `SessionService`, `EventStream`, `DraftStore`, `PreferencesStore`, chacun une interface TypeScript. Déplacer tous les `fetch` hors des composants vers une implémentation `services/http.ts`. | Zéro `fetch` dans `src/*.tsx` ; composants dépendent des interfaces ; tests passent avec un faux client injecté. |
| P0.9 | P0.8 | **Porte G0.** Vérification : `App.tsx` < 200 lignes, `AppShell` < 250, bundle ≤ 200 Ko gzip, `bun run verify` vert, captures 320/390 identiques. | Rapport dans `docs/RELEASE_EVIDENCE.md` (section G0). |

---

## 2. Phase 1 — Effect comme couche de service

> **Porte G1.** Tous les appels réseau passent par Effect (`HttpClient`, `Stream`, `Fiber`, `Layer`). Les erreurs sont typées. Le flux SSE est un `Stream`. La boucle de rafraîchissement est un `Fiber` interruptible. Les tests swappent la layer.

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| P1.1 | P0.8 | **Ajouter `@effect/platform` et `@effect/react`.** Épingler les versions exactes dans `apps/web/package.json`. | `bun install` vert ; `bun run typecheck` vert ; aucune version flottante. |
| P1.2 | P1.1 | **Client HTTP Effect.** Implémenter `HerdrClientLive` avec `HttpClient` et `HttpClientRequest`. Chaque route renvoie `Effect<A, E>` avec `E = Data.TaggedError` (`NetworkError`, `HttpError`, `DecodeError`, `TimeoutError`). | Un test injecte une erreur HTTP 500 → `HttpError` typé, pas une string ; un test timeout → `TimeoutError`. |
| P1.3 | P1.2 | **Schema à la frontière.** Appliquer `Schema.decode` sur chaque réponse. Échec de décodage → `DecodeError` avec le champ fautif nommé. | Fixture invalide → `DecodeError` nommant le champ ; fixture valide → valeur typée. |
| P1.4 | P1.1 | **SSE comme `Stream`.** Remplacer `EventSource` manuel par un `Effect.Stream` alimenté par la connexion SSE. Exposer `Stream` des 5 événements + `ready`/`resync`. | Test : 3 événements rapprochés → 1 émission après debounce ; interruption du stream ferme la connexion (vérifié par compteur). |
| P1.5 | P1.4 | **Coalescing déclaratif.** Remplacer le regroupement manuel 150 ms / 120 ms par `Stream.debounce` + `Stream.groupedWithin`. | Test avec `TestClock` : 5 événements en 50 ms → 1 relecture ; 1 événement isolé → 1 relecture après le délai. |
| P1.6 | P1.1 | **Boucle de rafraîchissement = Fiber.** Remplacer la cascade `setTimeout` par un `Fiber` tournant sur `Schedule.spaced` (4 s visible, 60 s caché, 30/120 s en mode SSE). Interruption propre au démontage. | Test : démontage du composant interrompt le fiber (vérifié par compteur de vols = 0 après) ; retour premier plan relance immédiatement. |
| P1.7 | P1.1 | **Retry et timeout.** `Effect.retry` avec `Schedule.exponential` (max 3 tentatives) sur erreurs réseau ; `Effect.timeout` 20 s sur le catalogue. | Test : 2 échecs puis succès → 3 appels ; 3 échecs → erreur typée ; timeout → `TimeoutError`. |
| P1.8 | P1.1 | **Resources.** `Effect.acquireRelease` pour la connexion SSE, les handles de fichier, les abonnements. Garantir le cleanup même en cas d'erreur. | Test : erreur en cours de stream → la connexion est fermée (compteur de connexions actives = 0). |
| P1.9 | P1.2–P1.8 | **Injection de dépendances.** `Layer` + `Context` : `HerdrClientLive`, `HerdrClientTest` (in-memory, scriptable). Composants obtiennent les services via `useRuntime` (`@effect/react`). | Test avec `HerdrClientTest` : zéro réseau ; test avec `Live` : réseau réel ; swap en une ligne. |
| P1.10 | P1.9 | **Porte G1.** `bun run verify` vert ; zéro `fetch` direct restant ; zéro `setTimeout` pour le rafraîchissement ; captures identiques. | Rapport dans `docs/RELEASE_EVIDENCE.md` (section G1). |

---

## 3. Phase 2 — Consolidation de l'état

> **Porte G2.** Un seul `SubscriptionRef<AppState>` ; composants s'abonnent à des slices ; brouillons/envois/scroll vivent dans le store ; zéro `useState` pour l'état métier dans `AppShell`.

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| P2.1 | P1.9 | **Définir `AppState`.** Un type unique : `route`, `overview`, `health`, `conversations`, `drafts`, `envois`, `scrollMemory`, `preferences`, `connectionStatus`. | Type exporté et documenté ; aucune duplication de ces champs ailleurs. |
| P2.2 | P2.1 | **`SubscriptionRef<AppState>`.** État réactif Effect-native. Mises à jour via `SubscriptionRef.update`. Dérivations via `Stream` (ex. `conversationsFiltrees`). | Test : mise à jour de `conversations` → les abonnés reçoivent la nouvelle valeur ; les non-abonnés ne re-render pas. |
| P2.3 | P2.2 | **Migrer `overview`/`health`/`conversations`.** Sortir du `useState` de `AppShell` vers le store. | `AppShell` ne contient aucun `useState` pour ces trois champs ; tests de rafraîchissement verts. |
| P2.4 | P2.2 | **Migrer `drafts` et `envois`.** Brouillons et états d'envoi vivent dans le store, indexés par `paneId`. | Test : réponse tardive de A n'écrit rien dans B (C19/C20) ; brouillon survit à la navigation. |
| P2.5 | P2.2 | **Migrer `scrollMemory` et `preferences`.** | Test : retour sur une conversation restaure la position ; préférence persistée dans `localStorage` via le store. |
| P2.6 | P2.3–P2.5 | **Slices et sélecteurs.** Chaque composant s'abonne à son slice via un hook `useSlice(selecteur)`. Re-render uniquement si le slice change (comparaison structurelle). | Test : mise à jour d'un champ non lié → le composant ne re-render pas (compteur de render). |
| P2.7 | P2.6 | **Porte G2.** `AppShell` < 150 lignes ; zéro `useState` métier ; tests de rafraîchissement/envois/scroll verts ; captures identiques. | Rapport dans `docs/RELEASE_EVIDENCE.md` (section G2). |

---

## 3. Phase 3 — Animation et polish professionnel

> **Porte G3.** Couche de motion complète : Motion, View Transitions, springs, micro-interactions, `prefers-reduced-motion`. Chaque interaction clé animée. 60 fps sur iPhone 12.

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| P3.1 | P0.7 | **Ajouter Motion (Framer Motion).** Épingler la version. Créer `apps/web/src/motion.ts` avec les variants partagés (`fade`, `slide-up`, `slide-in-right`, `scale-in`). | `bun run build` vert ; bundle motion code-splitté ; aucune erreur TS. |
| P3.2 | P3.1, P0.2 | **Liste : entrée/sortie des lignes.** `AnimatePresence` + `motion.li` avec `layout` pour le réordonnancement. Durée ≤ 200 ms. | Capture vidéo : les lignes apparaissent/disparaissent sans saut ; `prefers-reduced-motion` désactive l'animation. |
| P3.3 | P3.1, P0.4 | **Chat : apparition des messages.** Nouveau message → fade + slide-up léger (8 px). Code repliable → hauteur animée. | Capture : le message arrive sans pousser brutalement ; pas de scroll forcé si l'utilisateur lit l'historique. |
| P3.4 | P3.1, P0.1 | **Feuilles (sheets).** Slide-in depuis le bas (mobile) / depuis la droite (desktop large), backdrop fade, focus trap conservé, fermeture par swipe-down ou Escape. | Test tactile : swipe-down ferme ; Escape ferme ; focus restauré à l'élément déclencheur. |
| P3.5 | P3.1 | **Micro-interactions.** Bouton d'envoi : scale 0.95 au press, retour spring. Badge de statut : transition de couleur (200 ms). Carte de confiance : approve/reject avec feedback visuel. | Capture : chaque interaction répond en < 100 ms visuellement ; aucune animation bloquante. |
| P3.6 | P3.1 | **View Transitions.** Route liste ↔ chat ↔ projet via `document.startViewTransition` + `startTransition`. Fallback gracieux si non supporté. | Sur Safari 18+ : transition fluide ; sur navigateur sans support : navigation instantanée, pas d'erreur. |
| P3.7 | P3.1 | **Indicateur de chargement.** Squelette (skeleton) pour liste et chat pendant le chargement initial, avec shimmer subtil. Remplace le spinner seul. | Capture : le squelette apparaît immédiatement, puis se remplace par le contenu sans saut. |
| P3.8 | P3.1 | **Animations orchestrées (launch).** Séquence create → start → detect → open avec étapes visuelles et annulation si navigation. Piloté par Effect (Fiber annulable). | Test : annulation pendant l'étape 2 → aucune étape suivante exécutée ; l'UI revient à l'état initial. |
| P3.9 | P3.2–P3.8 | **Respect de `prefers-reduced-motion`.** Hook `useReducedMotion()` ; toutes les animations désactivées ou réduites à une opacité simple. | Test : avec `prefers-reduced-motion: reduce`, aucune transform/translate n'est appliquée ; seules les opacités restent. |
| P3.10 | P3.9 | **Porte G3.** 60 fps sur iPhone 12 (mesuré via Performance panel) ; aucune animation > 300 ms ; Lighthouse Performance ≥ 90 ; captures 320/390. | Rapport dans `docs/RELEASE_EVIDENCE.md` (section G3). |

---

## 4. Phase 4 — Modernisation et DX

> **Porte G4 (partielle).** Dépendances à jour, bundle optimisé, tests déterministes, lint strict.

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| P4.1 | — | **Mettre à jour Effect.** Vérifier la dernière version 4.x stable. Mettre à jour `@effect/react`, `@effect/platform`, `@effect/platform-browser` si disponibles et stables. | `bun run verify` vert ; aucune régression ; changelog lu et breaking changes traités. |
| P4.2 | P1.5 | **Tests déterministes.** Remplacer les `setTimeout`-based tests par `TestClock` d'Effect pour les coalescings et la boucle de rafraîchissement. | Tests passent sans `setTimeout` réel ; durée d'exécution des tests de timing < 100 ms. |
| P4.3 | P0.6 | **Analyse de bundle.** `vite-bundle-visualizer` ou équivalent. Identifier les gros modules. Lazy-load `marked`, `Viewer`, `Blocks` lourds. | Bundle initial ≤ 150 Ko gzip ; aucun module > 50 Ko dans le chunk initial. |
| P4.4 | P0.7 | **Lint strict.** Activer `no-floating-promises`, `no-misused-promises`, règles Effect si disponibles. Corriger toutes les violations sans désactiver de règle. | `bun run lint` vert avec 0 warning ; aucune règle désactivée. |
| P4.5 | — | **Format et conventions.** `oxfmt` sur tout ; vérifier `.oxfmtrc.json` ; ajouter un hook pre-commit (`scripts/verify.sh`). | `bun run format:check` vert ; hook bloque un commit non formaté. |
| P4.6 | P4.3 | **Service worker optimisé.** Précacher uniquement le shell ; lazy chunks chargés à la demande. Vérifier `workbox` config. | `sw.js` < 50 Ko ; Lighthouse PWA ≥ 90. |
| P4.7 | — | **TypeScript strict maximal.** Activer `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (déjà), `noPropertyAccessFromIndexSignature`. | `bun run typecheck` vert ; aucune assertion `as` non justifiée. |

---

## 5. Phase 5 — Complétude fonctionnelle (idées à forte valeur)

> **Sources.** `docs/IDEAS.md` §3 et §4. Aucune de ces fonctionnalités n'est implémentée aujourd'hui. Les données sources sont déjà disponibles dans les sessions Pi.

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| P5.1 | P2.2, P3.2 | **File d'attention (I3.1).** Sur l'écran Conversations, pour chaque agent `blocked`, afficher le dernier message assistant (ce qu'il demande) + réponses rapides (`oui` / `non` / `continue`) + champ libre. Envoi via `agent.prompt`. | Test : agent blocked → la question est affichée ; toucher « oui » → prompt envoyé ; confirmation/erreur/inconnu affichés. |
| P5.2 | P2.2, P3.2 | **Cartes sous-agents (I3.2).** Parser `toolResult.details` (mode `single`/`parallel`) et afficher une carte par sous-agent : agent, modèle, statut, fichiers modifiés, résumé, auto-vérification, questions ouvertes. Les deux statuts divergents (`status` vs `digest.status`) affichés tels quels. | Test : fixture avec 4 sous-agents → 4 cartes ; statuts divergents visibles ; aucune promesse de transcript. |
| P5.3 | P2.2 | **Fichiers touchés (I3.3).** Agréger `edit`/`write`/`digest.filesChanged` par agent et par projet. Vue « Fichiers » dans la feuille Chat et dans le détail projet. | Test : fixture avec 5 fichiers → liste groupée ; clic sur un fichier → visionneuse. |
| P5.4 | P2.2 | **Coûts et tokens (I3.4).** Agréger `message.usage` par projet, agent, modèle, jour. Vue dans les réglages ou un tableau de bord dédié. | Test : fixture avec 10 messages → totaux corrects ; aucune donnée inventée si `usage` absent. |
| P5.5 | P2.2 | **Depuis ta dernière visite (I3.5).** Marqueur de lecture par session stocké localement. Au retour, n'afficher que ce qui a bougé (badge « nouveau »). | Test : marquer lu → recharger → pas de badge ; nouveau message → badge. |
| P5.6 | P2.2 | **Reprendre ailleurs (I3.6).** Bouton « reprendre sur le Mac » utilisant `resume_argv` fourni par Herdr. Afficher la commande, copier, ou exécuter après confirmation. | Test : `resume_argv` présent → bouton visible ; absent → bouton absent (pas d'invention). |
| P5.7 | P2.2 | **Compaction et points de reprise (I3.7).** Marquer dans l'historique les `context_edit` et `compaction` (60/4 mesurés). Afficher un séparateur avec la raison. | Test : fixture avec compaction → séparateur visible avec libellé. |
| P5.8 | P2.2, P1.2 | **Recherche dans toutes les sessions (I3.8).** Recherche côté serveur (les sessions font jusqu'à 12 Mo). Endpoint `GET /api/search?q=...`. Résultats avec lien vers la conversation et le message. | Test : requête « foo » → résultats avec `paneId` et offset ; requête vide → 400 ; requête trop longue → 413. |
| P5.9 | P5.1–P5.8 | **Regroupement des appels d'outils (I4).** « 12 lectures de fichiers » au lieu de 12 lignes. Replier les sorties d'outil par défaut. | Test : 5 `read` consécutifs → un groupe « Read files ×5 » ; dépli → détail. |
| P5.10 | P5.1–P5.9 | **Brouillon persistant (I4).** Le brouillon survit à la fermeture de l'app et au changement de réseau (déjà partiellement — vérifier la persistance locale). | Test : saisir un brouillon → fermer → rouvrir → brouillon présent. |
| P5.11 | P5.1–P5.10 | **Densité réglable (I4).** Réglage compact/confortable dans les préférences. | Test : changer la densité → classes CSS appliquées ; persistance. |

---

## 6. Phase 6 — Validation et release

> **Porte G4.** Toutes les portes précédentes vertes + validation physique + perf mesurée + documentation alignée.

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| P6.1 | P3.10, P4.3 | **Mesurer P01 (baseline).** Session Pi synthétique 1,8 Mo. 20 chargements froids à 390×844. Relever taille initiale, octets d'un rafraîchissement inactif, p95 « ouverture Chat → premier message visible ». | `docs/RELEASE_EVIDENCE.md` avec fixture, méthode, environnement, référence chiffrée. |
| P6.2 | P6.1, P2.7, B02, B11 | **Mesurer P02 (après refonte).** Mêmes 20 mesures. Comparer à P01 et aux bornes du tableau (512 Ko init, 1 Ko inactif, p95 ≤ 1,2×). | p95 ≤ 1,2× ; init ≤ 512 Ko ; inactif ≤ 1 Ko ; écart expliqué si dépassement. |
| P6.3 | — | **Activer Tailscale Serve (admin).** HTTPS `:8790` → `127.0.0.1:<port>`. Vérifier grants/ACL : appareil autorisé joint, appareil exclu ne joint pas. | `tailscale serve status` montre la cible ; test depuis deux appareils. |
| P6.4 | P6.3, P3.10 | **Validation iPhone physique.** Installer la PWA, ouvrir une conversation, envoyer, suivre la réponse, reprendre sur le Mac. Sans SSH, sans modification de `$HOME`. | 6 étapes passées ; captures ; zéro P0/P1 ouvert. |
| P6.5 | P6.4 | **T067 (scénarios navigateur).** Liste → chat → historique → question/trust → fichier → reconnexion → update. Tailles 320×568/390×844/desktop. | Captures et rapports locaux ; tous appels vers contrôles factices. |
| P6.6 | P6.5 | **T072 (matrice états × surfaces).** Pour chaque couple surface × état : rendu attendu décrit et vérifié. | Rapport complet ; aucune surface sans chemin de rendu pour un état réel. |
| P6.7 | P6.6 | **T069 (porte finale).** `xtask verify`, contrôles frontend, builds ciblés verts. Working diff expliqué. Zéro test sous `src`. | Rapport final dans `EXECUTION.md`. |
| P6.8 | P6.7 | **Documentation (R01).** Aligner README et guides : installation, sécurité, API, limites, mise à jour, dépannage. | Installation propre avec les commandes écrites ; chaque route/option/limite documentée existe. |
| P6.9 | P6.8 | **LICENSE et documents (F05).** PolyForm-Noncommercial-1.0.0, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT. | SPDX conforme ; README lie les documents. |

---

## 7. Cross-cutting — accessibilité, performance, tests

| ID | Travail exact | Preuve de fin |
|---|---|---|
| PX.1 | **Accessibilité complète.** Parcours clavier/lecteur d'écran sur tous les écrans. `aria-live` pour les changements de statut. Focus visible. | Audit avec `audit` skill ; zéro violation axe-core. |
| PX.2 | **`prefers-reduced-motion`.** Désactiver ou réduire toutes les animations. | Test avec media query simulée ; aucune transform sans réduction. |
| PX.3 | **Contraste.** Vérifier 4,5:1 sur tous les textes (tokens + composants). | `contrast.test.ts` étendu à tous les composants ; zéro échec. |
| PX.4 | **Performance runtime.** 60 fps sur iPhone 12 pour scroll liste et chat. Pas de layout shift au chargement. | Mesure Performance panel ; CLS < 0,1 ; LCP < 2,5 s. |
| PX.5 | **Tests de composants.** Ajouter `@testing-library/react` pour les composants clés (ChatView, ConversationList, LaunchSheet). | ≥ 20 tests de composants ; rendu + interaction. |
| PX.6 | **Tests de régression visuelle.** Captures de référence à 390×844 pour les 4 écrans principaux. | Diff de capture détecte un changement non intentionnel. |

---

## 8. Récapitulatif des portes

| Porte | Phase | Bloque |
|---|---|---|
| G0 | 1 | Phase 1 (Effect) |
| G1 | 2 | Phase 2 (état) |
| G2 | 3 | Phase 3 (animation) |
| G3 | 4 | Phase 4 (DX) + Phase 5 (features) |
| G4 | 6 | Release |

## 9. Ce qui est explicitement hors périmètre

- **Terminal.** Retiré (U13). Pas de réintroduction.
- **Sous-agents : transcript complet.** N'existe pas localement (IDEAS §2). On affiche le résumé structuré, pas la conversation.
- **Notifications sans HTTPS.** Bloquées par l'absence de Serve. Pas de contournement promis.
- **Streaming token-by-token.** Bloqué sur Herdr/agents (voir discussion). Pas dans ce plan.
- **Authentification applicative.** Hors périmètre (D02 : usage personnel, tailnet).

## 10. Ordre recommandé d'exécution

1. **Phase 0** (décomposition) — prérequis de tout le reste.
2. **Phase 1** (Effect service layer) — le plus gros gain de maintenabilité.
3. **Phase 2** (état consolidé) — dépend de Phase 1.
4. **Phase 3** (animation) — peut démarrer en parallèle de Phase 2 pour les composants déjà extraits.
5. **Phase 4** (DX) — en continu.
6. **Phase 5** (features IDEAS) — après G2, par ordre de valeur (P5.1 en premier).
7. **Phase 6** (validation et release) — en dernier, avec appareil physique.

> **Règle finale.** Chaque phase livre une application qui fonctionne et qui est testée. Aucune phase ne casse la précédente. Si une tâche bloque, on la documente dans `EXECUTION.md` et on continue avec les tâches indépendantes — on ne masque jamais un échec.