# Dictionnaires locaux

Toutes les sections de **Corrections** à **Palette** sont repliées par défaut dans les réglages. **Corrections IA** suit immédiatement **Corrections**, puis viennent **Synonymes**, **Définitions**, **Antonymes**, **Phonétique**, **Rimes**, **Répétitions**, **Cadence**, **Monotonie** et **Palette**. Cliquer sur leur titre les déplie ; une actualisation du panneau conserve les sections ouvertes pendant cette session.

Après **Synonymes**, chaque section de dictionnaire propose son propre sélecteur **Dictionnaire**, vide avant installation. **Finition → Charger** télécharge le pack public correspondant depuis les fichiers joints à la version GitHub du plugin ; **Recharger** permet de le récupérer à nouveau. Le téléchargement contrôle tailles et empreintes SHA-256, sélectionne Finition et conserve les dictionnaires personnels. Finition ne possède pas de bouton d’effacement. Les autres dictionnaires apparaissent avec leur nom, description éventuelle et bouton **Effacer**. **Charger un dictionnaire** accepte le chemin d’un JSON dans le coffre, relatif ou absolu sur ordinateur ; laisser le champ vide ouvre le sélecteur de fichiers. Le fichier doit correspondre à la section choisie. Le lien **JSON au format Finition** ouvre cette documentation. Une URL de documentation renseignée porte la description ; sans description, son libellé devient **Documentation**.

Sélectionner un seul mot, puis utiliser **Définitions**, **Antonymes**, **Phonétique** ou **Rimes** dans le menu ♫ ou la palette de commandes. Sans sélection valable, un message demande de sélectionner un mot. Sans dictionnaire sélectionné et disponible, la commande du menu est grisée. Les définitions et transcriptions sont consultables et copiables ; les antonymes et rimes peuvent remplacer le mot sélectionné. La sélection reste active après remplacement ou fermeture de la fenêtre. L’affichage est construit en HTML natif, sans interprétation Markdown ou HTML des données.

L’import valide le JSON et crée une copie identique dans `data/dictionnaires-<kind>-<empreinte SHA-256>/data.json` à la racine du plugin. Les packs publics téléchargés sont conservés dans `data/resources/<kind>/<empreinte>/`, séparément. Le nom et le choix actif sont mémorisés pour chaque section ; le chemin vide désigne Finition lorsqu’il est installé. Réimporter un fichier identique ne crée pas de doublon. **Effacer**, après confirmation, retire uniquement la copie personnelle et son entrée dans les réglages ; la source reste intacte. Finition devient actif s’il est disponible, sinon un autre dictionnaire de la même section. Les fichiers absents restent indisponibles et les imports invalides conservent le choix précédent. Aucune donnée privée n’est téléchargée, publiée ni intégrée à la compilation du plugin.

## Sources publiques

Les quatre packs proviennent du [Wiktionnaire francophone](https://fr.wiktionary.org/), extrait avec Wiktextract par [Kaikki.org](https://kaikki.org/frwiktionary/rawdata.html) : dump du 1er octobre 2026, extraction du 18 octobre 2026. Les textes sont distribués sous [CC BY-SA 4.0](https://fr.wiktionary.org/wiki/Wiktionnaire:Licence), avec attribution aux contributeurs du Wiktionnaire et à Kaikki/Wiktextract. Cette licence concerne les données ; la licence MIT du plugin reste distincte. Chaque JSON inclut un champ `license` avec attribution, URL de la source et du téléchargement, révision, empreinte du dump et description des transformations ; le texte intégral de la licence accompagne chaque pack.

Ce snapshot contient 386 711 entrées de définitions françaises, 12 146 entrées d’antonymes et 234 479 entrées pour chacun des packs phonétique et rimes. Seules les entrées canoniques composées d’un mot sont retenues : les formes fléchies sans sens autonome, citations, médias et traductions sont exclus. Les sens restent séparés ; les antonymes restent directionnels. Les transcriptions sont en alphabet phonétique international, avec les variantes non audio disponibles. Les rimes utilisent ces transcriptions ; elles ne constituent pas un dictionnaire de versification exhaustif. Les lacunes et erreurs éventuelles de l’extraction ne sont pas corrigées automatiquement.

Pour reproduire les packs depuis la racine, avec le dump épinglé et le texte officiel de la licence déjà téléchargés :

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-public-dictionaries.py /chemin/raw-wiktextract-data.jsonl.gz /chemin/CC-BY-SA-4.0.txt
PYTHONDONTWRITEBYTECODE=1 python3 scripts/check-public-dictionaries.py
npm run resources -- /chemin/de/destination
```

Le convertisseur vérifie l’empreinte du dump avant lecture et refuse d’écraser un fichier différent. L’URL Kaikki fournit un dump régulièrement renouvelé ; un nouveau snapshot exige une mise à jour explicite de sa provenance et de l’empreinte attendue. Les sorties sont `resources/definitions/definitions.json`, `resources/antonymes/antonymes.json`, `resources/phonetique/phonetique.json` et `resources/rimes/rimes.json`. Elles sont jointes séparément à la release par `release.sh` ; aucun code ou runtime n’est téléchargé.

## Format JSON version 1

```json
{
  "format": "finition-dictionnaire",
  "version": 1,
  "language": "fr",
  "kind": "definitions",
  "name": "Mon dictionnaire",
  "description": "Définitions françaises",
  "documentation": "https://example.org/dictionnaire",
  "entries": {
    "chat": [
      { "label": "Animal", "text": "Petit félin domestique.", "examples": ["Le chat dort."] }
    ]
  }
}
```

`kind` vaut `definitions`, `antonymes`, `phonetique` ou `rimes`. `name` est obligatoire et fournit le nom affiché dans le sélecteur. `description` et `documentation` sont facultatifs ; leurs limites sont respectivement 1 000 et 2 000 caractères. Seules les URL HTTP ou HTTPS sont acceptées. Le nom accepte 100 caractères. L’encodage est UTF-8 ; taille maximale du fichier : 128 Mio.

Le champ `license`, présent dans tous les packs publics et facultatif pour les anciens imports personnels, est un objet contenant `name` (identifiant de licence, 100 caractères), `url` (lien de licence), `attribution` (4 000 caractères), `source` (URL d’origine), `download` (URL du dump), `sha256` (64 caractères hexadécimaux minuscules), `revision` (1 000 caractères) et `changes` (transformations, 4 000 caractères). Les liens suivent les mêmes limites que `documentation`. Ces métadonnées sont conservées dans le JSON utilisé localement.

`entries` associe chaque mot à une liste de lignes. Les clés sont des mots uniques normalisés en NFC et minuscules françaises ; `’` et `ʼ` deviennent `'`, `‑` devient `-`. Apostrophes et traits d’union sont acceptés à l’intérieur d’un mot. Les accents restent significatifs. Les expressions contenant des espaces ne sont pas des clés de recherche ; les candidats peuvent contenir plusieurs mots. Les recherches n’effectuent aucune lemmatisation ou flexion implicite.

Chaque ligne accepte `label` (titre facultatif de 1 000 caractères), `text` (texte de 20 000 caractères), `examples` (256 exemples de 10 000 caractères maximum) et `words` (1 à 2 048 candidats de 200 caractères maximum). Une définition contient un texte ou au moins un exemple ; la phonétique exige `text` et les antonymes exigent `words`. Une ligne de rimes contient soit des candidats explicites dans `words`, soit une transcription dans `text`. Une entrée accepte 1 à 2 048 lignes ; le dictionnaire accepte 1 à 1 200 000 entrées. Les clés ont 200 caractères maximum. Les chaînes renseignées sont non vides et sans caractères de contrôle U+0000 à U+001F.

Exemple d’antonymes : `"ouvert": [{"label": "Accès", "words": ["fermé", "clos"]}]`. Exemple de phonétique : `"chat": [{"text": "ʃa"}]`. Exemple de rimes explicites : `"chat": [{"label": "Rimes", "words": ["rat", "achat"]}]`. Ces exemples prennent place dans `entries`, avec le `kind` correspondant.

Le champ facultatif `encoding: "phonetic-internal"` indique une notation phonétique interne conservée telle quelle, qui ne doit pas être présentée comme l’alphabet phonétique international. Pour les rimes fournies sous forme de transcriptions, Finition recherche les terminaisons identiques à partir de la dernière voyelle reconnue, donne priorité à la première prononciation du mot puis à ses variantes, privilégie un nombre proche de voyelles et affiche 200 résultats maximum. Une voyelle finale seule suffit, comme pour « chat » et « rat ». Cette approximation ne distingue pas toutes les syllabes, variantes régionales ou phonèmes optionnels ; elle ne reproduit pas un classement linguistique natif. Les dictionnaires peuvent fournir directement leurs candidats dans `words` pour utiliser leur propre classement.

## Conversion privée

`PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-private-dictionaries.py` convertit les exports JSON locaux conservés dans le dossier privé ignoré par Git, sans exécuter ni modifier l’application source. Les sorties `finition-definitions.json`, `finition-antonymes.json`, `finition-phonetique.json` et `finition-rimes.json` restent dans ce même dossier privé ; elles s’importent depuis leur section respective. Un fichier existant différent n’est jamais écrasé.

Les définitions conservent leurs textes, exemples et titres de section disponibles ; les antonymes conservent leurs groupes de sens. Les codes grammaticaux et régionaux non identifiés ne sont pas interprétés. Les transcriptions retenues correspondent aux graphies canoniques selon les correspondances morphologiques observées ; les cas sans correspondance sûre sont exclus. La conversion conserve la notation interne, sans conversion supposée vers l’API. Les exports bruts restent disponibles pour reprendre ces limites ultérieurement.
