# Bascule TS → Rust — dossier de revue, procédure et retour arrière (T070)

> ⛔ **Ce document n'a PAS été exécuté.** Il prépare une bascule ; il ne
> l'autorise pas. Aucune commande ci-dessous ne doit être lancée sans une
> instruction explicite et distincte de l'utilisateur (AGENTS.md, « Migration
> Rust »). Rien dans ce dépôt ne publie de formule, ne touche Homebrew, launchd
> ou Tailscale.

## 1. Ce qui change, ce qui ne change pas

| | Avant (propriétaire actuel) | Après |
|---|---|---|
| Processus | `bin/herdrchat` → `bun run apps/server/src/main.ts` (formule `xDelph/herdr-chat` `v0.1.x`, `brew services`) | binaire natif `herdrchat` (PWA embarquée) |
| Écoute | `127.0.0.1:8791` | **identique** : `127.0.0.1:8791` |
| Exposition | `tailscale serve` HTTPS `:8790` **et** `/` (443) → `http://127.0.0.1:8791` | **identique, rien à toucher** |
| Variables | `HERDR_REMOTE_*`, `HERDR_SOCKET_PATH`, racines de sessions | **mêmes noms, mêmes défauts** |
| Store push | `~/.herdr-remote/push.json` (`{subscriptions, vapidKeys}`) | **même chemin, même format** lu sur place (`crates/notifications/src/store.rs`) |
| Journal | `~/.herdr-remote/herdr-remote.log` | même chemin |

Conséquence : la bascule est un **changement de binaire derrière le même port**.
Le téléphone garde son URL, l'origine autorisée et ses abonnements push.

## 2. Dossier de revue

### 2.1 Versions et artefacts

| Élément | Où le lire |
|---|---|
| Version du binaire | `herdrchat --version` (→ `herdrchat <version du workspace>`, `Cargo.toml [workspace.package]`) |
| Toolchain | `rust-toolchain.toml` (1.94.1), `manifest.json` de chaque archive (`rustc -vV`, `cargo --version`) |
| Archives | release GitHub de l'étiquette `v*` : `herdr-chat-{macos-arm64,macos-x86_64,linux-x86_64,linux-aarch64}.tar.gz` + `.sha256` + `SHA256SUMS` (`.github/workflows/release-rust.yml`) |
| Validée / compile-only | champ `validee` du `manifest.json` de l'archive : `true` seulement si le runner natif a **exécuté** le binaire |
| PWA embarquée | champ `pwa_embarquee` (> 0) du manifeste ; `GET /` → 200 |
| Liens | champ `liens` du manifeste : aucun `libssl`/`libcrypto` système |

⚠️ À la date de ce document, **aucune archive n'a été produite** : le workflow
est prêt mais n'a jamais tourné (O08 `pending` dans `compatibility/coverage.json`).
La première étiquette `v*` le déclenchera ; vérifier les quatre jobs verts et
`sha256sum -c SHA256SUMS` avant toute suite.

### 2.2 Preuves

| Porte | Commande | Attendu |
|---|---|---|
| Porte finale | `cargo run --locked -p xtask -- final-gate` | verte (voir [`FINAL-GATE.md`](FINAL-GATE.md)) |
| Couverture | `cargo run --locked -p xtask -- coverage` | 0 défaut ; la liste imprimée est la liste des **limites** |
| Scénario navigateur (fixture) | `bun scripts/scenario-fixture.ts <sortie>` | rapport + captures ; voir 2.3 |
| Historique d'exécution | `EXECUTION.md` | une entrée par tâche, commande et résultat |

### 2.3 Limites connues au moment de la revue

`compatibility/coverage.json` est la source : `xtask coverage` imprime chaque
entrée non prouvée avec son écart. Résumé (audit T064 du 2026-10-29, avant
fusion des lots push/launch/curseurs) :

- **Push : aucune notification n'est livrée** par le démon Rust (E06, E07, E09,
  C14 `not-wired`). Les abonnements et la clé VAPID sont conservés, la route
  `vapid-key`/`subscriptions` fonctionne, mais rien n'est envoyé. La surcharge
  VAPID par l'environnement est ignorée (E08). **Bloquant si l'utilisateur
  dépend des notifications.**
- Lancement : issues `ShellNotReady`/trust inatteignables (A08, H07 409) ;
  validation du niveau non branchée (A15).
- Lecture de session : matrice 400/403/409/503 de H04 non produite ; curseurs
  SQLite invalides ignorés en silence (C12) ; 403/503 rendus 422/502 (C04).
- Résumés : aperçu outil+argument absent, filtre `<placeholder>` absent,
  index incrémental mort (D18, D19, D22) ; cwd de session jamais calculé (D03).
- Démon : pas de ping ni d'avertissement au démarrage sans Herdr (O03) ; pas
  de `no-store` sur le JSON de l'API (O07).
- PWA (scénario fixture, CDP headless) : après une coupure réseau de 4 s, les
  flux SSE (`/api/events`, `/stream`) **ne sont pas rouverts en 60 s** ; seul
  le sondage de secours reprend (`/api/overview`, `/api/health`,
  `/api/conversations`). À confirmer sur iPhone avant bascule. Aucune mise à
  jour PWA différée (C21 `pending`).

Ce qui est prouvé à travers le démon composé (60 entrées `proven`) : les 18
routes servies par le routeur (le test dérive la liste du manifeste et sait
échouer), garde d'origine/méthode/corps, envoi/arrêt/focus/réponse/confiance,
journal et flux SSE, fichiers et images, assets et cycle de vie du démon.

## 3. Pré-requis (lecture seule, à faire avant le jour J)

```bash
# 3.1 Qui possède le port aujourd'hui — identifier, NE PAS tuer.
lsof -nP -iTCP:8791 -sTCP:LISTEN
ps -o pid,ppid,command -p <pid>          # chemin complet + PPID (AGENTS.md : zéro kill non identifié)
brew services info herdr-chat            # le propriétaire attendu : brew services / launchd
launchctl print gui/$(id -u)/homebrew.mxcl.herdr-chat | grep -E 'state|program|path'

# 3.2 L'environnement réel de l'ancien service (à reporter tel quel).
plutil -p ~/Library/LaunchAgents/homebrew.mxcl.herdr-chat.plist

# 3.3 L'exposition Tailscale (elle ne doit PAS changer).
tailscale serve status

# 3.4 L'état de référence, pour comparer après.
curl -s http://127.0.0.1:8791/api/health | tee /tmp/herdr-avant-health.json
curl -s http://127.0.0.1:8791/api/conversations | jq '.conversations | length'
curl -s http://127.0.0.1:8791/api/overview | jq '.workspaces | length'
```

Préparer le binaire (archive vérifiée, jamais un build local non tracé) :

```bash
mkdir -p ~/.local/share/herdr-chat/<version> && cd ~/.local/share/herdr-chat/<version>
curl -LO <url>/herdr-chat-macos-arm64.tar.gz && curl -LO <url>/herdr-chat-macos-arm64.tar.gz.sha256
shasum -a 256 -c herdr-chat-macos-arm64.tar.gz.sha256
tar -xzf herdr-chat-macos-arm64.tar.gz
./herdrchat --version
jq '.validee, .pwa_embarquee, .liens' manifest.json
```

## 4. Sauvegarde (obligatoire, avant tout arrêt)

```bash
horodatage=$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.herdr-remote/sauvegardes/$horodatage
cp -p ~/.herdr-remote/push.json        ~/.herdr-remote/sauvegardes/$horodatage/   # abonnements + clés VAPID
cp -p ~/.herdr-remote/herdr-remote.log ~/.herdr-remote/sauvegardes/$horodatage/ 2>/dev/null || true
cp -p ~/Library/LaunchAgents/homebrew.mxcl.herdr-chat.plist ~/.herdr-remote/sauvegardes/$horodatage/
shasum -a 256 ~/.herdr-remote/sauvegardes/$horodatage/push.json
jq '{abonnements: (.subscriptions | length), vapid: (.vapidKeys != null)}' ~/.herdr-remote/push.json
```

**Migration du store push (E10).** Aucune copie n'est nécessaire : le démon
Rust lit `HERDR_REMOTE_PUSH_STORE` (défaut `~/.herdr-remote/push.json`) **sur
place**, au format legacy exact, et un fichier malformé est une erreur visible,
jamais régénéré. `rapatrie_store` (copie d'un ancien chemin vers un nouveau)
n'existe que pour un changement de chemin ; il n'est **pas** branché dans le
démon (E10 `not-wired`). Si l'ancien service utilisait un chemin non par
défaut (vu en 3.2), reporter **la même valeur** dans le nouveau service plutôt
que de copier le fichier : les abonnements sont liés à la clé publique qui les
a créés.

## 5. Bascule

### 5.1 Arrêter l'ancien propriétaire (et lui seul)

```bash
brew services stop herdr-chat
lsof -nP -iTCP:8791 -sTCP:LISTEN || echo "port libre"
```

Si le port reste occupé, **s'arrêter** et identifier (3.1) ; ne rien tuer qui
n'est pas positivement le service `herdr-chat`.

### 5.2 Démarrer le nouveau — option A : formule Homebrew native

Seulement après publication de `packaging/herdr-chat.rb` (URL et empreintes
remplies depuis la release) dans le tap, sur instruction :

```bash
brew update && brew upgrade herdr-chat     # la formule native remplace la forme A
brew services start herdr-chat
```

Le bloc `service` de la formule fixe `HERDR_REMOTE_BIND=127.0.0.1` et
`HERDR_REMOTE_PORT=8791`. Reporter les autres variables vues en 3.2 si elles
existaient.

### 5.2 bis Démarrer le nouveau — option B : LaunchAgent utilisateur

Gabarit prêt : [`packaging/dev.herdr.chat.plist`](../packaging/dev.herdr.chat.plist)
(`KeepAlive` sur sortie anormale, `RunAtLoad`, variables, journaux).

```bash
install -m 0755 ~/.local/share/herdr-chat/<version>/herdrchat ~/.local/bin/herdrchat
mkdir -p ~/Library/Logs/herdr-chat
sed -e "s#__HERDRCHAT_BIN__#$HOME/.local/bin/herdrchat#" \
    -e "s#__HOME__#$HOME#g" \
    -e "s#__LOG_DIR__#$HOME/Library/Logs/herdr-chat#" \
    packaging/dev.herdr.chat.plist > ~/Library/LaunchAgents/dev.herdr.chat.plist
plutil -lint ~/Library/LaunchAgents/dev.herdr.chat.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.herdr.chat.plist
launchctl print gui/$(id -u)/dev.herdr.chat | grep -E 'state|pid|last exit'
```

Ne jamais laisser **les deux** services chargés : `brew services` relancerait
l'ancien sur le même port. Avec l'option B, garder `brew services stop
herdr-chat` (5.1) et ne pas le relancer.

## 6. Contrôles (lecture seule)

```bash
herdrchat --version                                                   # ou ~/.local/bin/herdrchat
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8791/api/health        # 200 (503 = Herdr injoignable)
curl -s http://127.0.0.1:8791/api/health | jq '{ok, herdr}'
curl -s http://127.0.0.1:8791/api/overview | jq '.workspaces | length'          # comparer à 3.4
curl -s http://127.0.0.1:8791/api/conversations | jq '.conversations | length'  # comparer à 3.4
curl -s http://127.0.0.1:8791/api/agents/kinds | jq .
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8791/api/notifications/vapid-key   # 200, même clé qu'avant :
curl -s http://127.0.0.1:8791/api/notifications/vapid-key; echo; jq -r .vapidKeys.publicKey ~/.herdr-remote/push.json
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8791/          # 200 text/html (PWA embarquée)
curl -sN --max-time 5 http://127.0.0.1:8791/api/events | head -5                       # événement ready
curl -s "http://127.0.0.1:8791/api/agents/<paneId lu dans conversations>/session?tail=4096" | jq 'keys'
tailscale serve status                                                 # inchangé : :8790 et / → 127.0.0.1:8791
curl -s -o /dev/null -w '%{http_code}\n' https://<machine>.<tailnet>.ts.net:8790/api/health
tail -n 50 ~/.herdr-remote/herdr-remote.log
```

⚠️ Uniquement des **lectures** : aucun `POST` (prompt, stop, focus, answer,
trust, lancement) vers les agents de l'utilisateur pour « tester ».

Sur le téléphone : ouvrir l'app installée, vérifier liste → conversation →
défilement vers l'historique → mode avion 5 s puis retour (voir la limite SSE
en 2.3).

## 7. Retour arrière

Déclencheurs : health ≠ 200 alors qu'Herdr tourne, conversations manquantes
par rapport à 3.4, clé VAPID différente, PWA absente, ou besoin des
notifications push (non livrées par le démon Rust, 2.3).

```bash
# Option B
launchctl bootout gui/$(id -u)/dev.herdr.chat
rm ~/Library/LaunchAgents/dev.herdr.chat.plist
# Option A
brew services stop herdr-chat
brew uninstall herdr-chat && brew install xDelph/herdr-chat/herdr-chat@<version TS>   # ou réinstaller l'ancienne bouteille/le tag v0.1.x

lsof -nP -iTCP:8791 -sTCP:LISTEN || echo "port libre"
# Restaurer le store seulement s'il a changé (comparer l'empreinte notée en 4) :
shasum -a 256 ~/.herdr-remote/push.json
cp -p ~/.herdr-remote/sauvegardes/<horodatage>/push.json ~/.herdr-remote/push.json
brew services start herdr-chat                      # l'ancien service TS
curl -s http://127.0.0.1:8791/api/health | jq '{ok, herdr}'
```

Tailscale n'a pas été modifié : rien à défaire de ce côté.

## 8. Lancer l'ancien démon TS depuis l'historique (comparaison, développement)

`apps/server` a été retiré à T068. Le dernier commit qui le contient est le
parent du commit de retrait (`git log --diff-filter=D --format=%H -1 -- apps/server/src/main.ts`
donne le commit de retrait ; prendre son parent `^`).

```bash
retrait=$(git log --diff-filter=D --format=%H -1 -- apps/server/src/main.ts)
git worktree add /tmp/herdr-ts "${retrait}^"
cd /tmp/herdr-ts && bun install --frozen-lockfile && bun run build
HERDR_REMOTE_PORT=8795 HERDR_REMOTE_PUSH_STORE=/tmp/herdr-ts-push.json bun run apps/server/src/main.ts
```

Utiliser un **autre port** et un **autre store push** que le service réel.
Le banc de comparaison l'accepte directement :
`cargo run -p xtask -- bench --stack ts --ts-root /tmp/herdr-ts`.
