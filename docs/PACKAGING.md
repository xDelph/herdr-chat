# Herdr Chat — packaging Homebrew

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
