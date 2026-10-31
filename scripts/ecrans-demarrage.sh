#!/usr/bin/env bash
# Écrans de démarrage iOS (`apple-touch-startup-image`) — générés, pas dessinés.
#
# ⚠️ iOS n'utilise PAS le manifeste pour l'écran de lancement d'une PWA : sans
# une image aux dimensions EXACTES de l'appareil, il montre un écran blanc,
# même en mode sombre.
#
# ⚠️ **Le même dessin que l'écran de démarrage HTML** (`index.html`,
# `.demarrage`) : la couleur de fond de l'app (clair et sombre), l'icône
# arrondie de 88 pt au centre. iOS montre l'image, puis la page la remplace
# par le même dessin au même endroit — sans saut, jusqu'au squelette de la
# liste (retour du 2026-10-31).
#
# Usage : scripts/ecrans-demarrage.sh — réécrit apps/web/public/splash/,
# apps/web/public/icone-demarrage.png et le bloc balisé de apps/web/index.html.
# Demande ImageMagick (`magick`) — l'arrondi de l'icône.
set -euo pipefail

command -v magick >/dev/null || { echo "ImageMagick (magick) est requis" >&2; exit 1; }

racine="$(cd "$(dirname "$0")/.." && pwd)"
source_icone="$racine/apps/web/public/icon-maskable-512.png"
public="$racine/apps/web/public"
sortie="$public/splash"
index="$racine/apps/web/index.html"
# Les fonds de l'app (`--ground` de tokens.css).
fond_clair="#f1f2f4"
fond_sombre="#0c0e12"
# L'icône : 88 pt, coins arrondis comme une icône iOS (22,5 %).
icone_pt=88

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

# L'icône arrondie, à une taille donnée (en pixels).
icone_arrondie() {
  local taille=$1 cible=$2
  local rayon=$((taille * 225 / 1000))
  magick "$source_icone" -resize "${taille}x${taille}" \
    \( -size "${taille}x${taille}" xc:none -fill white \
       -draw "roundrectangle 0,0,$((taille - 1)),$((taille - 1)),$rayon,$rayon" \) \
    -alpha set -compose DstIn -composite "$cible"
}

# L'icône de l'écran de démarrage HTML (88 pt en @3x).
icone_arrondie $((icone_pt * 3)) "$public/icone-demarrage.png"

balises=""
genere() {
  local largeur=$1 hauteur=$2 ratio=$3 orientation=$4 theme=$5
  local l=$((largeur * ratio)) h=$((hauteur * ratio))
  if [ "$orientation" = landscape ]; then
    local t=$l
    l=$h
    h=$t
  fi
  local fond=$fond_clair
  [ "$theme" = sombre ] && fond=$fond_sombre
  local taille=$((icone_pt * ratio))
  local nom="splash-${theme}-${l}x${h}.png"
  [ -f "$temporaire/icone-$taille.png" ] || icone_arrondie "$taille" "$temporaire/icone-$taille.png"
  magick -size "${l}x${h}" "xc:$fond" "$temporaire/icone-$taille.png" \
    -gravity center -composite -strip "$sortie/$nom"
  [ -s "$sortie/$nom" ] || { echo "échec : $nom" >&2; exit 1; }
  local media="(device-width: ${largeur}px) and (device-height: ${hauteur}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})"
  [ "$theme" = sombre ] && media="(prefers-color-scheme: dark) and $media"
  balises+="    <link rel=\"apple-touch-startup-image\" href=\"/splash/$nom\" media=\"$media\" />"$'\n'
}

# ⚠️ Le clair d'abord, SANS condition de thème : un iOS qui ignorerait
# `prefers-color-scheme` dans ces requêtes retombe sur lui — jamais sur le
# blanc. Le sombre suit, conditionné.
for theme in clair sombre; do
  for appareil in "${appareils[@]}"; do
    read -r largeur hauteur ratio <<<"$appareil"
    genere "$largeur" "$hauteur" "$ratio" portrait "$theme"
    # L'iPad tourne : son écran de démarrage aussi.
    if [ "$largeur" -ge 744 ]; then genere "$largeur" "$hauteur" "$ratio" landscape "$theme"; fi
  done
done

# Le bloc balisé de index.html est remplacé en entier.
debut="<!-- ecrans-demarrage:debut (scripts/ecrans-demarrage.sh) -->"
fin="<!-- ecrans-demarrage:fin -->"
BALISES="$balises" DEBUT="$debut" FIN="$fin" perl -0pi -e '
  my $bloc = "$ENV{DEBUT}\n$ENV{BALISES}    $ENV{FIN}";
  s/\Q$ENV{DEBUT}\E.*?\Q$ENV{FIN}\E/$bloc/s or die "bloc balisé absent de index.html\n";
' "$index"
echo "$(ls "$sortie" | wc -l | tr -d ' ') écrans de démarrage → $sortie"
