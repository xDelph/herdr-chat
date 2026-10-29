# Porte finale (T069)

Une seule commande, qui s'arrête au premier échec :

```bash
cargo run --locked -p xtask -- final-gate
```

Elle enchaîne, dans cet ordre :

| # | Étape | Ce qui la fait échouer |
|---|---|---|
| 1 | `xtask verify` → `verify-layout` | un test sous `src/` (Rust ou TS), un module `#[cfg(test)]`, un `include!` de test |
| 2 | `xtask verify` → `coverage` | une preuve introuvable, sous `src/` ou hors `tests/` ; un `proven` sans test **composé** (`crates/http-api/tests`, `crates/herdrchat/tests`, `apps/web/tests`) ; un `unit-only`/`not-wired` sans `gap` ; un statut inconnu ; une des 92 capacités (H01–H21…) ou 27 corrections absente |
| 3 | `xtask verify` → `graph` | une arête de production hors du graphe de TECH §2, un cycle |
| 4 | `xtask verify` → `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace --locked` | format, avertissement, test rouge |
| 5 | `bun install --frozen-lockfile` | lockfile désynchronisé |
| 6 | `bun run verify` | format, lint, typecheck ou test du front/`packages/shared` |
| 7 | `bun run build` | PWA qui ne compile pas |
| 8 | `xtask release --native` | build de release sans `apps/web/dist` (refusé par `crates/herdrchat/build.rs`), OpenSSL système dans les liens, archive/empreinte non écrite |
| 9 | binaire empaqueté `--version` avec `PATH=/usr/bin:/bin` | dépendance à Bun/Node ou à une bibliothèque absente |

Sortie : `dist/herdr-chat-<cible>/` (binaire, `manifest.json` avec
`validee: true` pour la cible native), `dist/herdr-chat-<cible>.tar.gz` et son
`.sha256`. Les autres cibles ne sont **validées** qu'en CI, sur leur runner
natif (`.github/workflows/release-rust.yml`) ; assemblées ailleurs, elles sont
`compile-only`.

La porte ne démarre aucun service et ne touche ni Homebrew, ni launchd, ni
Tailscale.

## Hors porte automatique (à joindre au dossier de revue)

| Contrôle | Commande | Remarque |
|---|---|---|
| Couverture détaillée | `cargo run --locked -p xtask -- coverage` | la liste `unit-only`/`not-wired`/`pending` et `todoAfterMerge` sont les limites à relire |
| Scénario navigateur fixture | `bun run build && cargo build -p herdrchat && bun scripts/scenario-fixture.ts <sortie>` | Chrome headless + `xtask fixture-daemon` (fausse Herdr, HOME temporaire, port libre) ; liste → chat → page d'historique → reconnexion → isolement ; captures + `rapport.json` ; code 1 si une étape échoue |
| Banc TS/Rust | `cargo run --locked -p xtask -- bench --stack ts --ts-root <worktree TS>` | le démon TS n'est plus dans l'arbre (T068), voir `BASCULE.md` §8 |
| Revue de l'écart | `git diff --stat <base>..HEAD` | chaque fichier expliqué dans `EXECUTION.md` |

## Ce que la porte ne prouve pas

- Les plateformes non natives de la machine qui l'exécute (compile-only hors CI).
- Safari/iPhone réel : le scénario tourne dans Chrome headless avec un viewport
  390×844 ; le protocole iPhone installé reste une revue humaine.
- Les entrées non `proven` de la matrice : elles sont **cohérentes** (décrites),
  pas **complètes**. `est_complete()` n'est vraie que lorsque tout est prouvé
  par composition.
