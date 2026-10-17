#!/bin/bash
set -euo pipefail

fail() { printf '%s\n' "$1" >&2; exit 1; }
for tool in curl jq; do
  command -v "$tool" >/dev/null || fail "Commande manquante : $tool"
done
[ "$#" -le 2 ] || fail 'Usage : bash install.sh [chemin-du-coffre] [dossier-configuration]'
VAULT=${1:-}
CONFIG=${2:-.obsidian}
case "$CONFIG" in ''|.|..|*/*|*\\*) fail 'Le dossier de configuration doit être un simple nom, par exemple .obsidian.' ;; esac

if [ -z "$VAULT" ]; then
  REGISTRIES=()
  case "$(uname -s)" in
    Darwin) REGISTRIES=("$HOME/Library/Application Support/obsidian/obsidian.json") ;;
    Linux) REGISTRIES=("${XDG_CONFIG_HOME:-$HOME/.config}/obsidian/obsidian.json" "$HOME/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json" "$HOME/snap/obsidian/current/.config/obsidian/obsidian.json") ;;
    MINGW*|MSYS*|CYGWIN*) REGISTRIES=("${APPDATA:-}/obsidian/obsidian.json") ;;
    *) fail 'Système non reconnu. Indique le chemin du coffre en argument.' ;;
  esac
  EXISTING=()
  for registry in "${REGISTRIES[@]}"; do
    if command -v cygpath >/dev/null; then registry=$(cygpath -u "$registry"); fi
    [ ! -f "$registry" ] || EXISTING+=("$registry")
  done
  [ "${#EXISTING[@]}" -gt 0 ] || fail 'Aucun registre Obsidian trouvé. Indique le coffre : bash install.sh "/chemin/du/coffre"'
  PATHS=$(jq -sr '[.[] | .vaults[]?.path | select(type == "string")] | unique[]' "${EXISTING[@]}")
  VAULTS=()
  while IFS= read -r candidate; do
    if command -v cygpath >/dev/null; then candidate=$(cygpath -u "$candidate"); fi
    [ ! -d "$candidate/$CONFIG" ] || VAULTS+=("$candidate")
  done <<< "$PATHS"
  [ "${#VAULTS[@]}" -gt 0 ] || fail 'Aucun coffre accessible. Indique son chemin en argument.'
  for ((i=0; i<${#VAULTS[@]}; i++)); do printf '%s. %s\n' "$((i+1))" "${VAULTS[$i]}"; done
  read -r -p 'Numéro du coffre (Entrée pour annuler) : ' CHOICE || fail 'Choix manquant : indique le coffre en argument.'
  [ -n "$CHOICE" ] || exit 0
  [[ "$CHOICE" =~ ^[1-9][0-9]*$ ]] || fail 'Numéro de coffre invalide.'
  [ "${#CHOICE}" -le 6 ] && [ "$CHOICE" -le "${#VAULTS[@]}" ] || fail 'Numéro de coffre invalide.'
  VAULT=${VAULTS[$((CHOICE-1))]}
fi
[ -d "$VAULT/$CONFIG" ] || fail "Dossier de configuration introuvable : $VAULT/$CONFIG"
VAULT=$(cd -- "$VAULT" && pwd -P)
TARGET="$VAULT/$CONFIG/plugins/finition"
[ ! -L "$TARGET" ] || fail 'Installation refusée dans un lien symbolique.'
printf 'Ferme Obsidian avant de continuer.\nDestination : %s\n' "$TARGET"
read -r -p 'Installer ou mettre à jour Finition ici ? [o/N] : ' ANSWER || fail 'Confirmation manquante.'
case "$ANSWER" in o|O|oui|y|Y|yes) ;; *) printf 'Installation annulée.\n'; exit 0 ;; esac

FILES=(main.js manifest.json styles.css)
TEMP=$(mktemp -d "${TMPDIR:-/tmp}/finition-download.XXXXXX")
STAGE=''
BACKUP=''
INSTALLING=0
cleanup() {
  status=$?
  trap - EXIT
  set +e
  if [ "$INSTALLING" -eq 1 ]; then
    printf 'Installation interrompue ; restauration de la version précédente.\n' >&2
    for file in "${FILES[@]}"; do
      if [ -n "$BACKUP" ] && [ -f "$BACKUP/$file" ]; then
        if ! cp "$BACKUP/$file" "$STAGE/$file" || ! mv -f "$STAGE/$file" "$TARGET/$file"; then
          printf 'Restauration manuelle nécessaire depuis %s\n' "$BACKUP" >&2
          status=1
        fi
      else
        rm -f -- "$TARGET/$file"
      fi
    done
  fi
  for file in "${FILES[@]}"; do
    rm -f -- "$TEMP/$file"
    [ -z "$STAGE" ] || rm -f -- "$STAGE/$file"
  done
  rmdir -- "$TEMP"
  [ -z "$STAGE" ] || rmdir -- "$STAGE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

RELEASE=$(curl --fail --location --silent --show-error --connect-timeout 15 --max-time 300 'https://api.github.com/repos/tcrouzet/finition/releases/latest')
VERSION=$(jq -er '.tag_name | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' <<< "$RELEASE")
jq -e '.draft == false and .prerelease == false and ([.assets[].name] | contains(["main.js", "manifest.json", "styles.css"]))' <<< "$RELEASE" >/dev/null || fail 'Release stable incomplète.'
for file in "${FILES[@]}"; do
  curl --fail --location --silent --show-error --connect-timeout 15 --max-time 300 \
    "https://github.com/tcrouzet/finition/releases/download/$VERSION/$file" --output "$TEMP/$file"
  [ -s "$TEMP/$file" ] || fail "Fichier téléchargé vide : $file"
done
jq -e --arg version "$VERSION" '.id == "finition" and .version == $version' "$TEMP/manifest.json" >/dev/null || fail 'Manifest téléchargé incompatible avec la release.'

if [ -d "$TARGET" ]; then
  mkdir -p "$VAULT/$CONFIG/finition-backups"
  BACKUP=$(mktemp -d "$VAULT/$CONFIG/finition-backups/release.XXXXXX")
  for file in "${FILES[@]}"; do
    [ ! -f "$TARGET/$file" ] || cp "$TARGET/$file" "$BACKUP/$file"
  done
  printf 'Sauvegarde : %s\n' "$BACKUP"
fi
mkdir -p "$TARGET"
STAGE=$(mktemp -d "$TARGET/.finition-install.XXXXXX")
for file in "${FILES[@]}"; do cp "$TEMP/$file" "$STAGE/$file"; done
INSTALLING=1
for file in "${FILES[@]}"; do mv -f "$STAGE/$file" "$TARGET/$file"; done
INSTALLING=0
printf 'Finition %s installé. Rouvre Obsidian et active Finition dans Réglages → Plugins communautaires.\n' "$VERSION"
