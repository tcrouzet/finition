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

DEST="$PLUGIN_DIR/plugin/vendor/grammalecte"
PUBLIC_DATA="$PLUGIN_DIR/resources/grammalecte"
PREPARATION="$PLUGIN_DIR/scripts/grammalecte"
mkdir -p "$DEST" "$PUBLIC_DATA" "$PREPARATION/_dictionaries"

echo "→ Copie des fichiers moteur + dictionnaires vers $DEST"
cp -r "$TMP_DIR/_build/webext/fr/grammalecte/graphspell"/*.js "$DEST/"
for dictionary in fr-classic fr-reform; do
  cp "$TMP_DIR/_build/webext/fr/grammalecte/graphspell/_dictionaries/$dictionary.json" "$PREPARATION/_dictionaries/"
done
cp "$TMP_DIR/_build/webext/fr/grammalecte/graphspell/_dictionaries/fr-allvars.json" "$PREPARATION/_dictionaries/"
cp "$TMP_DIR/_build/webext/fr/grammalecte/text.js" "$DEST/"
cp "$TMP_DIR/_build/webext/fr/grammalecte/fr/"*.js "$DEST/"
for data in conj mfsp phonet thesaurus1 thesaurus2; do
  cp "$TMP_DIR/_build/webext/fr/grammalecte/fr/${data}_data.json" "$PUBLIC_DATA/"
done
cp "$TMP_DIR/_build/webext/fr/grammalecte/fr/tests_data.json" "$PREPARATION/"

(
  cd "$PLUGIN_DIR"
  npx --no-install jiti scripts/merge-lexicons.ts
)

echo "→ Nettoyage"
rm -rf "$TMP_DIR"

echo "✓ Terminé. Fichiers copiés dans : $DEST"
ls "$DEST"
