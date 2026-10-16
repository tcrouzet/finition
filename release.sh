#!/bin/bash
# chmod +x release.sh
# À lancer depuis plugin/ (là où vivent manifest.json, commit.json, package.json).
set -e

# Variables
REPO=$(jq -r '.repo' commit.json)
TAG=$(jq -r '.version' manifest.json)
RELEASE_NAME="$TAG"
DESCRIPTION="Release $TAG"
FILES=("main.js" "manifest.json" "styles.css")

# Rebuild de production avant de packager (régénère styles.css depuis
# palette.css + styles.base.css, puis main.js minifié sans sourcemap ;
# data/*.json et modes/*.ts sont tous les deux inlinés dans main.js par
# esbuild, rien à distribuer à part — install aussi simple que n'importe
# quel plugin Obsidian, compatible BRAT/store officiel).
npm run build

# Créer la release (gh crée et pousse automatiquement le tag "$TAG" s'il
# n'existe pas déjà sur le dépôt).
gh release create "$TAG" "${FILES[@]}" \
  --repo "$REPO" \
  --title "$RELEASE_NAME" \
  --notes "$DESCRIPTION"
