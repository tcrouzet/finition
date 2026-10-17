#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

fail() { printf '%s\n' "$1" >&2; exit 1; }
for tool in gh jq; do
  command -v "$tool" >/dev/null || fail "Commande manquante : $tool"
done
gh auth status >/dev/null 2>&1 || fail "Connecte GitHub CLI avec gh auth login, puis relance submit.sh."
jq -e '.id | type == "string" and length > 0' manifest.json >/dev/null || fail "Identifiant absent du manifest."
VERSION=$(jq -er '.version | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' manifest.json)
REPOSITORY=$(gh repo view --json nameWithOwner,isPrivate)
jq -e '.isPrivate == false' <<< "$REPOSITORY" >/dev/null || fail "Le dépôt GitHub doit être public."
REPO=$(jq -er '.nameWithOwner' <<< "$REPOSITORY")

PUBLISHED=$(gh api "repos/$REPO/contents/manifest.json" --jq '.content | @base64d | fromjson')
jq -en --slurpfile local manifest.json --argjson published "$PUBLISHED" '$local[0] == $published' >/dev/null \
  || fail "Le manifest local diffère de la branche GitHub par défaut. Commits et push à effectuer avant la soumission."
RELEASE=$(gh release view "$VERSION" --repo "$REPO" --json tagName,isDraft,isPrerelease,assets)
jq -e --arg version "$VERSION" '
  .tagName == $version and .isDraft == false and .isPrerelease == false
  and ([.assets[].name] | contains(["main.js", "manifest.json"]))
' <<< "$RELEASE" >/dev/null || fail "Publie une release stable $VERSION avec main.js et manifest.json."
RELEASE_MANIFEST=$(gh release download "$VERSION" --repo "$REPO" --pattern manifest.json --output -)
jq -en --slurpfile local manifest.json --argjson released "$RELEASE_MANIFEST" '$local[0] == $released' >/dev/null \
  || fail "Le manifest joint à la release diffère du manifest publié."

printf 'Release vérifiée : https://github.com/%s/releases/tag/%s\n' "$REPO" "$VERSION"
printf 'Soumission initiale : https://community.obsidian.md/account/plugins\nDépôt à renseigner : https://github.com/%s\n' "$REPO"
printf '%s\n' 'Connecte ton compte Obsidian et ton compte GitHub, puis Plugins → New plugin.'
printf '%s\n' 'Valide toi-même les règles et le formulaire. Ce script ne soumet rien automatiquement.'
printf '%s\n' 'Si Finition est déjà accepté au catalogue, aucune nouvelle soumission : utilise release.sh.'
if command -v open >/dev/null; then
  open "https://community.obsidian.md/account/plugins"
fi
