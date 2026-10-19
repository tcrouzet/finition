#!/bin/bash
# chmod +x build-grammalecte.sh
# ./build-grammalecte.sh
# Build Grammalecte + copie directe dans le plugin Finition.
# Usage : lance ce script depuis n'importe où, il se débrouille.
set -e

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="/tmp/grammalecte-build-$"

echo "→ Clone dans $TMP_DIR"
git clone --depth 1 https://github.com/Pofilo/grammalecte "$TMP_DIR"
cd "$TMP_DIR"

echo "→ Build JS (français)"
python3 make.py fr -js

DEST="$PLUGIN_DIR/plugin/data/grammalecte"
PUBLIC_DATA="$PLUGIN_DIR/ressources/grammalecte"
mkdir -p "$DEST" "$PUBLIC_DATA"

echo "→ Copie des fichiers moteur + dictionnaires vers $DEST"
cp -r "$TMP_DIR/_build/webext/fr/grammalecte/graphspell"/*.js "$DEST/"
cp -r "$TMP_DIR/_build/webext/fr/grammalecte/graphspell/_dictionaries" "$PUBLIC_DATA/_dictionaries"
cp "$TMP_DIR/_build/webext/fr/grammalecte/text.js" "$DEST/"
cp "$TMP_DIR/_build/webext/fr/grammalecte/fr/"*.js "$DEST/"
cp "$TMP_DIR/_build/webext/fr/grammalecte/fr/"*_data.json "$PUBLIC_DATA/"

echo "→ Nettoyage"
rm -rf "$TMP_DIR"

echo "✓ Terminé. Fichiers copiés dans : $DEST"
ls "$DEST"
