# Flux de session en direct

Décision du 2026-10-29. Complète TECH.md §7 et CONTRACTS.md. Remplace, pour l'écran de conversation, la boucle « `session_changed` sur `/api/events` → relecture `GET /session?cursor=` ».

## 1. Pourquoi

Mesuré le 2026-10-29 sur le démon Rust : le contenu d'une conversation n'arrivait qu'à la relecture de secours de la PWA (15 s). La veille Herdr tourne toutes les 2 s et ne publiait `session_changed` qu'à un changement de titre ou de statut. Même corrigée, cette chaîne coûte trois sauts : veille 2 s → événement global → requête HTTP du client.

Le contenu vient des fichiers et bases des agents, jamais d'Herdr (PROTOCOL §10). Le démon peut donc observer directement la source et pousser les lignes au client qui la regarde.

## 2. Contrat HTTP

`GET /api/agents/:paneId/stream` — `text/event-stream`.

| Entrée | Rôle |
|---|---|
| `Last-Event-ID` (en-tête, reconnexion native) | Curseur opaque du dernier événement appliqué. Prioritaire. |
| `?cursor=<opaque>` (première connexion) | Curseur rendu par `GET /session` : le flux reprend exactement après la page déjà affichée. |
| aucun des deux | Le flux commence par un `reset` portant la page de queue. |

Événements (`event:` / `id:` / `data:` = charge JSON seule, comme `/api/events`) :

| `event` | `id` | `data` | Sens pour le client |
|---|---|---|---|
| `entries` | curseur après ces lignes | `SessionStreamEntries { entries: SessionEntry[], cursor: string, caughtUp: boolean }` | Fusionner par `id` (une ligne SQLite réécrite remplace la précédente), sinon ajouter. |
| `reset` | curseur de la page | `SessionResponse` (la forme de `GET /session`) | Remplacer toute la vue : rotation, troncature, curseur refusé, nouvelle session du pane. |
| `gone` | — | `SessionStreamGone { reason: string }` | Le pane n'a plus de source lisible. Le flux se ferme ; le client affiche la cause, ne reconnecte pas en boucle. |
| commentaire `:` | — | — | Battement (15 s). |

Statuts : `404` pane inconnu, `503` trop de flux (plafond 16), `200` sinon. Un curseur illisible n'est pas une erreur HTTP : il produit un `reset`.

Les `SessionEntry` sont dans la **forme commune** (Pi) : Codex et Claude sont traduits au point d'entrée unique `sessions::normalisation`, opencode et Devin à la lecture SQL. Le client ne lit qu'une forme.

Le flux ne porte ni statut d'agent ni question : ils restent sur `/api/events` et `/api/conversations`. Un écran de chat a donc au plus deux connexions SSE (globale + session).

## 3. Serveur

```text
fichier / base de l'agent
  → SessionHub (sessions::hub) : une observation par source observée
      notify (FSEvents/inotify) sur le dossier parent, filtré sur le fichier
      (+ `-wal` pour SQLite), débounce 40 ms, filet stat 1 s
      → watch::Sender<u64> (révision)
  → handler `stream` (http-api) : un curseur par client
      sur chaque révision : page avant depuis SON curseur (spawn_blocking),
      bornée 2 MiB, répétée tant que `caughtUp` est faux
  → SSE
```

- **Une observation par source, partagée.** `SessionHub::observe(source)` rend un `Observation` RAII. La dernière libération arrête le watcher et la tâche ; aucune tâche ne survit à ses clients.
- **Chaque client lit son delta.** Le hub ne diffuse pas de lignes, il diffuse une révision. Un client lent saute des révisions sans rien perdre : son curseur est sa vérité. Pas de file par client, pas de perte sur débordement.
- **Le curseur est l'identifiant SSE.** La reconnexion du navigateur renvoie `Last-Event-ID` = dernier curseur appliqué ; la reprise est exacte, sans journal côté serveur.
- **Aucune lecture bloquante sur le runtime.** Lecture de fichier, SQLite et résolution passent par `spawn_blocking`.
- **Re-résolution.** À chaque battement, le pane est re-résolu ; une autre source (nouvelle session dans le même pane) produit un `reset` et une nouvelle observation.
- **Repli sans notify.** Si le watcher ne peut pas être posé (système, permissions), le filet stat de 1 s fonctionne seul ; la dégradation est journalisée, jamais masquée.

## 4. Client

- Ouvrir le chat : `GET /session` (queue), afficher, puis `new EventSource('/api/agents/:id/stream?cursor=' + cursor)`.
- `entries` → fusion par `id`, mémoriser `cursor`. `reset` → remplacer. `gone` → fermer, afficher la cause.
- Historique : inchangé, `GET /session?before=<previousCursor>`.
- Plus de relecture périodique du contenu tant que le flux est ouvert. En cas d'erreur du flux, le navigateur reconnecte seul avec `Last-Event-ID`.
