#!/usr/bin/env bash
# Porte de vérification unique — format, lint, typecheck, tests.
# Utilisée par le hook pre-commit et par la CI. S'arrête au premier échec.
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun run verify
