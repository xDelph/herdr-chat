#!/usr/bin/env bash
# Écrans de démarrage iOS (`apple-touch-startup-image`) — générés, pas dessinés.
#
# ⚠️ iOS n'utilise PAS le manifeste pour l'écran de lancement d'une PWA : sans
# une image aux dimensions EXACTES de l'appareil, il montre un écran blanc,
# même en mode sombre. Chaque image est l'icône maskable (sans bande) centrée
# sur sa propre couleur de fond, qui remplit tout l'écran.
#
# Usage : scripts/ecrans-demarrage.sh — réécrit apps/web/public/splash/ et le
# bloc balisé de apps/web/index.html. macOS seulement (`sips`).
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
source_icone="$racine/apps/web/public/icon-maskable-512.png"
sortie="$racine/apps/web/public/splash"
index="$racine/apps/web/index.html"
fond="0F1A2E"

# largeur hauteur ratio (CSS px, portrait) — iPhone puis iPad.
appareils=(
  "375 667 2" "375 812 3" "390 844 3" "393 852 3" "402 874 3" "414 896 2"
  "414 896 3" "428 926 3" "430 932 3" "440 956 3"
  "744 1133 2" "768 1024 2" "810 1080 2" "820 1180 2" "834 1194 2"
  "834 1210 2" "1024 1366 2" "1032 1376 2"
)

rm -rf "$sortie"
mkdir -p "$sortie"
temporaire="$(mktemp -d)"
trap 'rm -rf "$temporaire"' EXIT

balises=""
genere() {
  local largeur=$1 hauteur=$2 ratio=$3 orientation=$4
  local l=$((largeur * ratio)) h=$((hauteur * ratio))
  if [ "$orientation" = landscape ]; then
    local t=$l
    l=$h
    h=$t
  fi
  # Jamais agrandie au-delà de la source (512 px) : une icône étirée est floue.
  local cote=$(((l < h ? l : h) * 45 / 100))
  if [ "$cote" -gt 512 ]; then cote=512; fi
  local nom="splash-${l}x${h}.png"
  # (`sips` trace ses couleurs sur stderr : du bruit, pas une erreur.)
  sips -z "$cote" "$cote" "$source_icone" --out "$temporaire/icone.png" >/dev/null 2>&1
  sips -p "$h" "$l" --padColor "$fond" "$temporaire/icone.png" --out "$sortie/$nom" >/dev/null 2>&1
  [ -s "$sortie/$nom" ] || { echo "échec : $nom" >&2; exit 1; }
  balises+="    <link rel=\"apple-touch-startup-image\" href=\"/splash/$nom\" media=\"(device-width: ${largeur}px) and (device-height: ${hauteur}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})\" />"$'\n'
}

for appareil in "${appareils[@]}"; do
  read -r largeur hauteur ratio <<<"$appareil"
  genere "$largeur" "$hauteur" "$ratio" portrait
  # L'iPad tourne : son écran de démarrage aussi.
  if [ "$largeur" -ge 744 ]; then genere "$largeur" "$hauteur" "$ratio" landscape; fi
done

# Le bloc balisé de index.html est remplacé en entier.
debut="<!-- ecrans-demarrage:debut (scripts/ecrans-demarrage.sh) -->"
fin="<!-- ecrans-demarrage:fin -->"
BALISES="$balises" DEBUT="$debut" FIN="$fin" perl -0pi -e '
  my $bloc = "$ENV{DEBUT}\n$ENV{BALISES}    $ENV{FIN}";
  s/\Q$ENV{DEBUT}\E.*?\Q$ENV{FIN}\E/$bloc/s or die "bloc balisé absent de index.html\n";
' "$index"
echo "$(ls "$sortie" | wc -l | tr -d ' ') écrans de démarrage → $sortie"
