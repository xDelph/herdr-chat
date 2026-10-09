# Herdr Remote — Chaîne d'outils (vérifié)

> Sorties `--help` capturées le **2026-10-09** sur les versions épinglées.
> Ces drapeaux sont **lus, pas devinés** (exigence T0.2).

---

## Versions exécutées

| Outil | Version | Binaire résolu |
|---|---|---|
| `bun` | `1.4.2` | `~/.nvm/versions/node/v24.21.0/bin/bun` |
| `node` | `v24.21.0` (LTS Krypton) | idem |
| `npm` | `11.19.0` | idem |
| `oxlint` | `1.87.0` | via `bunx` |
| `oxfmt` | `0.72.0` | via `bunx` |

---

## Oxlint 1.87.0 — syntaxe réelle

```
Usage: [-c=<./.oxlintrc.json>] [PATH]...
```

### Configuration
| Drapeau | Effet |
|---|---|
| `-c, --config=<./.oxlintrc.json>` | fichier de config. `.json` et `.jsonc` supportés partout ; `.ts`/`.js` **expérimental** et exige Node |
| `--tsconfig=<./tsconfig.json>` | override du tsconfig. **Inutile ici** : la découverte automatique fonctionne |
| `--init` | génère une config par défaut |

### Catégories (accumulables de gauche à droite)
`correctness` (défaut) · `suspicious` · `pedantic` · `perf` · `style` · `restriction` · `nursery` · `all` (= tout sauf `nursery`)

Exemples : `-D correctness -A no-debugger`, `-A all -D no-debugger`

### Sélection de règles
| Drapeau | Effet |
|---|---|
| `-A, --allow=NAME` | autorise / supprime |
| `-W, --warn=NAME` | avertissement |
| `-D, --deny=NAME` | erreur |

### Plugins
| Drapeau | État par défaut |
|---|---|
| `unicorn-plugin` | **activé** |
| `oxc-plugin` | **activé** |
| `typescript-plugin` | **activé** |
| `react-plugin` | ⚠️ **DÉSACTIVÉ par défaut** |
| `jsx-a11y-plugin` | désactivé |
| `react-perf-plugin` | désactivé |
| `promise-plugin` | désactivé — **à activer** (cf. T1.5 `no-floating-promises`) |
| `import-plugin` | désactivé |
| `node-plugin` | désactivé |

### Corrections
| Drapeau | Effet |
|---|---|
| `--fix` | corrige ce qui peut l'être ; signale le reste |
| `--fix-suggestions` | applique les suggestions auto-corrigeables. **Peut changer le comportement** |
| `--fix-dangerously` | corrections dangereuses |

### Points retenus pour `package.json`
- Lint : `oxlint --react-plugin --jsx-a11y-plugin --react-perf-plugin --promise-plugin -c .oxlintrc.json apps packages`
- Lint fix : même commande `+ --fix`
- ⚠️ **Ne pas utiliser `--fix-dangerously` dans un hook de commit.**

---

## Oxfmt 0.72.0 — syntaxe réelle

```
Usage: [-c=PATH] [PATH]...
```

### Modes
| Drapeau | Effet |
|---|---|
| `--write` | ⚠️ **C'EST LE DÉFAUT** — formate **en place** |
| `--check` | vérifie le formatage et affiche des statistiques |
| `--list-different` | liste les fichiers qui seraient modifiés |

### Config
| Drapeau | Effet |
|---|---|
| `--init` | génère `.oxfmtrc.json` |
| `--migrate=SOURCE` | migre depuis `prettier` ou `biome` |
| `-c, --config=PATH` | `.json`, `.jsonc`, `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` |
| `--disable-nested-config` | ne cherche pas les configs dans les sous-dossiers |

> Le fichier de config s'appelle **`.oxfmtrc.json`** — pas `.prettierrc`.

### Ignores
| Drapeau | Effet |
|---|---|
| `--ignore-path=PATH` | répétable. **Par défaut `.gitignore` et `.prettierignore` du répertoire courant sont déjà utilisés** |
| `--with-node-modules` | formate `node_modules` (ignoré par défaut) |

### Exécution
| Drapeau | Effet |
|---|---|
| `--threads=INT` | `1` = un seul cœur |
| `--stdin-filepath=PATH` | infère le parseur |
| `--no-error-on-unmatched-pattern` | ne pas échouer si un motif ne correspond à rien |

### Points retenus pour `package.json`
- Format : `oxfmt apps packages` (écrit en place — comportement par défaut)
- Vérification : `oxfmt --check apps packages`
- Liste des écarts : `oxfmt --list-different apps packages`
- Le `.gitignore` étant lu par défaut, `node_modules` et `dist` sont exclus sans configuration supplémentaire.

---

## ⚠️ Pièges documentés

1. **`oxfmt` formate sans le dire.** Le mode `--write` est le **défaut**. Oublier `--check` dans une porte CI réécrit les fichiers et sort 0 : une CI ainsi construite ne détecterait jamais un écart de format. Toujours `--check` en vérification.
2. **`oxlint` n'analyse pas React par défaut.** Le plugin React est désactivé. Sans `--react-plugin`, la moitié du frontend passe sans lint.
3. **Les config `.ts`/`.js` d'Oxlint exigent Node.** Dans un projet 100 % Bun, rester sur `.json`/`.jsonc`.
4. **`bunx` résout et écrit un lockfile.** Utiliser la version épinglée (`bunx oxlint@1.87.0`) hors d'un contexte de projet pour ne pas polluer le lockfile du projet.
5. **`oxlint --rules` n'affiche rien** (sort 0, sortie vide), même avec un chemin en argument. Pour énumérer les règles disponibles, il faut lire le schéma : `definitions.OxlintRules` → `$ref` vers `definitions.DummyRuleMap` → récursivement les `properties` de chaque `definitions.*`. Cela donne les **871** règles d'oxlint 1.87.0.
6. **Oxlint échoue à *parser* la config si un nom de règle n'existe pas.** Message : `Rule '<nom>' not found in plugin '<plugin>'`. Une simple faute de frappe dans `.oxlintrc.json` casse tout le lint — garde-fou utile, mais les noms de règles ne doivent pas être devinés.

## Noms de règles réels (oxlint 1.87.0)

Deux noms que l'on aurait pu écrire intuitivement **n'existent pas** et font échouer le parsing de la config :

| Nom supposé | État réel |
|---|---|
| `no-explicit-any` (racine) | ❌ n'existe pas → utiliser **`typescript/no-explicit-any`** |
| `promise/no-floating-promises` | ❌ n'existe pas → la règle est dans le plugin `typescript` |

Noms vérifiés, utilisés dans `.oxlintrc.json` :

**Racine** : `no-console`, `no-debugger`, `no-var`, `prefer-const`, `eqeqeq`

**Plugin `typescript`** : `no-explicit-any`, `no-non-null-assertion`, `consistent-type-imports`, `no-floating-promises`, `no-misused-promises`

> ⚠️ `typescript/no-floating-promises` et `no-misused-promises` sont des règles **consciantes des types** : elles exigent le drapeau `--type-aware`, sinon elles ne sont jamais exécutées.

**Plugin `react`** : `exhaustive-deps`, `no-array-index-key`, `jsx-key`, `no-danger`

**Plugin `jsx-a11y`** : `alt-text`

**Plugin `promise`** : `always-return`, `no-return-in-finally`, `prefer-await-to-then`

> Le plugin `promise` ne porte **pas** les règles de promesses flottantes — celles-ci sont sous `typescript/`. `promise/catch-or-return` existe mais ne couvre pas l'oubli de `await`.

---

## Résultat de la première exécution réelle

État au 2026-10-09, dépôt sans fichier source :

| Porte | Code de sortie | Lecture correcte |
|---|---|---|
| `format:check` | `0` | ✅ verte (après `bun run format`) |
| `lint` | `1` | « No files found to lint » — **pas** une réussite déguisée |
| `typecheck` | `2` | `TS18003: No inputs were found` — code d'erreur `tsc`, donc le compilateur **tourne** |

**Test de non-décorativité de la porte format** : un fichier volontairement mal formaté a été créé, `format:check` a retourné `1`, le fichier supprimé, `format:check` a retourné `0`. La porte sait échouer.

---

## Typecheck (à compléter en T1.5)

Décision D001 : `typescript@7.0.2`, dont le binaire `tsc` **est** le compilateur natif (moteur `tsgo`). Commande : `tsc --noEmit -p tsconfig.json`.

Le temps de typecheck mesuré doit être consigné ici à l'exécution de T1.5 — c'est la **preuve** que le moteur natif est bien utilisé et non `tsc` en JavaScript.

---

## Installation Bun (procédure reproductible)

```bash
nvm use                      # lit .nvmrc → 24.21.0
npm install -g --allow-scripts=bun bun@1.4.2
```

`--allow-scripts=bun` est **obligatoire** : npm 11.19 bloque les `postinstall` par défaut, et c'est le `postinstall` (`install.js`) qui télécharge le binaire. Sans ce drapeau, `bun` est installé **sans binaire fonctionnel** et l'échec n'apparaît qu'à la première exécution.
---

## Mesure du typecheck (preuve du moteur natif) — T1.5

| Passe | Durée |
|---|---|
| 1 (à froid) | **0,37 s** |
| 2 | 0,17 s |
| 3 | 0,17 s |

`tsc --version` → **7.0.2**. Sur 6 fichiers TypeScript. Un `tsc` JavaScript mettrait plusieurs secondes à ce stade : la durée confirme que le **moteur natif (Go)** est bien utilisé, conformément à D001.

---

## `oxlint --type-aware` exige un paquet séparé

Découvert à l'exécution :

```
$ oxlint --type-aware …
Failed to find tsgolint executable. You may need to add the `oxlint-tsgolint` package to your project?
```

`--type-aware` délègue à **`oxlint-tsgolint@7.0.2003`** (binaire `tsgolint`), à installer en devDependency. Sans lui, `lint` sort en erreur — ce qui est préférable à un lint silencieusement amputé.

⚠️ Sans `--type-aware`, `typescript/no-floating-promises` et `no-misused-promises` **ne s'exécutent jamais**. Le drapeau est obligatoire pour que ces règles existent réellement.

---

## Pièges Effect 4 découverts à l'exécution

Effect 4 est une LTS récente et son API diffère de la v3 sur des points qui ne se voient **qu'à l'exécution**, pas au typecheck.

| Piège | Détail |
|---|---|
| **`Result.getFailure` renvoie un `Option<E>`** | Et **non** `E` comme en v3. Un `expect(getFailure(r)).toBeInstanceOf(X)` échoue avec un `Option.Some(...)` en valeur reçue. C'est l'erreur qui a coûté le plus de temps ici |
| `Context.Service<Self, Interface>()("id")` | Le service s'écrit ainsi, avec une couche statique attachée en propriété |
| `Effect.result(effect)` | Transforme l'échec typé en valeur de succès. **À préférer à l'inspection de `Cause`** dans les tests |
| `Cause.failureOption` **n'existe pas** | Utiliser `Cause.findFail` (renvoie un `Result`), ou éviter `Cause` via `Effect.result` |
| `Schema.decodeUnknownOption` / `decodeUnknownSync` | Existent bien. `decodeUnknownOption` renvoie un `Option`, conforme aux attentes |
| `Schema.Struct` **retire** les propriétés non déclarées | Typer `result` en `Struct({ type: String })` fait perdre tous les autres champs. Utiliser `Schema.Record(Schema.String, Schema.Unknown)` |
| `flatMap` / `map` / `withSpan` / `provide` | Restent « duals » (data-first et data-last). `pipe(x, Effect.map(f))` fonctionne |

---

## Convention de nommage des tests Bun

⚠️ `bun test` ne ramasse **pas** `__probe.ts`. Il découvre les fichiers selon les motifs `*.test.ts`, `*.spec.ts`, `*_test.ts`, `test_*.ts` et `__tests__/`.

Ce détail a produit un **faux négatif** lors de la preuve de la porte T1.7 : une sonde nommée `__probe.ts` n'était pas exécutée, et `bun test` sortait `0` en paraissant valider un test qui n'avait jamais tourné. **Nommer les sondes correctement.**

---

## Résultat de la preuve de non-décorativité (T1.7)

Les quatre portes ont été testées **dans les deux sens** :

| Sonde introduite | Porte | Exit attendu | Mesuré |
|---|---|---|---|
| `(x: any)` | `lint` | ≠ 0 | **1** ✅ |
| `.oxfmtrc` non respecté | `format:check` | ≠ 0 | **1** ✅ |
| `const h: number = "x"` | `typecheck` | ≠ 0 | **1** ✅ |
| `expect(1).toBe(2)` | `test` | ≠ 0 | **1** ✅ |
| *nettoyage* | `verify` | 0 | **0** ✅ |

Aucune sonde n'a subsisté après le test (vérifié).

---

## Règles React désactivées — et pourquoi

Quatre règles d'Oxlint sont désactivées explicitement dans `.oxlintrc.json`. Aucune n'est un contournement de code fautif : ce sont des heuristiques de performance issues du monde React Compiler, qui produisent des faux positifs sur cette base de code.

| Règle | Motif de la désactivation |
|---|---|
| `react/set-state-in-effect` | Déclenche sur la **scrutation d'API** et le chargement de session. Ce sont des **synchronisations avec un système externe** (Herdr), pas un état dérivé recalculé. Le `setState` a lieu dans une fonction asynchrone, pas de façon synchrone dans l'effet. |
| `react/exhaustive-effect-dependencies` | Signale comme « dépendances en trop » des dépendances qui **sont réellement utilisées** dans le corps. |
| `react/memo-dependencies` | Même motif que ci-dessus. |
| `react-perf/jsx-no-new-function-as-prop` | Heuristique de performance. Les handlers des listes sont déjà stabilisés par `useCallback` là où le re-rendu compte. |

`react/react-in-jsx-scope` est également désactivée : avec le runtime JSX automatique (`jsx: "react-jsx"`, React 17+), `React` **n'a pas besoin d'être en scope**, et la règle est un faux positif structurel.

**Contrepartie assumée** : ces désactivations réduisent la portée du lint React. Elles sont visibles dans le fichier de config, pas enfouies dans des commentaires `disable` éparpillés.

---

## Pièges React / Vite rencontrés

| Piège | Détail |
|---|---|
| `Schema.decodeUnknownOption` en React | Renvoie un **`Option`**, pas la valeur. Sans `Option.getOrUndefined`, `decoded.message` ne compile pas |
| `Schema<T>` en Effect 4 | **Un seul** paramètre de type (`Schema<A>`), pas `Schema<A, I>` comme en v3 |
| `decodeUnknownOption` exige `ConstraintDecoder` | Un helper générique `<A>(schema: Schema.Schema<A>)` **ne se conforme pas**. Il faut passer une **fonction de décodage** construite sur un schéma concret |
| Types dérivés des schémas | `typeof X.Type` évite toute divergence entre le décodage et le type affiché — et supprime le besoin d'assertions |
| Import CSS | Nécessite `vite/client` dans un `vite-env.d.ts`, sinon `TS2882` |

---

## Effet 4 : `zipRight` n'existe pas

**Quatre occurrences rencontrées.** `Effect.zipRight` n'existe pas en Effect 4 (il existait en v3). L'équivalent est **`Effect.andThen`**.

```ts
// ❌ Effect.zipRight existe en v3, pas en v4
Ref.update(n, (x) => x + 1).pipe(Effect.zipRight(Effect.log("…")))

// ✅
Effect.andThen(Ref.update(n, (x) => x + 1), Effect.log("…"))
```

Comme les autres écarts v3 → v4 rencontrés ici, **le typecheck le voit** — mais seulement si le fichier est typé, ce qui n'est pas le cas d'un script jetable.

## `Effect.scoped` ferme le scope dès que l'effet interne se termine

Piège lors de l'écriture des tests de veille :

```ts
// ❌ la fibre forkee est tuée avant que le `sleep` ne s'exécute
Effect.scoped(startWatchLoop(…)).pipe(Effect.andThen(Effect.sleep("250 millis")))

// ✅ le `sleep` est DANS le scope, la fibre vit pendant la veille
Effect.scoped(Effect.andThen(startWatchLoop(…), Effect.sleep("250 millis")))
```

`startWatchLoop` utilise `Effect.forkScoped` : la fibre est rattachée au scope. La sortir du scope la tue immédiatement.

## Récapitulatif des pièges Effect 4 rencontrés

| Piège | v3 | v4 |
|---|---|---|
| `Result.getFailure` | renvoie `E` | renvoie **`Option<E>`** |
| `Result.getOrUndefined` | — | renvoie la valeur de **succès**, jamais l'échec |
| `Cause.failureOption` | existe | **n'existe pas** → `Cause.findFail` ou `Effect.result` |
| `Effect.zipRight` | existe | **n'existe pas** → `Effect.andThen` |
| `Schema<T>` | `Schema<A, I>` | **un seul** paramètre de type |
| `decodeUnknownOption` | accepte `Schema<A>` | exige un **`ConstraintDecoder`** |
| `Schema.Struct` | conserve/retire selon option | **retire** les propriétés non déclarées |

**Règle** : pour toute opération sur `Result`, `Cause` ou `Schema`, vérifier la signature réelle dans `effect/dist/*.d.ts` avant d'écrire. Ces écarts ne se devinent pas.
