#!/usr/bin/env bash
# Agent de test JETABLE — pour vérifier le chemin Herdr → pane → prompt.
#
# ⛔ Ne jamais viser un agent lancé par l'utilisateur. Ce script crée le sien,
#    dans un répertoire temporaire, sans fichier de session, et le ferme.
#
# Usage :
#   scripts/test-agent.sh start    # crée le pane de test et affiche son identifiant
#   scripts/test-agent.sh stop     # ferme le pane de test
#   scripts/test-agent.sh status   # vérifie qu'il tourne encore
set -euo pipefail

DIR="${HERDR_TEST_DIR:-/tmp/herdr-remote-test-agent}"
NAME="herdr-remote-test"
LABEL="herdr-remote-test"

herdr_available() { command -v herdr >/dev/null 2>&1; }

find_test_pane() {
  herdr api snapshot 2>/dev/null | jq -r --arg n "$NAME" \
    '.result.snapshot.agents[]? | select(.agent == "pi") | select((.terminal_title // "") | test($n)) | .pane_id' \
    | head -1
}

case "${1:-status}" in
  start)
    if ! herdr_available; then
      echo "herdr absent : utiliser 'pi --print --no-session' à la place" >&2
      exit 2
    fi
    existing="$(find_test_pane)"
    if [ -n "$existing" ]; then
      echo "pane de test déjà actif : $existing"
      exit 0
    fi
    mkdir -p "$DIR"
    # Nouvel onglet dédié : n'écrase aucun pane de travail existant.
    pane="$(herdr tab create --label "$LABEL" 2>/dev/null | tail -1 || true)"
    echo "onglet de test créé : ${pane:-<inconnu>}"
    echo "répertoire : $DIR"
    echo
    echo "Lancer l'agent à la main dans ce pane (le script n'injecte rien) :"
    echo "  cd $DIR && pi --no-session --name $NAME"
    ;;
  stop)
    pane="$(find_test_pane)"
    if [ -z "$pane" ]; then
      echo "aucun pane de test actif"
      exit 0
    fi
    herdr pane close "$pane" 2>/dev/null || herdr pane kill "$pane" 2>/dev/null || true
    echo "pane de test fermé : $pane"
    rm -rf "$DIR"
    ;;
  status)
    pane="$(find_test_pane)"
    if [ -n "$pane" ]; then echo "pane de test actif : $pane"; else echo "aucun pane de test"; fi
    ;;
  *)
    echo "usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
