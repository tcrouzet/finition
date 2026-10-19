# Dictionnaires de synonymes

Dans les réglages **Synonymes**, le sélecteur **Dictionnaire** présente uniquement les dictionnaires disponibles. Sa liste est vide avant toute installation. Le choix actif est mémorisé entre deux lancements. Sous ce sélecteur, une liste commune affiche **Finition** et chaque dictionnaire personnel installé sous le nom fourni par son JSON, avec sa description et son lien de documentation lorsqu’ils sont renseignés. **Finition → Charger** télécharge le pack public depuis GitHub ; **Recharger** permet de le récupérer à nouveau une fois installé. Finition ne peut pas être effacé. Chaque dictionnaire personnel dispose de son propre bouton **Effacer**, avec confirmation. Sous la liste, **Charger un dictionnaire** propose un champ de chemin JSON dans le coffre, relatif ou absolu sur ordinateur : saisir le chemin puis cliquer sur **Charger**, ou laisser le champ vide pour ouvrir le sélecteur de fichiers. La saisie seule ne change pas le dictionnaire actif. Le lien **JSON au format Finition** ouvre cette documentation sur GitHub.

Sélectionner un seul mot et lancer **Synonyme** dans le menu ♫ ou la palette pour chercher localement. Un mot composé avec apostrophe ou trait d’union est accepté ; les propositions peuvent contenir plusieurs mots. **Synonymes IA** reste une commande distincte qui utilise le fournisseur configuré et le contexte de la sélection.

Chaque import valide est copié dans `data/synonymes-<empreinte SHA-256>/data.json`, à la racine du plugin. Le nom du dictionnaire vient du champ `name` du JSON. La liste des copies et leurs noms sont mémorisés dans les réglages ; réimporter un fichier identique n’ajoute pas de doublon. Déplacer ou modifier la source ne change plus les données actives. Le JSON doit respecter le format Finition ci-dessous ; un export brut d’un autre outil n’est pas automatiquement converti. Un import invalide conserve le dernier dictionnaire et la liste existante. Un dictionnaire déjà sélectionné dans une version antérieure est repris automatiquement lorsqu’il est valide.

**Effacer** retire uniquement la copie choisie du plugin et son entrée dans la liste. La source reste intacte. Effacer un dictionnaire inactif conserve le choix courant. Si cette copie était active, Finition reprend le pack public lorsqu’il est installé, sinon un autre dictionnaire disponible ; sans dictionnaire restant, le sélecteur redevient vide et la commande locale est désactivée. Aucun fichier personnel n’est envoyé ou ajouté aux téléchargements publics. Dans ce dépôt, les fichiers nommés `data.json` sont déjà ignorés par Git, y compris ces copies personnelles.

## Sources publiques

Le pack fusionne [myThes français 2.3](https://github.com/LibreOffice/dictionaries/tree/master/fr_FR/dictionaries), de Frédéric Labbé / Dicollecte, distribué par LibreOffice sous LGPL-2.1-or-later, et [WOLF](https://almanach.inria.fr/software_and_resources/custom/WOLF-en.html), de Benoît Sagot et Darja Fišer, sous CeCILL-C, dans sa [distribution Open Multilingual Wordnet](https://github.com/omwn/omw-data/tree/main/wns/fra). Ce sont des données libres sous conditions de licence ; leurs notices et licences accompagnent le pack. La licence MIT du code du plugin ne remplace pas celles des données.

Les originaux sont conservés dans `scripts/synonymes/sources/`. [SOURCE.json](../resources/synonymes/SOURCE.json) consigne les URL exactes, révisions, tailles et empreintes SHA-256. Le script vérifie ces empreintes avant chaque conversion. WOLF comporte des relations construites automatiquement : une proposition peut être approximative. Aucun score de qualité ni choix contextuel n’est déduit de la fusion.

## JSON version 1

```json
{
  "format": "finition-synonymes",
  "version": 1,
  "language": "fr",
  "name": "Exemple",
  "description": "Synonymes français",
  "documentation": "https://github.com/tcrouzet/finition/blob/main/doc/synonymes.md",
  "sources": [
    { "id": "exemple", "name": "Source exemple", "license": "CC0-1.0", "url": "" }
  ],
  "groups": [
    { "category": "adjectif", "label": "vitesse", "words": ["vif", "véloce"], "sources": ["exemple"] }
  ],
  "index": { "rapide": [0] }
}
```

- Encodage UTF-8, fichier JSON de 128 Mio maximum. `format`, `version` et `language` doivent correspondre exactement à l’exemple. Le champ obligatoire `name` fournit le libellé affiché dans le sélecteur de dictionnaires ; ce libellé ne vient pas du nom du fichier. Après modification de `name` dans la source, réimporter le JSON pour actualiser son nom dans la liste.
- `description` est une ligne de texte facultative de 1 000 caractères maximum, affichée sous le nom du dictionnaire dans les réglages. `documentation` est un lien facultatif de 2 000 caractères maximum, en HTTP ou HTTPS, affiché à côté de la description. Une chaîne vide équivaut à une information absente. Ces champs restent compatibles avec les fichiers version 1 existants. Le dictionnaire public fournit la description « myThes et WOLF » et un lien vers cette documentation.
- `sources` déclare les provenances, dans leur ordre de priorité d’affichage. Chaque `id` unique contient des minuscules ASCII, chiffres ou tirets et commence par une lettre ou un chiffre. `license` conserve l’identifiant ou l’indication de licence de la source ; `url` peut être vide pour un fichier personnel.
- `groups` conserve les ensembles de candidats par sens. `category` et `label` peuvent être vides si inconnus ; ils ne sont pas interprétés comme des règles grammaticales. `words` contient les graphies à afficher et `sources` leurs identifiants de provenance déclarés.
- Trois champs facultatifs conservent une hiérarchie plus détaillée : `sense` est la définition du sens ; `registers` contient des objets `{ "labels": ["québec", "familier"], "words": ["obstineux"] }`, où `labels` décrit le chemin du registre parent au sous-registre ; `unmarked` liste les candidats sans marque. Les candidats de `registers` et `unmarked` doivent figurer dans `words`, qui reste la liste complète pour les lecteurs plus anciens. Une graphie peut être courante et marquée : les deux occurrences sont alors conservées à l’affichage. Sans `unmarked`, les candidats courants sont déduits en retirant les graphies marquées de `words`.
- `index` associe chaque mot recherché aux positions, à partir de zéro, dans `groups`. Une association peut être directionnelle : la présence d’un candidat ne crée pas automatiquement l’entrée inverse. Les clés sont normalisées en NFC et minuscules françaises, avec `’` et `ʼ` convertis en `'`, et `‑` en `-`. Les accents sont conservés.
- Limites de validation : 100 sources, 500 000 groupes, 1 200 000 entrées, 2 048 candidats par groupe, 10 000 références par entrée. Une graphie et une clé ont au plus 200 caractères ; catégorie 100, libellé 1 000, nom de source 200, licence 100, URL 2 000. Les chaînes ne contiennent pas de caractères de contrôle U+0000 à U+001F.
- La définition `sense` accepte 10 000 caractères. Un groupe accepte au plus 2 048 lignes de registre ; chaque ligne contient 1 à 8 libellés de 100 caractères maximum et 1 à 2 048 candidats. `unmarked` accepte 0 à 2 048 candidats. Ces ajouts sont facultatifs et restent compatibles avec les JSON version 1 existants.

La fusion dédoublonne les groupes identiques (catégorie, libellé, candidats) et cumule leurs provenances. Elle ne fusionne pas les sens seulement parce qu’ils partagent un mot et ne propage pas les relations de proche en proche. myThes conserve ses relations directionnelles ; les synsets WOLF sont indexés par chacun de leurs membres composé d’un seul mot.

L’interface regroupe les propositions sous un seul titre en gras par catégorie grammaticale, puis par définition de sens lorsqu’elle est disponible. Chaque groupe présente son libellé en gras sur la même ligne que ses synonymes, séparés par un tiret long. Les registres et sous-registres apparaissent dans des sous-listes indentées. L’affichage utilise uniquement des éléments HTML natifs, sans moteur Markdown. Les catégories simples (nom, adjectif, verbe…) précèdent les catégories combinées ; dans chaque section, l’ordre des sources reste conservé. Une catégorie combinée comme `adjectif nom` devient « Nom ou adjectif » : la source ne distingue pas ces usages pour chaque candidat. Les groupes restent séparés ; un synonyme commun à plusieurs sens reste affiché dans chacun, sans répéter le mot recherché. Cliquer sur un mot remplace la sélection par la graphie seule ; une unique icône copie toute la liste en Markdown, avec les sections en gras et les registres indentés. Le premier accès charge et valide le fichier ; les suivants utilisent son cache. La recherche n’applique ni lemmatisation, ni flexion, ni accord automatique : une entrée absente ne donne aucun résultat, et le lecteur choisit la proposition adaptée au contexte. Les informations absentes de la source ne sont pas inventées.

## Reproduire et distribuer

Depuis la racine du projet, sans dépendance Python supplémentaire :

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-synonyms.py
npm run resources -- /chemin/de/destination
```

Le premier script produit `resources/synonymes/synonymes.json` de manière déterministe et refuse d’écraser un fichier différent. Le second prépare les fichiers de téléchargement et leur catalogue d’intégrité. Seuls le JSON fusionné, sa provenance et les notices/licences sont ajoutés au pack ; les originaux restent accessibles dans le dépôt. Le téléchargement passe par les fichiers joints à la version GitHub du plugin, sur demande dans les réglages, puis fonctionne hors ligne.

Un export personnel compatible peut être utilisé directement. Le convertisseur accepte aussi les exports locaux `dictionnaire.json` et `synonymes.json` :

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-synonyms.py /chemin/exports /chemin/personnel.json
```

Cette conversion conserve les groupes de synonymes identifiés dans ces exports, leurs libellés, leur ordre par entrée et les entrées canoniques disponibles. Si `definitions.json` est présent à côté des exports, les définitions sont reliées par identifiant de mot et de sens. Les marques reconnues deviennent des registres (rare, vieux, vieilli, familier, soutenu, anciennement, droit, sports, québec), en conservant leurs imbrications ; les codes non identifiés apparaissent sous « Autres usages ». Pour les variantes balisées reconnues, la première graphie est retenue, sans concaténer les variantes. Les précisions annexes propres à chaque candidat et les renvois « Plus spécifique » ou « Ensemble » ne sont pas convertis en synonymes remplaçables. Les groupes d’antonymes identifiés restent exclus ; les catégories grammaticales privées non décodées ne sont pas inventées. La mention `unspecified` dans un fichier personnel n’accorde aucun droit de redistribution. Les données personnelles restent séparées du pack public.
