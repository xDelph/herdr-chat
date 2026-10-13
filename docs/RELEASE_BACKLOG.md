# Herdr Remote — backlog de release

> Actif au 11/10/2026. Consolide l'audit, la publication du code source et la refonte mobile inspirée de [T3 Code Mobile](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824). `TASKS.md` conserve l'historique du MVP. D02 et D04 sont décidées ; U01/U02 sont entamées, mais aucune tâche d'implémentation ci-dessous n'a sa preuve de fin. Préserver les changements de code non committés.

## Contrat commun

- **Produit :** PWA iPhone centrée sur Conversations → Projet → Chat. Navigation `Conversations · Projets · Réglages`. `À traiter` est une section de Conversations. Aucun terminal dans l'interface ni l'API publique de release.
- **Sources :** Herdr fournit contrôle et statut ; les sessions Pi fournissent contenu et rattrapage. Une capacité est exposée seulement après vérification de son fonctionnement. Un état non vérifié reste `inconnu`.
- **Contrat HTTP :** `packages/shared/src/api.ts` est l'unique schéma des requêtes/réponses. Modifier le schéma avant ses deux consommateurs ; valider les réponses serveur contre lui.
- **Accès personnel :** aucune authentification applicative en V1. Le serveur de release écoute sur `127.0.0.1` ; Tailscale Serve expose la PWA au tailnet personnel selon ses grants/ACL. Aucune route API n'a de droit distinct selon le client ; voir `docs/SECURITY_MODEL.md`.
- **Isolation :** tests avec transport simulé et fichiers temporaires. Aucun agent de l'utilisateur comme cible. Si Herdr réel est indispensable, créer puis fermer un pane jetable. Les JSONL Pi restent en lecture seule.
- **Exécution :** chaque dépendance bloque la tâche. `Fait` exige la preuve indiquée sur le code retenu pour la release, avec cas passant et cas qui doit échouer. Les statuts de l'ancien `TASKS.md` ne prouvent aucune tâche ci-dessous.
- **Gravité :** `P0` = accès non autorisé, perte/corruption de données ou action sur le mauvais agent ; `P1` = parcours iPhone principal bloqué, faux succès ou contenu perdu au rattrapage.
- **Priorité de risque :** `P0` = S01–S05, B05–B08 ; `P1` = F03, F04, F06, S06, B01–B04, B10, B11, U04–U13, P02, R02 ; `P2` = autres tâches. Cette priorité ne remplace pas les dépendances.

### Règles déjà tranchées

| Sujet | Contrat exact |
|---|---|
| Accueil | Un pane apparaît **une fois** : `À traiter` si `blocked`, `En cours` si `working`, `Récents` sinon. Dans chaque section : dernier message Pi décroissant, absence d'horodatage en dernier, puis `paneId` croissant. |
| Identité | Titre = premier non vide parmi titre Herdr, libellé d'onglet, libellé de projet, `paneId`. Aperçu facultatif = dernier message texte Pi. Aucun titre, extrait ou horodatage inventé. |
| Lecture Pi | Chargement initial : fin de fichier ≤ **512 Kio**. Suite : ≤ **512 Kio** par réponse. Curseur opaque = `dev`, `ino`, offset **après le dernier saut de ligne complet**. Une ligne partielle n'avance pas l'offset. |
| Reprise Pi | Changement `dev:ino` ou fichier plus court que l'offset → `reset: true` ; le client remplace la vue après rechargement. Ligne unique >512 Kio → erreur explicite. |
| Ressources | JSON ≤ **64 Kio** ; prompt UTF-8 ≤ **32 Kio** ; fichier de projet ≤ **12 Mio** ; ≤ **8** flux SSE et **4** lectures de sessions simultanés. Dépassement → erreur explicite avant action Herdr. |
| Modèles | Une commande de catalogue par type à la fois ; délai **20 s** ; stdout ≤ **2 Mio**, stderr ≤ **64 Kio** ; succès en cache **60 s**. Échec et timeout ne sont pas mis en cache comme succès. |
| Lancement | « Nouvel agent » est une action explicite, disponible aussi dans un projet ayant déjà un agent. Elle crée un nouvel onglet ; nom unique, dossier du projet et type installé validés avant création. Aucun second agent n'est lancé automatiquement. Cette règle remplace le refus historique de D015.3. |
| Performance réseau | Sur une fixture **synthétique** de 1,8 Mo reproduisant la taille mesurée en D012.3, une lecture initiale est bornée à 512 Kio et un rafraîchissement sans nouveau message à 1 Kio ; aucune relecture/transmission intégrale. Le polling de secours ne dépasse pas un appel par 2,5 s et par chat actif. P01/P02 fixent et contrôlent le budget de rendu. |
| Écrans | Portrait **320×568, 375×667, 390×844, 430×932** ; paysage ; Safari et PWA installée ; clavier ouvert sur Chat. Zone tactile ≥ **44×44 px** ; contraste texte normal ≥ **4,5:1**. |

Une mesure justifiant une autre valeur impose de modifier ce tableau, le contrat partagé et les vérifications associées dans le même changement.

### Ordre d'exécution

Les sections classent les travaux par thème, pas par ordre. **Chemin critique backend :** (F03 + A03) → A01 → S03 → B01 → B02 → B03 → B10 → B11 → U04. **Chemin critique UX :** U01 → U02 → D03 → U03 → A02 → U04/U05/U07 → U10 → U11 → U12. D01 (licence) est indépendant de ces chemins et peut être clos en parallèle ; il bloque F05 puis R01. P01 relève la référence de performance avant la refonte et P02 la compare après. Le serveur et le client sont extraits **une fois avant** la réécriture des mêmes modules.

## 0 — Décisions et socle

Les tâches `D` sont des portes de décision : l'agent prépare les options, **le propriétaire choisit**. Les tâches dépendantes attendent son choix.

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| D01 | — | Confirmer `PolyForm-Noncommercial-1.0.0`, le titulaire des droits et la date ; documenter les usages autorisés et la voie de licence commerciale séparée. | Choix confirmé, SPDX et titulaire dans `docs/DECISIONS.md` ; terminologie « code source public » dans les textes de release. |
| D02 | — | **Décidé :** usage personnel via Tailscale Serve, sans authentification applicative ni rôles. Écrire `docs/SECURITY_MODEL.md` : routes, frontière de confiance, limites et échecs d'accès. | Décision datée ; aucun texte de release ne promet d'identité ou d'autorisation vérifiée par l'application. |
| D04 | — | **Décidé :** formule du service autonome dans un tap Homebrew personnel. Consigner installation, démarrage, arrêt, mise à jour et désinstallation ; plugin Herdr facultatif après preuve de cycle de vie. | Décision datée dans `docs/DECISIONS.md` ; aucune dépendance de la PWA au plugin. |
| F01 | — | Aligner `HERDR_REMOTE_SPEC.md` et l'en-tête de `TASKS.md` : trois destinations, SSE, Serve HTTPS désormais actif (`:8790` → loopback `:8791` observé le 11/10), terminal exclu. | Aucun passage normatif applicable à la release ne prescrit l'ancienne navigation, WebSocket, un Serve indisponible ou le terminal ; cible Serve et port effectif revérifiés pour la release. |
| F02 | — | Documenter les versions macOS, Bun, Node, Herdr et Pi effectivement vérifiées. | Table version/commande/résultat ; protocole Herdr incompatible → erreur explicite ; aucune version non vérifiée annoncée supportée. |
| F03 | — | Corriger `apps/server/package.json` (`src/main.ts`), ajouter scripts racine de démarrage/développement et cibler dans Vite le même port backend configuré. | Démarrage depuis la racine puis `/api/health` via Vite → 200 sans édition de fichier ; le port local choisi est documenté séparément du port HTTPS Serve. |
| F04 | F03 | Ajouter le build PWA au script `verify` de `package.json`, puis CI macOS avec versions épinglées et lockfile figé. | `bun run verify` exécute format, lint, types, tests **et build** ; CI fait installation figée puis `verify` ; une sonde cassée par porte échoue, puis retour au vert sans sonde. |
| F05 | D01 | Ajouter `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` et politique de versions. | SPDX conforme à D01 ; README lie les documents ; signalement et procédure de release décrits. |
| F06 | D04, F03 | Préparer une formule dans le tap Homebrew personnel qui installe le build figé et expose `brew services` pour le serveur local. | Installation sur Mac propre, démarrage, arrêt, mise à jour et désinstallation reproductibles ; aucun chemin utilisateur codé en dur. |
| F07 | D04, F06 | Évaluer un plugin Herdr réduit à l'intégration et au lancement ; garder le serveur autonome si l'initialiseur du plugin n'assure pas sa supervision. | Prototype isolé documenté : installation, démarrage, arrêt Herdr, redémarrage, mise à jour ; aucun pane utilisateur touché. |

## 1 — Sécurité et backend

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| S01 | D02 | En release, n'écouter que sur `127.0.0.1` ; accepter `Host` local ou celui de `HERDR_REMOTE_PUBLIC_ORIGIN` configuré exactement ; vérifier Serve privé, sans Funnel. | `0.0.0.0`, IP LAN et IP publique refusées au démarrage ; autre `Host` → 421 avant route ; appareil hors grant Tailscale ne joint pas le service. |
| S02 | S01, A01 | Pour chaque route mutante, exiger `Origin` égal à l'origine exacte de la PWA, méthode `POST` et `Content-Type: application/json` ; n'émettre aucun CORS permissif. | Même origine acceptée ; origine absente/étrangère → 403, méthode inattendue → 405, type inattendu → 415, prérequête étrangère refusée ; aucun effet Herdr. |
| S03 | A01 | Dans la route sessions extraite et `SessionReader.ts`, résoudre racine Pi et chemin de session par `realpath` avant ouverture ; comparer par segments. | Session dans la racine lisible ; `../`, préfixe similaire, lien sortant et chemin absent rejetés avec cause distincte. |
| S04 | A01 | Dans `FileService.ts`, ouvrir puis `stat` et lire **le même descripteur** ; appliquer racines et limite 12 Mio. | Valide lu ; absent=404, interdit=403, trop grand=413 ; traversée/lien sortant refusés ; remplacement du chemin après ouverture sans effet. |
| S05 | — | Confiner les assets web à la racine canonique du build. | Asset normal=200 ; `../`, racine au préfixe similaire et lien sortant ne livrent aucun contenu hors build. |
| S06 | S02 | Appliquer limites JSON, prompt, SSE et lectures du tableau ; libérer compteurs à fermeture/erreur. | Valeur limite acceptée et `limite+1` rejetée pour chaque ressource ; aucun prompt refusé n'atteint Herdr. |
| B01 | S03 | Remplacer le `?since=` **fonctionnel** par un curseur opaque dans `packages/shared/src/api.ts`, puis migrer serveur et client dans le même changement ; ajouter `reset`, `hasMore`, rejet 400. | Contrat unique ; curseur invalide refusé ; la fixture D012.3 conserve une réponse initiale bornée et un rafraîchissement inactif ≤1 Kio, sans retransmettre 1,8 Mo. |
| B02 | B01 | Dans `SessionReader.ts` et la route session, appliquer lecture bornée, offset après ligne complète, `dev:ino`, rotation et troncature en conservant la cadence et les bornes du tableau. | Fixtures : ligne coupée/complétée une fois, UTF-8 coupé, `hasMore`, rotation, troncature, ligne >512 Kio ; aucun rafraîchissement inactif ne relit le fichier complet. |
| B03 | B02 | Séparer session absente, vide, JSON invalide et erreur I/O dans l'API et le chat. | Seul `ENOENT` donne « absente » ; vide reste vide ; JSON invalide et permission refusée affichent la vraie cause. |
| B04 | A01 | Dans la route événements extraite, émettre un seul `resync` avec l'ID courant si curseur trop ancien, puis continuer les événements. | Curseur ancien : un `resync`, zéro répétition ; curseur valide : chaque événement manqué une fois. |
| B05 | S02 | Pour `agent.prompt`, distinguer attente, confirmation Herdr, erreur et confirmation inconnue selon `PromptSender` ; fenêtre de déduplication **60 s**. | Timeout/erreur jamais affiché « envoyé » ; doublon supprimé seulement après confirmation et dans les 60 s ; après échec ou 60 s, nouvel essai transmis. |
| B06 | S02 | Pour la confiance, relire le pane avant et après ; afficher `décision transmise` tant que l'acceptation n'est pas prouvée. | Invite disparue avant action → aucune touche ; échec d'envoi → erreur ; réponse transport seule ≠ « confiance accordée ». |
| B07 | A01 | Dans le contrat partagé, retirer `AGENT_KINDS` ; migrer dans le même changement son import serveur et son réexport/consommateur web vers `/api/agents/kinds`, puis valider chaque type installé au serveur. | Aucun import de la constante ne subsiste ; chaque type listé est accepté ; type absent → 400 **avant** création d'onglet. |
| B08 | B06, B07 | Valider projet/type/options avant lancement ; autoriser le second agent seulement par action explicite, avec nom unique ; corriger le commentaire périmé de `Api.ts` ; rendre visibles les étapes création → démarrage → détection → échec. | Projet occupé + action explicite crée un nouvel onglet ; aucun lancement automatique ; échec injecté à chaque étape : phase nommée et pane éventuel retourné ; succès ouvre le pane créé. |
| B09 | — | Dans `ModelCatalog.ts`, appliquer bornes stdout/stderr, délai, cache et regroupement du tableau. | Deux appels simultanés = une commande ; timeout à 20 s ; erreur/expiration relancent ; chaque sortie est bornée. |
| B10 | B02, B03 | Ajouter `ConversationSummary` partagé : `paneId`, `workspaceId`, titre, statut, `sessionState` (`available`/`absent`/`error`), aperçu/horodatage facultatifs ; aucun « non lu ». | Payload invalide refusé ; titre suit la cascade du tableau ; session absente n'invente ni aperçu ni date ; échec de lecture porte `sessionState: error`. |
| B11 | B10, S06 | Fournir `GET /api/conversations` depuis snapshot Herdr + fin bornée des sessions Pi, concurrence ≤4. | Un pane = une ligne même sans session ; réponse stable à snapshot constant ; erreur partielle identifiée sans perdre les autres lignes. |

## 2 — Refonte UX mobile

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| U01 | F01 | Écrire `docs/UX_MOBILE.md` : reprendre, répondre à `blocked`, ouvrir un projet, lancer un agent ; écran initial → action → résultat → retour. | Quatre parcours avec libellés exacts et cinq états : bloqué, chargement, vide, erreur, hors ligne. |
| U02 | U01 | Produire maquettes Conversations, Projet, Chat, Lancement à 390×844 et 320×568, avec les cinq états U01. | Sources et rendus versionnés ; chaque écran utilise seulement les données disponibles dans les contrats. |
| D03 | U02 | Présenter les maquettes au propriétaire et consigner son choix. | Version/commit retenu dans `docs/DECISIONS.md` ; corrections demandées incorporées avant U03. |
| U03 | D03 | Créer tokens et composants : texte, surfaces, espacements, lignes, états, boutons, menus et feuilles. | Pas de redéfinition locale d'un token partagé ; tactile et contraste respectent le tableau. |
| U04 | B11, A02 | Faire de Conversations la route initiale ; répartir chaque pane selon le tableau. | Cinq statuts dans leur section exacte ; tri stable ; toucher une ligne ouvre son `paneId`. |
| U05 | B08, A02 | Refaire Projets : liste, détail des conversations, action « Nouvel agent » même lorsqu'un agent existe déjà. | Projet vide, un agent et plusieurs agents montrent des identités distinctes ; second lancement seulement par action explicite ; pas de sélecteurs répétés sur les cartes. |
| U06 | U05, B09 | Mettre type, modèle et raisonnement dans une feuille de lancement ; valider avant requête. | Filtrer ≠ sélectionner ; choix incompatible bloque l'envoi ; succès/échec suit B08. |
| U07 | B03, A02, P01 | Refaire Chat : en-tête titre/état, historique, action Fichiers/Modèle, composeur fixe. | À 320×568 et 390×844, clavier ouvert, titre, message courant et saisie accessibles sans chevauchement. |
| U08 | U07, B05, B06 | Afficher les états exacts de prompt et confiance sans succès anticipé. | Timeout, refus, erreur, inconnu ont textes/actions distincts ; `décision transmise` ≠ « accordée ». |
| U09 | U07, B09 | Mettre Fichiers/Modèle en feuilles ; séparer filtre du modèle choisi et restaurer le focus au retour. | Filtre ≠ sélection ; brouillon/position conservés ; retour d'un fichier vers la liste de fichiers. |
| U10 | U04, U07, B04 | Uniformiser chargement, vide, hors ligne, reconnexion, erreur et nouvelle tentative. | Coupure conserve messages et brouillon ; erreur avec cause/action ; `resync` recharge une fois. |
| U11 | U04, U05, U06, U07, U08, U09, U10 | Corriger libellés, focus, dialogues, annonces d'erreur, clavier et cibles tactiles. | Parcours clavier/lecteur d'écran complets ; aucun contrôle inaccessible ; matrice du tableau sans élément caché. |
| U12 | U11, S01 | Ajouter icônes PWA ; vérifier manifest, safe areas, clavier et mode installé sur un iPhone physique via Serve HTTPS. | `tailscale serve status` montre la cible backend correcte ; installation Safari puis ouverture standalone ; icône non vide ; aucun contrôle masqué en portrait/paysage, clavier ouvert. |
| U13 | F01, U04 | Retirer vue terminal, `fetchTerminal`, route terminal, `TerminalResponse` et documentation produit. | Aucun appel de lecture du pane dans le parcours produit ; aucune route terminal publique ; Conversations/Chat utilisables. |

## 3 — Architecture et publication

| ID | Dépend | Travail exact | Preuve de fin |
|---|---|---|---|
| A01 | F03, A03 | **Avant les changements de routes**, extraire de `Api.ts` sessions, agents, fichiers et événements derrière un assembleur unique. | Routes et schémas HTTP identiques avant/après extraction ; pas de seconde table de contrats. |
| A02 | U03 | **Avant la refonte des écrans**, extraire de `App.tsx` écrans et état ; centraliser route, connexion et données partagées sans changer le rendu. | Un module par écran ; un seul propriétaire route/SSE/overview ; navigation et brouillons conservés. |
| A03 | — | Injecter logger et répertoires temporaires dans les tests serveur avant de refactorer les routes. | Tests API avec transport simulé sans écriture dans `~/.herdr-remote` ni session utilisateur. |
| A04 | A01, A02, B07 | Supprimer états `string` libres et configuration morte, dont `uploadDir`/`HERDR_REMOTE_UPLOAD_DIR` inutilisés tant que l'upload est différé ; garder une source par contrat. | Aucun enum d'agents concurrent ; chaque option de config a un lecteur ; états métier en union fermée. |
| P01 | F03, A03 | Générer une session Pi **synthétique** figée de 1,8 Mo dans un répertoire temporaire ; relever sur 20 chargements froids à 390×844 la taille initiale, les octets d'un rafraîchissement inactif et le p95 « ouverture du Chat → premier message visible ». | Fixture, méthode, environnement et référence chiffrée dans `docs/RELEASE_EVIDENCE.md` avant U07 ; aucune session utilisateur utilisée. |
| P02 | P01, B02, B11, U10 | Refaire les 20 mêmes mesures après refonte ; comparer au p95 P01 et aux bornes réseau du tableau. | p95 premier message ≤ **1,2 ×** référence P01 ; réponse initiale ≤512 Kio ; rafraîchissement inactif ≤1 Kio et sans relecture intégrale ; écart expliqué et corrigé avant R02. |
| R01 | F02, F03, F05, F06, D02, S06, U13 | Aligner README et guides : installation, sécurité, API, limites, mise à jour, dépannage. | Installation propre avec les commandes écrites ; chaque route, option et limite documentée existe. |
| R02 | F04, S01, S02, S03, S04, S05, S06, B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, B11, U11, U12, U13, A01, A02, A03, A04, P02, R01 | Vérifier installation propre, matrice responsive et parcours sur iPhone physique, avec agent simulé ou pane jetable uniquement. | CI verte, PWA installée, reprise/lecture/envoi/rattrapage démontrés ; zéro P0/P1 ouvert ; preuves/limites dans `docs/RELEASE_EVIDENCE.md`. |

**Hors périmètre de cette release :** terminal, sous-agents sans source vérifiée, notifications, pièces jointes et orchestration avancée. D007.1 a **accepté le mécanisme** des pièces jointes par upload vers un fichier temporaire ; il n'a pas fixé leur inclusion dans cette release. Aucune route d'upload n'existe actuellement. L'option de configuration inutilisée est retirée par A04 et sera redéfinie avec un futur contrat d'upload. Aucun de ces éléments différés n'est présenté comme déjà disponible.
