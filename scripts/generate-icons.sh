#!/usr/bin/env bash
#
# Régénère les icônes PNG à partir des SVG sources.
#
# Pourquoi cette étape est importante : les navigateurs Android n'affichent pas
# toujours le bouton « Installer » pour une PWA dont le manifest ne déclare que
# des icônes SVG. Le PNG est le format attendu. On garde les SVG comme source et
# comme complément (navigateurs qui les acceptent), mais le PNG fait foi.
#
# Prérequis : rsvg-convert (paquet librsvg2-bin) ou ImageMagick.
#
# Usage : npm run icons

set -euo pipefail

cd "$(dirname "$0")/../frontend/icons"

# Icône « any » : coins arrondis, telle qu'affichée dans un launcher classique.
rsvg-convert -w 192 -h 192 icon-192.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon-512.svg -o icon-512.png

# Icône « maskable » : fond pleine page, motif dans la zone de sécurité (80 %
# centraux) pour survivre au masquage circulaire ou en pastille du launcher.
rsvg-convert -w 192 -h 192 icon-maskable.svg -o icon-192-maskable.png
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icon-512-maskable.png

# Icône iOS : iOS ignore le manifest et applique son propre masque, donc on
# part d'un carré plein, sans coins arrondis.
rsvg-convert -w 180 -h 180 icon-apple.svg -o apple-touch-icon.png

echo "Icônes régénérées :"
for f in *.png; do
  printf "  %-24s %s\n" "$f" "$(file -b "$f" | cut -d, -f1-2)"
done
