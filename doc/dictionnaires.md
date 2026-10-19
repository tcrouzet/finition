# Dictionnaires locaux

Toutes les sections de **Corrections** à **Palette** sont repliées par défaut dans les réglages. **Corrections IA** suit immédiatement **Corrections**, puis viennent **Synonymes**, **Définitions**, **Antonymes**, **Phonétique**, **Rimes**, **Répétitions**, **Cadence**, **Monotonie** et **Palette**. Cliquer sur leur titre les déplie ; une actualisation du panneau conserve les sections ouvertes pendant cette session.

Après **Synonymes**, chaque section de dictionnaire propose son propre sélecteur **Dictionnaire**, vide avant installation, puis les dictionnaires importés avec leur nom, description éventuelle et bouton **Effacer**. **Charger un dictionnaire** accepte le chemin d’un JSON dans le coffre, relatif ou absolu sur ordinateur ; laisser le champ vide ouvre le sélecteur de fichiers. Le fichier doit correspondre à la section choisie. Le lien **JSON au format Finition** ouvre cette documentation. Une URL de documentation renseignée porte la description ; sans description, son libellé devient **Documentation**.

Sélectionner un seul mot, puis utiliser **Définitions**, **Antonymes**, **Phonétique** ou **Rimes** dans le menu ♫ ou la palette de commandes. Sans sélection valable, un message demande de sélectionner un mot. Sans dictionnaire sélectionné et disponible, la commande du menu est grisée. Les définitions et transcriptions sont consultables et copiables ; les antonymes et rimes peuvent remplacer le mot sélectionné. La sélection reste active après remplacement ou fermeture de la fenêtre. L’affichage est construit en HTML natif, sans interprétation Markdown ou HTML des données.

L’import valide le JSON et crée une copie identique dans `data/dictionnaires-<kind>-<empreinte SHA-256>/data.json` à la racine du plugin. Le nom et le choix actif sont mémorisés séparément pour chaque section. Réimporter un fichier identique ne crée pas de doublon. **Effacer**, après confirmation, retire uniquement cette copie et son entrée dans les réglages ; la source reste intacte. Un autre dictionnaire de la même section devient actif si nécessaire. Les fichiers absents restent indisponibles et les imports invalides conservent le choix précédent. Aucune donnée privée n’est téléchargée, publiée ni intégrée à la compilation du plugin.

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

`entries` associe chaque mot à une liste de lignes. Les clés sont des mots uniques normalisés en NFC et minuscules françaises ; `’` et `ʼ` deviennent `'`, `‑` devient `-`. Apostrophes et traits d’union sont acceptés à l’intérieur d’un mot. Les accents restent significatifs. Les expressions contenant des espaces ne sont pas des clés de recherche ; les candidats peuvent contenir plusieurs mots. Les recherches n’effectuent aucune lemmatisation ou flexion implicite.

Chaque ligne accepte `label` (titre facultatif de 1 000 caractères), `text` (texte de 20 000 caractères), `examples` (256 exemples de 10 000 caractères maximum) et `words` (1 à 2 048 candidats de 200 caractères maximum). Une définition contient un texte ou au moins un exemple ; la phonétique exige `text` et les antonymes exigent `words`. Une ligne de rimes contient soit des candidats explicites dans `words`, soit une transcription dans `text`. Une entrée accepte 1 à 2 048 lignes ; le dictionnaire accepte 1 à 1 200 000 entrées. Les clés ont 200 caractères maximum. Les chaînes renseignées sont non vides et sans caractères de contrôle U+0000 à U+001F.

Exemple d’antonymes : `"ouvert": [{"label": "Accès", "words": ["fermé", "clos"]}]`. Exemple de phonétique : `"chat": [{"text": "ʃa"}]`. Exemple de rimes explicites : `"chat": [{"label": "Rimes", "words": ["rat", "achat"]}]`. Ces exemples prennent place dans `entries`, avec le `kind` correspondant.

Le champ facultatif `encoding: "phonetic-internal"` indique une notation phonétique interne conservée telle quelle, qui ne doit pas être présentée comme l’alphabet phonétique international. Pour les rimes fournies sous forme de transcriptions, Finition recherche les terminaisons identiques à partir de la dernière voyelle reconnue, classe les suffixes les plus longs en premier et affiche 200 résultats maximum. Une voyelle finale seule suffit, comme pour « chat » et « rat ». Cette approximation ne distingue pas toutes les syllabes, variantes régionales ou phonèmes optionnels ; elle ne reproduit pas un classement linguistique natif. Les dictionnaires peuvent fournir directement leurs candidats dans `words` pour utiliser leur propre classement.

## Conversion privée

`PYTHONDONTWRITEBYTECODE=1 python3 helper/prepare-private-dictionaries.py` convertit les exports JSON locaux conservés dans le dossier privé ignoré par Git, sans exécuter ni modifier l’application source. Les sorties `finition-definitions.json`, `finition-antonymes.json`, `finition-phonetique.json` et `finition-rimes.json` restent dans ce même dossier privé ; elles s’importent depuis leur section respective. Un fichier existant différent n’est jamais écrasé.

Les définitions conservent leurs textes, exemples et titres de section disponibles ; les antonymes conservent leurs groupes de sens. Les codes grammaticaux et régionaux non identifiés ne sont pas interprétés. Les transcriptions retenues correspondent aux graphies canoniques selon les correspondances morphologiques observées ; les cas sans correspondance sûre sont exclus. La conversion conserve la notation interne, sans conversion supposée vers l’API. Les exports bruts restent disponibles pour reprendre ces limites ultérieurement.
