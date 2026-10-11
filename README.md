# Herdr Remote

Piloter Herdr et ses agents Pi **depuis l'iPhone**, sans SSH et sans modifier les droits de `$HOME`.

Herdr reste l'orchestrateur et la source de vérité. Herdr Remote est une **couche locale** : elle lit, affiche et transmet — elle ne remplace rien et ne lance aucun second agent.

## Démarrage rapide

```bash
nvm use                                   # lit .nvmrc → 24.21.0
npm install -g --allow-scripts=bun bun@1.4.2   # Bun rattaché à cette version de Node
bun install
bun run verify                            # format → lint → typecheck → tests
```

Puis compiler la PWA et lancer le serveur :

```bash
bun run --cwd apps/web build
bun run apps/server/src/main.ts           # http://127.0.0.1:8790
```

### Accès depuis l'iPhone

**Chemin canonique (HTTPS, PWA installable)** — nécessite que Serve soit activé sur le tailnet :

```bash
tailscale serve --bg 8790
```

**Repli de développement actuel (hors installation de release)** — HTTP sur le tailnet, chiffré par WireGuard, mais PWA **non installable** sur iOS :

```bash
HERDR_REMOTE_BIND=$(tailscale ip -4 | head -1) bun run apps/server/src/main.ts
```

`HERDR_REMOTE_BIND` accepte `127.0.0.1` ou une IP Tailscale. **`0.0.0.0` et toute IP publique sont refusés** au démarrage.

La release prévue vise un **tap Homebrew personnel**, Tailscale Serve et **aucune authentification applicative**. Un appareil admis par les règles du tailnet peut utiliser toutes les fonctions ; voir le [modèle d'accès](docs/SECURITY_MODEL.md). La formule et les contrôles HTTP de release restent à implémenter.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock` | Socket de l'**API Herdr** (couche A) |
| `HERDR_REMOTE_PORT` | `8790` | Port d'écoute |
| `HERDR_REMOTE_BIND` | `127.0.0.1` | Hôte d'écoute — `127.0.0.1` ou IP Tailscale uniquement |
| `PI_SESSIONS_ROOT` | `~/.pi/agent/sessions` | Racine des sessions Pi |

> ⚠️ `HERDR_SOCKET` (bus d'agents) et `HERDR_SOCKET_PATH` (API Herdr) sont **deux choses différentes**. Seul le second est lu.

## Architecture — contenu / contrôle

| Besoin | Source |
|---|---|
| Contenu et rattrapage après coupure | **fichiers de session Pi** (JSONL, lecture seule) |
| Envoi de prompt, statut, vue globale, temps réel | **API Herdr** |

Cette séparation n'est pas un choix esthétique : `revision` vaut `0` en permanence côté Herdr et `events.wait` n'implémente pas `pane_output_changed`. Aucun compteur de rattrapage n'est exploitable. Détail : `docs/PROTOCOL.md` §10.

## API

| Route | Rôle |
|---|---|
| `GET /api/health` | État du serveur **et** joignabilité d'Herdr |
| `GET /api/overview` | Workspaces + agents (depuis `session.snapshot`) |
| `GET /api/agents/:paneId/session` | Historique (depuis le JSONL Pi) |
| `GET /api/agents/:paneId/terminal` | Sortie terminal du pane |
| `POST /api/agents/:paneId/prompt` | Envoyer un prompt, **avec suppression des doubles envois** |
| `GET /api/events` | Flux SSE, rattrapage par `Last-Event-ID` |

`POST .../prompt` expose quatre états : `sent` (confirmé), `suppressed` (double envoi identique), et une erreur explicite si l'envoi n'est pas confirmé. **Un envoi n'est jamais présenté comme « envoyé » sans confirmation.**

## Documentation

| Fichier | Contenu |
|---|---|
| `docs/HERDR_REMOTE_SPEC.md` | Spécification produit de référence |
| `docs/PROTOCOL.md` | Protocole Herdr et format des sessions Pi, **vérifiés par exécution** |
| `docs/TASKS.md` | Plan déterministe, portes bloquantes, état d'avancement |
| `docs/RELEASE_BACKLOG.md` | Backlog actif pour la refonte mobile et la publication du code source |
| `docs/RELEASE_CHOICES.md` | Proposition de licence PolyForm, distribution et accès |
| `docs/SECURITY_MODEL.md` | Périmètre d'accès personnel et contrôles prévus pour la release |
| `docs/UX_MOBILE.md` | Parcours et maquettes mobiles à valider |
| `docs/DECISIONS.md` | Décisions datées avec leurs alternatives écartées |
| `docs/TOOLCHAIN.md` | Chaîne d'outils, règles de lint, pièges des outils |

## Méthode

**Le schéma n'est pas la source de vérité de l'implémentation.** Sur Herdr 0.9.3, `events.wait` déclare 19 variantes et n'en implémente qu'une ; `agent_status` est optionnel au schéma et exigé par le serveur ; `revision` vaut toujours `0`.

> **Toute capacité est vérifiée par exécution avant d'être utilisée.**

Les incertitudes restantes sont marquées `INCONNU` dans `docs/PROTOCOL.md`. Elles ne sont jamais comblées par une supposition : l'interface affiche l'absence plutôt qu'un substitut inventé.
