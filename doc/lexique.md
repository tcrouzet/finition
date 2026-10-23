# Lexique commun

Répétitions, Stéréotypes, Statistiques, Grammalecte et le correcteur neuronal utilisent le même lexique sélectionné dans les réglages. Le lexique public Finition se télécharge depuis `resources/lexique/finition-dictionnaire.json`. Les poids neuronaux et leurs vocabulaires de jetons restent indépendants du lexique linguistique. Les réglages continuent de choisir un moteur et, pour Grammalecte, l’orthographe Classique ou Réforme 1990.

Le format d’import est un objet JSON avec `format: "finition-dictionnaire"`, `name` (nom affiché), `version: 2`, `language: "fr"`, `encoding: "gzip-base64"`, `payload` et `grammalectePayload`. Les champs facultatifs `description` (remarque), `documentation` (lien HTTP ou HTTPS), `license`, `sources`, `inputs` et `counts` décrivent le contenu. Les fichiers historiques avec `name: "finition-dictionnaire"` sans champ `format` restent reconnus et affichent **Finition**. `sources` conserve auteurs, licences et provenance des collections ; `inputs` contient les SHA-256 des trois dictionnaires sources. Les deux blocs sont des objets JSON compressés en gzip sans date, puis encodés en base64. `payload` contient `entries`, `forms`, `variants` et les préférences de lemmes `lemmaOverrides` ; `grammalectePayload` contient `forms`, `variants`, les index `grammalecte` et les compléments `extras`. Chaque moteur décompresse seulement son bloc. Leur contenu logique complet est :

```ts
type LexiconPayload = {
  entries: [form: string, lemma: string, category: string, gender: string, number: string, inflection: string, frequency: number][];
  forms: string[];
  lemmaOverrides?: [form: string, lemma: string][];
  grammalecte: {
    "fr-classic": Record<string, unknown>;
    "fr-reform": Record<string, unknown>;
  };
  variants: [form: string, mask: 1 | 2][];
  extras: [form: string, nativeMorphologies: string[]][];
};
```

Chaque ligne d’`entries` décrit une analyse possible : plusieurs analyses d’une forme sont conservées. Les lignes de même forme, lemme, catégorie, genre et nombre regroupent leurs flexions ; la fréquence est le maximum des sources. Les catégories incluent `nom`, `nom propre`, `verbe`, `adjectif`, `adverbe`, `déterminant`, `pronom`, `préposition`, `conjonction`, `interjection` et `nombre`. Les valeurs de genre et nombre sont `m`/`f` et `s`/`p`, ou une chaîne vide lorsque l’information manque ou que la forme est invariable. Les noms propres issus de Grammalecte conservent leur casse.

Les flexions verbales emploient les conventions du neuronal existant : `inf`, `par:pre`, `par:pas`, `ind:pre:3s`, `ind:imp:1p`, `ind:pas:3p`, `ind:fut:2s`, `cnd:pre:3s`, `sub:pre:1s`, `sub:imp:3p` ou `imp:pre:2s`. Plusieurs analyses sont séparées par `;`. Une catégorie ou une personne non reconnue n’est pas déduite artificiellement. `forms` conserve les graphies publiques auxquelles aucune analyse normalisée n’a pu être attribuée.

`grammalecte` conserve intégralement les deux index natifs : étiquettes, groupes verbaux, valences, sous-types de pronoms, suffixes, marques d’usage et ordre des arcs. Ils couvrent la partie Grammalecte, complétée par `extras`, et restent nécessaires au moteur tiers ; ils ne sont pas reconstruits à partir des seules catégories simplifiées. `variants` indique les graphies présentes seulement en Classique (`1`) ou seulement en Réforme 1990 (`2`). Les graphies communes aux deux variantes ne figurent pas dans cette table. `extras` est un index préparé pour Grammalecte des seules formes supplémentaires : ses morphologies sont traduites uniquement lorsque la correspondance est certaine, et une liste vide n’ajoute que la reconnaissance orthographique.

`lemmaOverrides` conserve les choix historiques du surlignage pour les formes ambiguës dont le premier lemme diffère. Cette petite table ne répète pas le lexique complet. Les correcteurs gardent toutes les analyses possibles.

## Adaptateurs TypeScript

- `plugin/lexicon/shared.ts` décode et valide le format commun, ainsi que l’ancien format neuronal v1.
- `plugin/lexicon/repetition-adapter.ts` construit la table mot → lemme des répétitions, stéréotypes et statistiques, avec les préférences historiques pour les ambiguïtés. Cette table est chargée à la première utilisation. Le décodage et la construction se font dans un Worker ; les demandes simultanées partagent le même chargement, puis la table reste en mémoire.
- `plugin/lexicon/neural-adapter.ts` construit le `Lexicon` du correcteur neuronal à partir des analyses fusionnées. Il peut filtrer une variante orthographique ; sans filtre, il conserve les variantes comme le neuronal précédent.
- `plugin/lexicon/grammalecte-adapter.ts` conserve la morphologie et les suggestions natives pour les mots déjà connus de Grammalecte. Pour les mots supplémentaires, il ajoute la reconnaissance orthographique et les catégories dont la traduction est certaine. Il n’invente pas les groupes verbaux ou les sous-types absents des sources. Une graphie de l’autre variante ne devient pas valide au seul motif qu’elle existe dans Morphalou.

**Réglages → Finition → Corrections → Lexique** choisit le lexique commun. La liste reste vide avant le premier téléchargement ou import. **Dictionnaire Finition → Charger/Recharger** télécharge le lexique public sans installer de correcteur et le sélectionne. **Charger un lexique** propose un champ de chemin, **Charger** et **Parcourir…**, puis le lien de ce format sur toute la largeur. Un chemin relatif désigne un fichier du coffre ; un chemin absolu peut désigner un fichier extérieur, lu avec l’API Obsidian uniquement lors de l’import. Le sélecteur attend un fichier JSON complet version 2, contenant les deux index Grammalecte.

Chaque lexique importé affiche son `name`, sa remarque `description` et **Effacer**. Lorsque `documentation` est renseigné, la remarque devient un lien ; sans remarque, le lien affiche **Documentation**. Finition copie les données dans `data/lexique/imports/SHA256.json`, conserve les métadonnées et la sélection dans les réglages et laisse la source intacte. Réimporter le même fichier ne crée pas de doublon. Un fichier invalide ou une sauvegarde échouée conserve le choix précédent. Effacer retire seulement la copie importée ; si elle était active, Finition revient au lexique public installé, sinon à un autre lexique disponible. Le lexique public est rechargeable et ne possède pas de bouton d’effacement.

Changer de lexique arrête les anciens Workers, efface les lemmes et catégories mis en cache et retire les suggestions de correction devenues périmées. Les lemmes sont rechargés dans un Worker si un surlignage lexical est actif, sinon à leur prochaine utilisation. Répétitions et Stéréotypes restent grisés avant installation d’un lexique ; les correcteurs conservent leurs propres ressources de moteur. Les listes d’atténuations, les charnières et les calculs de monotonie restent embarqués.

Exemple des métadonnées d’un lexique importable ; les deux champs de données contiennent du JSON compressé en gzip puis encodé en base64 :

```json
{
  "format": "finition-dictionnaire",
  "name": "Mon lexique",
  "description": "Remarque affichée dans les réglages",
  "documentation": "https://example.org/mon-lexique",
  "version": 2,
  "language": "fr",
  "encoding": "gzip-base64",
  "payload": "…",
  "grammalectePayload": "…"
}
```

L’import accepte au maximum 128 Mio de JSON et 256 Mio décompressés par bloc. Le nom est limité à 100 caractères, la remarque à 1000 caractères ; les caractères de contrôle et les liens autres que HTTP/HTTPS sont refusés.

Le catalogue indépendant `lexique-resources.json` et les catalogues de téléchargement des deux moteurs référencent le même fichier `lexique-finition-dictionnaire.json` avec la même empreinte. Une seule copie est téléchargée et conservée dans `data/lexique/SHA256.json`. Les autres données restent propres à chaque moteur. Les anciens catalogues et les anciennes installations restent lisibles ; recharger les données installe le format commun. Le code des adaptateurs est livré dans le plugin, sans téléchargement de code ni runtime.

## Sources et préparation

Les analyses publiques proviennent de [Morphalou 3.1](https://www.ortolang.fr/market/lexicons/morphalou), sous LGPL-LR, de [Lexique 3.83](https://www.lexique.org/), sous CC-BY-SA-4.0, et du [lexique français de Grammalecte](https://github.com/Pofilo/grammalecte/blob/master/lexicons/French.lex), sous MPL-2.0. Les textes et liens de licence restent dans les métadonnées ; la notice MPL accompagne les téléchargements. La licence MIT du plugin ne remplace pas celles des données.

Les formes personnelles sans licence renseignée sont exclues du fichier public et conservées dans `Antidote/dictionnaires/finition-personnel.json`, ignoré par Git. Ce chemin reste utilisé par les deux moteurs ; son emplacement n’attribue pas ces formes à Antidote. L’ancien dictionnaire complet est conservé dans `Antidote/dictionnaires/archives/finition-dictionnaire-legacy.json`, avec sa provenance historique. Le complément local ne fournit aucune morphologie inventée et n’est jamais inclus dans les téléchargements publics.

```sh
npx --no-install jiti scripts/merge-lexicons.ts
npx --no-install jiti scripts/check-shared-lexicon.ts
npm run resources -- /chemin/de/destination
```

La fusion conserve les préférences de lemmes de `scripts/lexicon/repetition-v1.json` et utilise les dictionnaires locaux `scripts/lexicon/neural-v1.json` et `scripts/grammalecte/_dictionaries/fr-classic.json` / `fr-reform.json`. Elle fonctionne sans réseau ni réentraînement. Les fichiers d’entrée restent disponibles pour régénérer le format commun ; les catalogues courants distribuent uniquement sa version fusionnée. Les contrôles vérifient la conservation des analyses, des fréquences, des graphies et des index natifs, les variantes, la casse, les compléments privés et les entrées invalides. Ils ne constituent pas une mesure générale de qualité sur corpus.

## Conversion du lexique privé existant

`scripts/prepare-private-lexicon.py` convertit les exports JSON locaux `Antidote/dictionnaires/originaux/dictionnaire.json`, `morphologie.json` et `morphologie-codes.json`, sans lancer l’application ni modifier ces sources. Le dernier fichier contient les catégories par identifiant de mot et les libellés des types de flexion décodés statiquement. Le convertisseur ajoute les analyses natives au lexique public, conserve les analyses publiques complètes et leurs index Grammalecte, puis écrit `Antidote/dictionnaires/finition/lexique-antidote-finition.json`. Ce fichier porte `name: "Antidote"`, une `description` précisant l’enrichissement et `documentation: ""` lorsqu’aucun lien n’est fourni. Les sources et leurs empreintes sont conservées ; le fichier reste privé et ignoré par Git. Toute version précédente reconnue est sauvegardée dans `archives/` avec son empreinte avant remplacement.

Les types natifs `17` à `20` décrivent les flexions masculine singulière, masculine plurielle, féminine singulière et féminine plurielle. Les types `21` à `71` décrivent les conjugaisons, l’infinitif, les participes et l’impératif. Le convertisseur les traduit dans les conventions communes ci-dessus, en conservant les analyses multiples d’une même forme. La catégorie provient d’une table de mots supplémentaire de `Grimoire.03.psi`, distincte du type de flexion ; les anciens champs `flags` ne sont pas utilisés comme catégorie grammaticale.

Les catégories spécialisées sans équivalent vérifié, notamment les gentilés et les segments de phrase, gardent une catégorie vide. Les formes euphoniques d’inversion (`72` à `74`) conservent leur libellé natif dans l’export, sans temps attribué dans le lexique commun : leur validité dépend d’un contexte que ce format ne décrit pas. Les marques d’usage, codes de fréquence, valences et groupes verbaux restent non traduits. Grammalecte reçoit les morphologies supplémentaires dont la traduction est certaine et conserve ses analyses natives prioritaires ; les catégories simplifiées ne suffisent toujours pas à reconstruire toute sa morphologie verbale.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-private-lexicon.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/check-private-lexicon.py
```

## Rangement des dictionnaires privés

`Antidote/dictionnaires/originaux/` conserve les JSON natifs, les tables de décodage et les rapports d’extraction sans changer leurs octets. `Antidote/dictionnaires/finition/` contient les conversions importables : `synonyme-antidote-finition.json`, `definition-antidote-finition.json`, `antonyme-antidote-finition.json`, `phonetique-antidote-finition.json`, `rime-antidote-finition.json` et `lexique-antidote-finition.json`. Les noms de ces fichiers distinguent leur origine du format d’import ; ils ne rendent pas leur contenu redistribuable.

Le fichier de synonymes canonique conserve les sens et les registres. `synonyme-antidote-finition-sans-details.json` conserve également l’ancienne conversion simple, dont certaines entrées n’existent pas dans la version détaillée : les deux versions restent disponibles, sans prétendre que l’une remplace intégralement l’autre. Les anciennes variantes du lexique sont conservées dans `archives/`, avec leurs noms et leurs provenances historiques.

`scripts/organize-private-dictionaries.py` vérifie les collisions et les empreintes avant de déplacer les fichiers. Le manifeste local `Antidote/dictionnaires/organisation.json` conserve chaque ancien chemin, son nouveau chemin, sa taille et son SHA-256 ; il permet de retrouver le rangement précédent. Une réexécution ne déplace rien si le rangement et les fichiers sont inchangés. Le contrôle échoue si un fichier manque ou diffère du manifeste. Il ne contrôle pas les fichiers extraits ultérieurement, absents de cet inventaire.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/organize-private-dictionaries.py --check
PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-private-dictionaries.py
npx --no-install jiti scripts/check-synonym-dictionary.ts
```

Le menu **Dictionnaires → Flexions** affiche les flexions du ou des lemmes correspondant au mot sélectionné, à partir du lexique actif. Il conserve les analyses ambiguës et leurs indications grammaticales disponibles. Les formes complémentaires sans analyse forme–lemme ne permettent pas de reconstruire des flexions ; aucun mot dérivé n’est inventé.
