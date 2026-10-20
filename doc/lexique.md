# Lexique commun

Répétitions, Stéréotypes, Statistiques, Grammalecte et le correcteur neuronal utilisent le même fichier téléchargeable : `resources/lexique/finition-dictionnaire.json`. Les poids neuronaux et leurs vocabulaires de jetons restent indépendants du lexique linguistique. Les réglages continuent de choisir un moteur et, pour Grammalecte, l’orthographe Classique ou Réforme 1990.

Le fichier est un objet JSON avec `name: "finition-dictionnaire"`, `version: 2`, `language: "fr"`, `encoding: "gzip-base64"`, `license`, `sources`, `inputs`, `counts`, `payload` et `grammalectePayload`. `sources` conserve auteurs, licences et provenance des collections ; `inputs` contient les SHA-256 des trois dictionnaires sources. Les deux blocs sont des objets JSON compressés en gzip sans date, puis encodés en base64. `payload` contient `entries`, `forms`, `variants` et les préférences de lemmes `lemmaOverrides` ; `grammalectePayload` contient `forms`, `variants`, les index `grammalecte` et les compléments `extras`. Chaque moteur décompresse seulement son bloc. Leur contenu logique complet est :

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

**Réglages → Finition → Corrections → Dictionnaire Finition** propose **Charger/Recharger** sans installer de correcteur. Répétitions et Stéréotypes restent grisés avant installation ; installer un correcteur contenant le lexique commun les rend aussi disponibles. Les listes d’atténuations, les charnières et les calculs de monotonie restent embarqués.

Le catalogue indépendant `lexique-resources.json` et les catalogues de téléchargement des deux moteurs référencent le même fichier `lexique-finition-dictionnaire.json` avec la même empreinte. Une seule copie est téléchargée et conservée dans `data/lexique/SHA256.json`. Les autres données restent propres à chaque moteur. Les anciens catalogues et les anciennes installations restent lisibles ; recharger les données installe le format commun. Le code des adaptateurs est livré dans le plugin, sans téléchargement de code ni runtime.

## Sources et préparation

Les analyses publiques proviennent de [Morphalou 3.1](https://www.ortolang.fr/market/lexicons/morphalou), sous LGPL-LR, de [Lexique 3.83](https://www.lexique.org/), sous CC-BY-SA-4.0, et du [lexique français de Grammalecte](https://github.com/Pofilo/grammalecte/blob/master/lexicons/French.lex), sous MPL-2.0. Les textes et liens de licence restent dans les métadonnées ; la notice MPL accompagne les téléchargements. La licence MIT du plugin ne remplace pas celles des données.

Les formes personnelles sans licence renseignée sont exclues du fichier public et conservées dans `Antidote/dictionnaires/finition-personnel.json`, ignoré par Git. La migration sauvegarde aussi l’ancien dictionnaire complet dans ce dossier. Les deux moteurs peuvent lire le complément local ; il ne fournit aucune morphologie inventée et n’est jamais inclus dans les téléchargements publics.

```sh
npx --no-install jiti scripts/merge-lexicons.ts
npx --no-install jiti scripts/check-shared-lexicon.ts
npm run resources -- /chemin/de/destination
```

La fusion conserve les préférences de lemmes de `scripts/lexicon/repetition-v1.json` et utilise les dictionnaires locaux `scripts/lexicon/neural-v1.json` et `scripts/grammalecte/_dictionaries/fr-classic.json` / `fr-reform.json`. Elle fonctionne sans réseau ni réentraînement. Les fichiers d’entrée restent disponibles pour régénérer le format commun ; les catalogues courants distribuent uniquement sa version fusionnée. Les contrôles vérifient la conservation des analyses, des fréquences, des graphies et des index natifs, les variantes, la casse, les compléments privés et les entrées invalides. Ils ne constituent pas une mesure générale de qualité sur corpus.
