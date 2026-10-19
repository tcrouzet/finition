#!/bin/bash
# À lancer avec bash release.sh depuis la racine, ou par
# son chemin depuis un autre dossier (gh déduit le repo du remote origin).
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

REPOSITORY=$(gh repo view --json nameWithOwner,defaultBranchRef)
REPO=$(jq -er '.nameWithOwner' <<< "$REPOSITORY")
BRANCH=$(jq -er '.defaultBranchRef.name' <<< "$REPOSITORY")
[ "$(git branch --show-current)" = "$BRANCH" ] || { echo "Lance release.sh depuis la branche par défaut : $BRANCH" >&2; exit 1; }

RESOURCE_ASSETS_DIR=$(mktemp -d "${TMPDIR:-/tmp}/finition-resources.XXXXXX")
npm run resources -- "$RESOURCE_ASSETS_DIR"

git add .
if ! git diff --cached --quiet; then
  current_date=$(date +"%Y-%m-%d %H:%M:%S")
  git commit -m "sync before new release $current_date"
fi
git push -u origin "$BRANCH"

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
RELEASE_NAME="$TAG"
DESCRIPTION="Release $TAG"
FILES=("main.js" "manifest.json" "styles.css" "$RESOURCE_ASSETS_DIR/"*)

# Rebuild de production avant de packager (main.js minifié sans sourcemap).
# Les ressources linguistiques sont jointes séparément pour être
# téléchargées depuis les paramètres du plugin.
npm run build

#Git update
git add .
git commit -m "sync $TAG"
git push -u origin "$BRANCH"

PUBLISHED=$(gh api "repos/$REPO/contents/manifest.json" --jq '.content | @base64d | fromjson')
jq -en --slurpfile local manifest.json --argjson published "$PUBLISHED" '$local[0] == $published' >/dev/null \
  || { echo "Publication arrêtée : le manifest GitHub diffère du manifest de la release." >&2; exit 1; }

# Créer la release (gh crée et pousse automatiquement le tag "$TAG" s'il
# n'existe pas déjà sur le dépôt).
gh release create "$TAG" "${FILES[@]}" \
  --repo "$REPO" \
  --target "$(git rev-parse HEAD)" \
  --title "$RELEASE_NAME" \
  --notes "$DESCRIPTION"
