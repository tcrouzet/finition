#!/bin/bash
# chmod +x release.sh
# À lancer depuis plugin/ (là où vivent manifest.json, package.json), dans
# un dépôt git avec un remote "origin" GitHub déjà configuré. Générique :
# même script réutilisable tel quel sur n'importe lequel de tes autres
# plugins, sans fichier de config à maintenir (gh déduit le repo du remote).
set -e

# Arbre propre exigé (le script commite lui-même le bump)
[ -z "$(git status --porcelain)" ] || { echo "Arbre git non propre" >&2; exit 1; }

# Incrément automatique du patch : 0.5.0 -> 0.5.1
CURRENT=$(jq -r '.version' manifest.json)
TAG="${CURRENT%.*}.$(( ${CURRENT##*.} + 1 ))"
MIN_APP=$(jq -r '.minAppVersion' manifest.json)

jq --arg v "$TAG" '.version = $v' manifest.json > manifest.tmp && mv manifest.tmp manifest.json
jq --arg v "$TAG" '.version = $v' package.json > package.tmp && mv package.tmp package.json
[ -f versions.json ] && jq --arg v "$TAG" --arg m "$MIN_APP" '. + {($v): $m}' versions.json > versions.tmp && mv versions.tmp versions.json


# Variables
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
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
