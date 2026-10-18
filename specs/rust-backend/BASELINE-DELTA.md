# Complément de baseline — découverte Codex

- Inventaire historique : `576bbf4902a00d3ef9702b4df315c943c7ac5680` ; CURRENT.md et CONTRACTS.md restent des photographies de cette révision.
- Base d’exécution de `plan/rust-backend` : `d19f98d23b02cacf7d6d9d97facf8d6360b0546b`, intégrée en avance rapide depuis main le 2026-10-18.
- Aucun code de migration n’a été écrit. Ce complément conserve une correction amont arrivée pendant la préparation du plan.

## Correction à reprendre à T023

[SessionLocator.ts](https://github.com/xDelph/herdr-chat/blob/d19f98d23b02cacf7d6d9d97facf8d6360b0546b/apps/server/src/agents/SessionLocator.ts) ajoute `nomsDeSessionCodex(titre, cwd)` ; `nomDeSessionCodex` conserve sa compatibilité en retournant le premier candidat.

1. Extraire les candidats seulement lorsque le suffixe du titre correspond au répertoire attendu.
2. Essayer d’abord le préfixe brut du titre.
3. Proposer ensuite, si différent et non vide, le préfixe sans décoration initiale correspondant à `/^[^\p{L}\p{N}]+\s+/u`.
4. Pour chaque candidat, vérifier le nom exact et le cwd dans l’index réel ; retenir le premier candidat prouvé.
5. Ne jamais supprimer systématiquement un glyphe : un titre authentique peut en commencer par un.

[Régressions amont](https://github.com/xDelph/herdr-chat/blob/d19f98d23b02cacf7d6d9d97facf8d6360b0546b/apps/server/src/agents/SessionLocator.test.ts) : conserver la découverte pendant le travail avec glyphe Braille et la priorité du titre brut lorsqu’il est réellement indexé. Les futurs tests Rust vont dans `crates/sessions/tests/`, jamais dans `src/`.

## Effet sur l’inventaire

Deux fichiers amont changent : le résolveur et ses tests. Aucun endpoint, schéma partagé, clé de configuration ou module supplémentaire. Les 89 capacités, 18 endpoints, 17 clés, 48 modules et 171 déclarations + 11 schémas restent les repères de couverture. L’export supplémentaire est couvert explicitement par T023 et ce complément, sans réécrire la photographie historique.
