# Herdr Chat — packaging Homebrew

> ⚠️ **Mise à jour T068 (2026-10-29) : la forme A est remplacée par la forme B.**
> Le démon livré est le binaire Rust `herdrchat`, PWA embarquée à la
> compilation ; Bun ne sert plus qu'à construire la PWA en CI. Voir la section
> « Forme B — binaire natif » en fin de document. Les décisions ci-dessous
> restent l'historique de la forme A (formule publiée `v0.1.x`).

> Décisions prises le 2026-10-14, **avant** toute modification de code.
> Le produit s'appelle désormais **Herdr Chat** (le dépôt reste `herdr-pwa` pour l'instant).

## Décisions

| Sujet | Décision |
|---|---|
| Forme | **A** — arborescence + `bun`, pas de binaire compilé |
| Licence | **PolyForm-Noncommercial-1.0.0** — la même que `devcli` |
| Tap | **nouveau tap dédié** `xDelph/homebrew-HerdrChat` |
| Commande | `herdrchat` |
| Installation visée | `brew install xDelph/HerdrChat` |

`devcli` **garde son tap** : rien à renommer, ses installations existantes restent intactes.

## Pourquoi la forme A, et pourquoi elle n'est pas un pis-aller

Le serveur trouve ses assets par `join(import.meta.dir, "..", "..", "web", "dist")` —
**relatif au fichier source**, jamais au répertoire courant. L'arborescence est donc
lançable depuis n'importe où, ce qui est exactement ce qu'un paquet demande.

⚠️ **Ce même point ferme la porte du binaire compilé** : avec `bun build --compile`,
`import.meta.dir` ne désigne plus l'arborescence et les assets deviennent introuvables.
Passer à la forme B exigerait de changer la résolution (variable d'environnement ou
chemin relatif à l'exécutable). Ce n'est pas prévu.

## Pourquoi un tap dédié

Homebrew : `brew tap user/repo` est un raccourci pour `homebrew-repo`.
Donc `brew install xDelph/HerdrChat` implique `github.com/xDelph/homebrew-HerdrChat`
et la formule `herdrchat`.

⚠️ Homebrew **minuscule** les noms de formules — `HerdrChat.rb` serait invalide.
La casse reste possible sur le **dépôt** (GitHub redirige), pas sur la formule.

⚠️ **Le nom du dépôt et celui de la commande sont liés.** On ne peut pas avoir
l'URL `HerdrChat` *et* la commande `herdr-chat` sans deux formules. Choix retenu :
l'URL et `herdrchat`, cohérent avec `devcli` (sans tiret).

## Ce qui reste à faire

1. **`git remote` est vide** — pousser le dépôt sur GitHub.
   Nom : `herdr-pwa` ou renommé en `herdrchat` ?
2. **Version** : `package.json` dit `0.0.0`. Proposer `0.1.0` pour le premier tag.
3. **`LICENSE`** : PolyForm-Noncommercial-1.0.0.
4. **`apps/web/dist` est dans `.gitignore`** — un tarball de source ne contient donc
   **pas** la PWA compilée. Deux options : la formule compile dans son `install`, ou
   la release publie un artefact incluant `dist`.
5. **Bloc `service` (launchd) dans la formule** — `devcli` n'en a pas, `herdrchat` en a
   besoin. C'est aussi ce qui réglera le serveur qui meurt avec le shell.
6. **Caveat** : la formule dépend d'**Herdr qui tourne** (`~/.config/herdr/herdr.sock`),
   dépendance externe non empaquetée — le dire à l'installation plutôt que de laisser
   un échec muet.
7. **Dépendances de la formule** : `bun` ; `node` seulement si le build de la PWA en a
   besoin (à vérifier — `vite build` est peut-être exécutable par bun seul).
   Contraintes à respecter : `engines.node: 24.21.0`, `packageManager: bun@1.4.2`.

## État de la configuration au moment de la décision

- 13 variables d'environnement lues, **toutes optionnelles** (`HERDR_REMOTE_BIND`
  défaut `127.0.0.1`, `HERDR_REMOTE_PORT` défaut `8791`, clés VAPID auto-générées).
  Donc `brew services start herdrchat` doit suffire, sans configuration.
- Aucune CI, aucun tag, aucune licence dans le dépôt.
- Serveur lancé aujourd'hui à la main, depuis un shell (`nohup`) — non supervisé.


## ⚠️ La PWA servie vient du keg, pas du dépôt

Constaté le 2026-10-15, et ça surprend : après `brew install`, le serveur lit
`apps/web/dist` depuis `/opt/homebrew/Cellar/herdr-chat/<version>/`. **Modifier
le dépôt ne change donc plus rien sur le téléphone.** Il faut une release puis
`brew upgrade`.

J'ai reconstruit trois fois dans `apps/web/dist` en croyant mettre à jour
l'application — je mettais à jour un dossier que plus personne ne lisait.

## Les deux pièges de la formule, mesurés

1. **`bun install` doit tourner APRÈS `prefix.install`**, pas avant. La copie
   détruit la disposition que bun crée dans `node_modules/.bun` ; le service
   meurt alors sur `Cannot find module '@herdr-remote/shared'`.
2. **Le bloc `service` doit donner un `PATH`** (`std_service_path_env`). Sans
   lui, launchd démarre avec `/usr/bin:/bin` seulement, le lanceur ne trouve pas
   `bun`, et sort en 1 — sans écrire une seule ligne de journal.

Et le nom de la formule est **imposé par celui du tap** : `homebrew-herdr-chat`
⇒ `herdr-chat.rb`. `herdrchat.rb` ne se trouve jamais.

## État

Publié : `v0.1.0` sur `xDelph/herdr-chat`, formule dans
`xDelph/homebrew-herdr-chat`. Vérifié de bout en bout : `brew services list`
→ `started`, l'API répond en local et à travers le tailnet.


## Forme B — binaire natif (T066/T068)

Ce qui a changé, et pourquoi la forme B est maintenant possible :

| Sujet | Forme A (TS, publiée `v0.1.x`) | Forme B (Rust, préparée) |
|---|---|---|
| Exécutable | `bin/herdrchat` → `bun run apps/server/src/main.ts` | binaire `herdrchat`, aucun Bun/Node à l'exécution |
| PWA | lue dans le keg (`apps/web/dist`) | **embarquée** dans le binaire par `crates/herdrchat/build.rs` ; un build de release sans `apps/web/dist` échoue |
| Archive | tarball de l'arborescence + `bun install` dans la formule | `herdr-chat-<cible>.tar.gz` : `herdrchat`, `LICENSE`, `README.md`, `manifest.json`, gabarits de service ; `.sha256` à côté |
| Cibles | une (arborescence) | macOS arm64 (`macos-15`), macOS x86_64 (`macos-15-intel`), Linux x86_64 (`ubuntu-22.04`), Linux aarch64 (`ubuntu-22.04-arm`) — chacune construite ET exécutée sur son runner natif |
| Workflow | `release.yml` (retiré) | `.github/workflows/release-rust.yml` : portes (`xtask verify`, `xtask coverage`, `bun run verify`) → binaires → release GitHub sur étiquette `v*` |
| Formule | `xDelph/homebrew-herdr-chat` (publiée) | gabarit `packaging/herdr-chat.rb` (non publié : URL/empreintes à remplir depuis la release) |
| Service macOS | `brew services` (bloc `service` + `PATH` pour trouver `bun`) | `brew services` (bloc `service` + `PATH` pour trouver `git`, `tailscale` et les CLI d'agents ; journal `$(brew --prefix)/var/log/herdr-chat.log`) **ou** LaunchAgent `packaging/dev.herdr.chat.plist` |
| Service Linux | — | `packaging/herdr-chat.service` (systemd utilisateur) |

Les variables d'environnement sont **inchangées** (`HERDR_REMOTE_*`,
`HERDR_SOCKET_PATH`, racines de sessions) : le même service peut changer de
binaire sans changer de configuration. Le magasin push garde le même chemin
par défaut (`~/.herdr-remote/push.json`).

Le premier piège de la forme A (`bun install` après `prefix.install`)
**disparaît** : il n'y a plus de `node_modules`. Le second **reste**, pour une
autre raison : le binaire n'a plus d'interpréteur à trouver, mais il lance
`git`, `tailscale` et les CLI des agents (`pi --list-models`, `codex debug
models`, `claude`) par leur nom. Sous launchd (`/usr/bin:/bin`), un agent
installé hors de Homebrew n'avait plus de catalogue. Le bloc `service` donne
donc un `PATH` (Homebrew, `~/.local/bin`, `~/.bun/bin`, système), un journal,
et la formule le dit dans ses `caveats` (2026-10-29).

Rien n'est publié ni basculé par ce dépôt : la procédure, les contrôles et le
retour arrière sont dans [`BASCULE.md`](BASCULE.md) et attendent une
instruction explicite.
