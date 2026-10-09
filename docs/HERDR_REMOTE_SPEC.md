# Herdr Remote — Spécification concise

> **Statut :** cadrage initial · **Date :** 08/10/2026 · **Cible :** iPhone (PWA) + Mac (service local)

## 1. Objectif

Une **messagerie mobile pour piloter Herdr et ses agents existants** (Pi en priorité, puis autres harnesses) : envoyer des instructions, suivre les réponses et les subagents, intervenir à distance et reprendre le travail sur Mac **sans perdre le contexte**.

**Principes :** Herdr reste l'orchestrateur et la source de vérité ; aucun second agent Pi lancé pour « simuler » la session courante ; **aucun SSH entrant**, aucune modification des permissions macOS, aucun cloud applicatif nécessaire.

## 2. Architecture

```text
iPhone — Safari / PWA installée
   │ HTTPS + WebSocket (tailnet privé)
   ▼
Tailscale Serve (Mac)
   ▼
Herdr Remote — backend Bun + Effect (127.0.0.1)
   ├─ Herdr : API locale Unix socket JSONL + events.subscribe
   ├─ Pi : sessions JSONL en lecture seule (historique structuré)
   ├─ Pi : extension locale optionnelle (événements / interactions riches)
   └─ SQLite local facultatif (préférences, association, audit)
   ▼
Herdr → panes / agents / subagents existants
```

- **Contrôle :** API Herdr pour lister, lire et envoyer vers les agents/panes existants.
- **Affichage Pi :** exploiter le format structuré des sessions JSONL ; ne jamais écrire dedans directement.
- **Temps réel :** abonnement aux événements Herdr + canal WebSocket vers l'iPhone. Enrichissement par extension Pi si nécessaire.
- **Limite connue :** le mode RPC de Pi permet un contrôle bidirectionnel **des processus démarrés en RPC** ; il ne se rattache pas magiquement à une TUI Pi existante. Prévoir un adaptateur/une extension pour combler les écarts.
- **Déploiement :** un backend en processus utilisateur (launchd macOS) + frontend statique ; pas de Docker ni base distante.

## 3. Stack technique

| Couche | Choix | Pourquoi |
|---|---|---|
| Runtime + paquets | **Bun 1.4.2** (`bun`, `bun install`, `bun test`) | Démarrage, dépendances, exécution TS et WebSocket natifs ; **pas de npm**. |
| Backend | **Effect 4.0.2** + plateforme Bun | Services typés, `Schema`, gestion des erreurs, `Stream`, `Layer`, ressources et concurrence. |
| Frontend | **React 19.3.0 + Vite 8.3.3**, PWA | Interface iOS rapide, SPA statique ; pas de rendu serveur inutile. |
| Langage / typage | **TypeScript 7.0.2**, compilateur natif issu de **tsgo** | Vérification des types rapide, `strict`, zéro `any`. |
| Lint | **Oxlint 1.80.0** (Oxc) | Remplace ESLint ; analyses statiques rapides. |
| Format | **Oxfmt 0.72.0** (Oxc) | Remplace Prettier. |
| Build | **Vite 8 / Rolldown (Rust/Oxc)** | Compilation et bundles frontend optimisés. |
| Transport privé | **Tailscale Serve** | HTTPS sur tailnet, sans ouverture de ports ni SSH. |
| État local | Mémoire + **SQLite uniquement si utile** | Faible empreinte ; éviter la complexité prématurée. |
| Node.js | **26.11.0 Current** (référence de compatibilité) | **Non requis en production** si Bun exécute tout correctement ; prévoir tests de compatibilité. |

**Précision :** Effect n'est **pas** un remplaçant direct de Next.js : il structure le backend et les effets. Le couple React + Vite couvre le frontend, sans Next.js. De même, **tsgo/type-checking ne remplace pas un linter** : c'est le rôle d'Oxlint. TypeScript 7 distribue son compilateur natif avec la commande `tsc` ; ne pas imposer l'ancien package expérimental `@typescript/native-preview`.

**Politique versions :** partir des dernières versions **stables**, les épingler dans `package.json` et `bun.lock`, vérifier chaque semaine avec Renovate + CI (`bun test`, vérification TypeScript native, Oxlint, Oxfmt), mettre à jour après validation ; **pas de `latest` flottant en production**.

## 4. Fonctionnalités

| Priorité | Fonctionnalité | Comportement attendu |
|---|---|---|
| **MVP** | **Accueil / état global** | Projets, workspaces, agents actifs/terminés/bloqués, dernière activité et nombre d'actions requises. |
| **MVP** | **Liste multi-agents** | Chaque agent/pane identifié, filtrable par projet et statut, avec sélection instantanée. |
| **MVP** | **Chat type messagerie** | Historique lisible, Markdown/code, messages utilisateur/assistant, reprise de la session existante. |
| **MVP** | **Envoyer des instructions** | Prompts transmis au bon agent via Herdr ; indication claire d'envoi, d'exécution et d'erreur. |
| **MVP** | **Streaming & reconnexion** | Texte et états actualisés en direct ; reconnexion automatique et rattrapage après coupure iOS. |
| **MVP** | **Historique Pi** | Lire les sessions JSONL, branches et tool calls sans modifier les fichiers de session. |
| **MVP** | **Sécurité d'accès** | Service lié à `127.0.0.1`, accès via Tailscale Serve, politique tailnet restrictive, API sans commande shell arbitraire. |
| **V1** | **Subagents / arborescence** | Vue parent → enfants, profondeur, statut individuel, progression et coûts lorsque disponibles. |
| **V1** | **Tool calls & activités** | Afficher outils lancés, arguments/résultats résumés, erreurs, durées ; détail à la demande. |
| **V1** | **Approbations / interventions** | Remonter les demandes de confirmation et répondre depuis l'iPhone si l'intégration agent le permet. |
| **V1** | **Git / code review** | Branche, fichiers modifiés, diffs, résumé des changements ; validation explicite des actions risquées. |
| **V1** | **Notifications** | Agent terminé/bloqué, approbation attendue, échec ; Web Push iOS si PWA installée et permission accordée. |
| **V1** | **Pièces jointes** | Envoyer images/captures et fichiers à une session compatible, avec taille et types limités. |
| **V1** | **Terminal de secours** | Vue terminal/ANSI en lecture prioritaire ; interaction ciblée si le protocole Herdr l'autorise. |
| **V2** | **Orchestration mobile** | Lancer/arrêter/relancer des agents et gérer des groupes de subagents selon les capacités Herdr. |
| **V2** | **Recherche transverse** | Rechercher prompts, réponses, outils, sessions et agents dans plusieurs projets. |
| **V2** | **Observabilité** | Durée, modèles, tokens/coûts lorsqu'exposés, erreurs, activité et métriques locales. |
| **V2** | **Adaptateurs multi-harness** | Vue normalisée Pi / Claude / Codex / autres, sans masquer les capacités propres à chacun. |
| **V2** | **Préférences & UX** | Épingles, favoris, filtres, thème, raccourcis, partage de contenu vers la PWA. |

## 5. UX iPhone

- **Navigation :** `Projets` · `Agents` · `Activité` · `Réglages` ; chat accessible en un geste.
- **Écran chat :** bulles de messages, état de l'agent, cartes compactes pour tool calls/subagents, composeur fixe, pièces jointes.
- **Lisibilité :** pas de terminal brut par défaut ; code/diffs repliables ; indicateurs *working / waiting / done / error*.
- **Résilience :** historique consultable à la reconnexion ; actions idempotentes quand possible, pas d'envoi doublon.

## 6. Sécurité & performance (non négociables)

- **Tailscale uniquement :** `tailscale serve --bg 3000` vers le service local ; **jamais** `tailscale funnel`, jamais de port public.
- Contrôle des utilisateurs/appareils via **Tailscale ACL/grants** ; authentification applicative additionnelle envisageable pour les opérations sensibles.
- Vérifier l'origine, l'autorisation et les limites de débit des requêtes HTTP/WebSocket ; commandes autorisées par liste blanche.
- Ne pas exposer les secrets, clés API, variables d'environnement ni le contenu complet des fichiers sans action explicite ; limiter les logs.
- Streaming incrémental, pagination/virtualisation de l'historique, cache borné, nettoyage des abonnements ; mesurer CPU/RAM sur Mac.
- Accès Mac ↔ iPhone seulement lorsque **Mac et Tailscale sont actifs** ; Web Push dépend aussi de l'infrastructure de notification du navigateur/OS.

## 7. Ordre d'implémentation

1. **Spike protocole :** vérifier version/API Herdr locale, détecter agent Pi ↔ pane ↔ fichier de session ; valider l'envoi d'un prompt sans créer d'agent supplémentaire.
2. **MVP utilisable :** backend Effect/Bun, PWA React, listing, chat, streaming, historique et Tailscale Serve.
3. **V1 riche :** subagents, tool calls, approbations, Git, notifications, fichiers et terminal de secours.
4. **V2 :** orchestration avancée, recherche et adaptateurs multi-harness.

**Critère de succès MVP :** depuis l'iPhone en Wi-Fi **ou 5G**, ouvrir la PWA, retrouver un agent Pi déjà lancé par Herdr, lire sa session, lui envoyer un message, suivre sa réponse puis reprendre la même session sur Mac — **sans SSH ni modification des droits de `$HOME`**.

## Références techniques

- [Herdr — API socket](https://herdr.dev/docs/socket-api/)
- [Pi — Sessions](https://pi.dev/docs/latest/sessions) · [Format JSONL](https://pi.dev/docs/latest/session-format) · [Intégration CLI/RPC](https://pi.dev/docs/latest/cli-integration)
- [Effect 4 / Bun](https://effect.website/docs/v4/api/platform-bun/BunHttpServer)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Bun](https://bun.sh/) · [TypeScript](https://www.typescriptlang.org/) · [Oxc](https://oxc.rs/) · [Vite](https://vite.dev/)

*Versions relevées le 08/10/2026 ; à revérifier à la création du dépôt et lors des mises à jour.*
