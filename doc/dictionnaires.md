# Dictionnaires locaux

Toutes les sections de **Corrections** à **Palette** sont repliées par défaut dans les réglages. Les dictionnaires suivent **Corrections IA** : **Synonymes**, **Définitions**, **Antonymes**, **Phonétique**, **Rimes**, **Conjugaisons**, **Étymologie** et **Citations**. Cliquer sur leur titre les déplie ; une actualisation du panneau conserve les sections ouvertes pendant cette session.

Après **Synonymes**, chaque section de dictionnaire propose son propre sélecteur **Dictionnaire**, vide avant installation. La ligne **Finition → Charger** télécharge le dictionnaire par défaut depuis les fichiers joints à la version GitHub du plugin ; **Recharger** permet de le récupérer à nouveau. Aucun fichier local n’est nécessaire pour ce téléchargement. Le téléchargement contrôle tailles et empreintes SHA-256, sélectionne Finition et conserve les dictionnaires personnels. Le dictionnaire Finition ne possède pas de bouton d’effacement. Les autres dictionnaires apparaissent avec leur nom, description éventuelle et bouton **Effacer**. Sous cette liste, **Charger un dictionnaire** sert uniquement à ajouter un autre dictionnaire depuis un JSON dans le coffre, relatif ou absolu sur ordinateur ; laisser le champ vide ouvre le sélecteur de fichiers. Le fichier doit correspondre à la section choisie. Le lien **JSON au format Finition** ouvre cette documentation. Une URL de documentation renseignée porte la description ; sans description, son libellé devient **Documentation**.

Sélectionner un seul mot, puis utiliser **Définitions**, **Antonymes**, **Phonétique** ou **Rimes** dans le menu ♫ ou la palette de commandes. Sans sélection valable, un message demande de sélectionner un mot. Sans dictionnaire sélectionné et disponible, la commande du menu est grisée. Les définitions et transcriptions sont consultables et copiables ; les antonymes et rimes peuvent remplacer le mot sélectionné. La sélection reste active après remplacement ou fermeture de la fenêtre. L’affichage est construit en HTML natif, sans interprétation Markdown ou HTML des données.

**Flexions** utilise directement le [lexique actif](lexique.md), sans dictionnaire supplémentaire. Les résultats de **Conjugaisons**, **Étymologie** et **Citations** sont consultables et peuvent être insérés en remarque. Synonymes, définitions, antonymes, conjugaisons, étymologie et citations recherchent les lemmes de la forme sélectionnée. Les analyses ambiguës sont conservées et les résultats identiques dédoublonnés. Une forme conjuguée peut ainsi retrouver son infinitif. Sans lexique installé ou pour un mot inconnu de ce lexique, la forme exacte sert de clé de recherche. Phonétique et Rimes gardent la forme sélectionnée.

À la première recherche de citations, Finition construit en mémoire un index des mots et de leurs lemmes dans les textes cités. Il utilise le lexique actif et conserve les citations originales avec leurs références. Une roue accompagne la recherche ; les flexions du mot recherché apparaissent en gras dans les extraits. L’index est reconstruit après un changement de dictionnaire ou de lexique. Pour les imports historiques, les exemples contiennent le texte cité ; le champ de référence et les noms d’auteurs ne sont pas indexés comme des mots de la citation. La recherche reste limitée au corpus réellement chargé.

L’import valide le JSON et crée une copie identique dans `data/dictionnaires-<kind>-<empreinte SHA-256>/data.json` à la racine du plugin. Les packs publics téléchargés sont conservés dans `data/resources/<kind>/<empreinte>/`, séparément. Le nom et le choix actif sont mémorisés pour chaque section ; le chemin vide désigne Finition lorsqu’il est installé. Réimporter un fichier identique ne crée pas de doublon. **Effacer**, après confirmation, retire uniquement la copie personnelle et son entrée dans les réglages ; la source reste intacte. Finition devient actif s’il est disponible, sinon un autre dictionnaire de la même section. Les fichiers absents restent indisponibles et les imports invalides conservent le choix précédent. Aucune donnée privée n’est téléchargée, publiée ni intégrée à la compilation du plugin.

## Sources publiques

Les packs **Définitions**, **Antonymes**, **Phonétique** et **Rimes** proviennent du [Wiktionnaire francophone](https://fr.wiktionary.org/), extrait avec Wiktextract par [Kaikki.org](https://kaikki.org/frwiktionary/rawdata.html) : dump du 1er octobre 2026, extraction du 18 octobre 2026. Les textes sont distribués sous [CC BY-SA 4.0](https://fr.wiktionary.org/wiki/Wiktionnaire:Licence), avec attribution aux contributeurs du Wiktionnaire et à Kaikki/Wiktextract. Cette licence concerne les données ; la licence MIT du plugin reste distincte. Chaque JSON inclut un champ `license` avec attribution, URL de la source et du téléchargement, révision, empreinte du dump et description des transformations ; le texte intégral de la licence accompagne chaque pack.

Ce snapshot contient 386 711 entrées de définitions françaises, 12 146 entrées d’antonymes et 234 479 entrées pour chacun des packs phonétique et rimes. Seules les entrées canoniques composées d’un mot sont retenues : les formes fléchies sans sens autonome, citations, médias et traductions sont exclus. Les sens restent séparés ; les antonymes restent directionnels. Les transcriptions sont en alphabet phonétique international, avec les variantes non audio disponibles. Les rimes utilisent ces transcriptions ; elles ne constituent pas un dictionnaire de versification exhaustif. Les lacunes et erreurs éventuelles de l’extraction ne sont pas corrigées automatiquement.

Pour reproduire les packs depuis la racine, avec le dump épinglé et le texte officiel de la licence déjà téléchargés :

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-public-dictionaries.py /chemin/raw-wiktextract-data.jsonl.gz /chemin/CC-BY-SA-4.0.txt
PYTHONDONTWRITEBYTECODE=1 python3 scripts/check-public-dictionaries.py
npm run resources -- /chemin/de/destination
```

Le convertisseur vérifie l’empreinte du dump avant lecture et refuse d’écraser un fichier différent. L’URL Kaikki fournit un dump régulièrement renouvelé ; un nouveau snapshot exige une mise à jour explicite de sa provenance et de l’empreinte attendue. Les sorties sont `resources/definitions/definitions.json`, `resources/antonymes/antonymes.json`, `resources/phonetique/phonetique.json` et `resources/rimes/rimes.json`. Elles sont jointes séparément à la release par `release.sh` ; aucun code ou runtime n’est téléchargé.

## Conjugaisons, étymologie, citations et champ lexical

Conjugaisons, Étymologie et Citations suivent le même chargement que les autres dictionnaires. Le pack Champ lexical reste conservé dans les données, sans commande ni section de réglages. Ces packs utilisent le [dump Kaikki](https://kaikki.org/frwiktionary/rawdata.html) du Wiktionnaire du 1er octobre 2026, extrait le 20 octobre 2026. Le SHA-256 épinglé est `a1e04095e6e85e93bb134f947ba3b7c1f07c6f5ccbb454acf518fd9e98dea5a6`. Les citations sont enrichies avec [Wikiquote francophone](https://fr.wikiquote.org/) : [dump du 1er octobre 2026](https://dumps.wikimedia.org/frwikiquote/20261001/frwikiquote-20261001-pages-articles.xml.bz2), SHA-256 `562a895c4c01fa75daaf8a0f7e1876b41f1e7d5a1961df47927fb570720860e4`. Attribution, révision et transformations accompagnent chaque fichier ; la licence CC BY-SA 4.0 couvre les contributions lexicographiques et la compilation.

- `resources/conjugaisons/conjugaisons.json` : 34 889 entrées verbales, avec les formes et temps explicitement présents dans les tables, y compris les temps composés. Les formes sont affichées par groupe grammatical ; aucun paradigme manquant n’est reconstruit.
- `resources/historique/historique.json` : 256 416 entrées d’étymologie. Il renseigne l’origine des mots, pas une chronologie complète de leurs attestations.
- `resources/champ-lexical/champ-lexical.json` : 14 360 entrées avec relations explicites d’hyperonymie, hyponymie, tout–partie ou manière de faire, séparées par type.
- `resources/citations/citations.json` : plus de 34 000 textes distincts de plus de 470 auteurs, dont Balzac, Sand, Hugo, Rousseau, Proust, Colette, Gide, Zola et Valéry. Les entrées du corpus précédent et les références bibliographiques différentes d’un même extrait sont conservées. L’index local couvre les mots et les lemmes de leur texte. Les extraits du Wiktionnaire sont des exemples littéraires, pas uniquement des maximes célèbres.

La sélection suit le domaine public **en France en 2026**. La [règle générale documentée par la BnF](https://api.bnf.fr/fr/node/2807) admet les auteurs morts jusqu’en 1955 inclus, et jusqu’en 1925 inclus pour son contrôle des « morts pour la France ». Aucun filtre de nationalité n’est appliqué. Les dates de décès de Wikiquote sont croisées avec les langues d’écriture et les mentions « mort pour la France » des notices de data.bnf.fr ; les catégories françaises de Wikiquote servent aussi à reconnaître les auteurs de langue française. Les œuvres posthumes bénéficient d’un [droit propre de 25 ans](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006278943/) lorsqu’elles sont divulguées après expiration des droits ordinaires : une publication jusqu’en 2000 inclus passe ce contrôle en 2026, ainsi qu’une publication effectuée pendant les 70 ans suivant le décès. Une réédition récente peut être retenue si sa publication initiale est renseignée et admissible.

Les traductions Wikiquote sont admises lorsque le traducteur est explicitement identifié, associé au français dans les notices BnF et admissible selon ses propres dates de décès et prorogations ; l’édition citée doit aussi passer le contrôle des publications posthumes tardives. Les traducteurs inconnus ou ambigus, adaptations et attributions indirectes restent écartés. Les exemples du Wiktionnaire comportant une traduction signalée restent exclus lorsque la référence ne permet pas de vérifier séparément le traducteur. Pour Wikiquote, auteur, titre et datation doivent être explicites ; la référence doit suivre immédiatement la citation. Chaque ajout conserve un lien vers la révision de sa page source.

Cette sélection automatisée dépend des métadonnées disponibles : elle n’est ni un inventaire exhaustif du domaine public, ni une certification juridique de chaque extrait. Les erreurs des sources, œuvres collectives, inédits et autres cas particuliers peuvent nécessiter une vérification individuelle. La licence des métadonnées ne rend pas libres les textes sous droits ; les critères français ne garantissent pas les mêmes droits dans tous les pays.

Le snapshot biographique BnF du 23 octobre 2026 porte le SHA-256 `46874982bb3cf753ebd8daf9fe88f470f85e30dcaa9089a96d0625d46573bf9c`. Ces [métadonnées publiques](https://www.bnf.fr/fr/portail-bnf-api-et-jeux-de-donnees) relèvent de la Licence ouverte, avec attribution à la BnF ; elles servent aux contrôles et ne sont pas chargées au runtime du plugin.

Les recherches lexicales portent sur un mot ; les citations interrogent aussi les mots et lemmes des extraits. Les lacunes des sources subsistent. `npm run resources` prépare les catalogues et fichiers de tous les packs ; `release.sh` et la publication GitHub les distribuent ensemble. Le fichier des conjugaisons approche 100 Mio : son téléchargement et sa première lecture peuvent prendre du temps. Pour récupérer un corpus de citations enrichi après publication, utiliser **Citations → Finition → Recharger** dans les réglages.

La requête BnF est construite à partir des noms d’auteurs et de traducteurs du dump Wikiquote, sans aucun texte du coffre :

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -c 'import runpy; print(runpy.run_path("scripts/wikiquote.py")["bnf_query"]("/tmp/finition-frwikiquote-20261001.xml.bz2"))' | curl -L --fail --silent --show-error --max-time 90 https://data.bnf.fr/sparql --data-urlencode 'query@-' --data-urlencode 'format=application/sparql-results+json' -o /tmp/finition-bnf-citation-rights-v2-20261023.json
```

Reproduction, avec les trois snapshots épinglés déjà téléchargés :

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-extra-dictionaries.py /tmp/finition-wiktextract-fr-20261023.jsonl.gz /tmp/finition-frwikiquote-20261001.xml.bz2 /tmp/finition-bnf-citation-rights-v2-20261023.json
PYTHONDONTWRITEBYTECODE=1 python3 scripts/check-extra-dictionaries.py /tmp/finition-frwikiquote-20261001.xml.bz2 /tmp/finition-bnf-citation-rights-v2-20261023.json
```

Le générateur vérifie les trois empreintes avant extraction. Les services sources renouvellent leurs données : rejouer la requête peut produire une empreinte différente ; conserver les snapshots épinglés permet une reproduction identique. Le générateur accepte un enrichissement du fichier de citations seulement si chaque ligne existante est conservée ; les autres fichiers différents restent protégés contre l’écrasement. Aucun site n’est interrogé lors d’une recherche dans le dictionnaire installé.

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

`kind` vaut `definitions`, `antonymes`, `phonetique`, `rimes`, `conjugaisons`, `historique`, `citations` ou `champ-lexical`. `name` est obligatoire et fournit le nom affiché dans le sélecteur. `description` et `documentation` sont facultatifs ; leurs limites sont respectivement 1 000 et 2 000 caractères. Seules les URL HTTP ou HTTPS sont acceptées. Le nom accepte 100 caractères. L’encodage est UTF-8 ; taille maximale du fichier : 128 Mio.

L’identifiant `historique` et le nom de son fichier restent stables pour les dictionnaires déjà installés ; son libellé dans l’interface est **Étymologie**.

Le champ `license`, présent dans tous les packs publics et facultatif pour les anciens imports personnels, est un objet contenant `name` (identifiant de licence, 100 caractères), `url` (lien de licence), `attribution` (4 000 caractères), `source` (URL d’origine), `download` (URL du dump), `sha256` (64 caractères hexadécimaux minuscules), `revision` (1 000 caractères) et `changes` (transformations, 4 000 caractères). Les liens suivent les mêmes limites que `documentation`. Ces métadonnées sont conservées dans le JSON utilisé localement.

`entries` associe chaque mot à une liste de lignes. Les clés sont des mots uniques normalisés en NFC et minuscules françaises ; `’` et `ʼ` deviennent `'`, `‑` devient `-`. Apostrophes et traits d’union sont acceptés à l’intérieur d’un mot. Les accents restent significatifs. Les expressions contenant des espaces ne sont pas des clés de recherche ; les candidats peuvent contenir plusieurs mots. La résolution des lemmes s’effectue à la consultation avec le lexique actif ; le fichier source reste intact.

Chaque ligne accepte `label` (titre facultatif de 1 000 caractères), `text` (texte de 20 000 caractères), `examples` (256 exemples de 10 000 caractères maximum) et `words` (1 à 2 048 candidats de 200 caractères maximum). Une définition contient un texte ou au moins un exemple ; la phonétique exige `text` et les antonymes exigent `words`. Une ligne de rimes contient soit des candidats explicites dans `words`, soit une transcription dans `text`. Une entrée accepte 1 à 2 048 lignes ; le dictionnaire accepte 1 à 1 200 000 entrées. Les clés ont 200 caractères maximum. Les chaînes renseignées sont non vides et sans caractères de contrôle U+0000 à U+001F.

Pour `conjugaisons`, `historique`, `citations` et `champ-lexical`, chaque ligne contient au moins un texte, une liste de mots ou un exemple non vide. `label` permet de conserver une relation lexicale, un temps verbal, une datation ou une référence bibliographique. Les mots associés sont affichés littéralement ; aucune relation manquante n’est déduite par le lecteur.

Exemple d’antonymes : `"ouvert": [{"label": "Accès", "words": ["fermé", "clos"]}]`. Exemple de phonétique : `"chat": [{"text": "ʃa"}]`. Exemple de rimes explicites : `"chat": [{"label": "Rimes", "words": ["rat", "achat"]}]`. Ces exemples prennent place dans `entries`, avec le `kind` correspondant.

Le champ facultatif `encoding: "phonetic-internal"` indique une notation phonétique interne conservée telle quelle, qui ne doit pas être présentée comme l’alphabet phonétique international. Pour les rimes fournies sous forme de transcriptions, Finition recherche les terminaisons identiques à partir de la dernière voyelle reconnue, donne priorité à la première prononciation du mot puis à ses variantes, privilégie un nombre proche de voyelles et affiche 200 résultats maximum. Une voyelle finale seule suffit, comme pour « chat » et « rat ». Cette approximation ne distingue pas toutes les syllabes, variantes régionales ou phonèmes optionnels ; elle ne reproduit pas un classement linguistique natif. Les dictionnaires peuvent fournir directement leurs candidats dans `words` pour utiliser leur propre classement.

## Conversion privée

`PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare-private-dictionaries.py` convertit les exports JSON locaux conservés dans `Antidote/dictionnaires/originaux/`, sans exécuter ni modifier l’application source. Les sorties `definition-antidote-finition.json`, `antonyme-antidote-finition.json`, `phonetique-antidote-finition.json` et `rime-antidote-finition.json` sont placées dans `Antidote/dictionnaires/finition/` ; elles s’importent depuis leur section respective. Un fichier existant différent n’est jamais écrasé. Le [rangement privé](lexique.md#rangement-des-dictionnaires-privés) sépare également les originaux des synonymes et du lexique convertis, avec empreintes de conservation.

Les définitions conservent leurs textes, exemples et titres de section disponibles ; les antonymes conservent leurs groupes de sens. Les codes grammaticaux et régionaux non identifiés ne sont pas interprétés. Les transcriptions retenues correspondent aux graphies canoniques selon les correspondances morphologiques observées ; les cas sans correspondance sûre sont exclus. La conversion conserve la notation interne, sans conversion supposée vers l’API. Les exports bruts restent disponibles pour reprendre ces limites ultérieurement.

`scripts/extract-antidote-conjugations.py` conserve le sous-ensemble verbal complet dans `originaux/conjugaison-antidote-original.json` et produit `finition/conjugaison-antidote-finition.json`. Les flexions et variantes sont regroupées par infinitif vérifié, avec leurs codes natifs. Les locutions et les canoniques sans infinitif vérifié restent dans l’original ; aucun temps composé n’est reconstruit.

`scripts/extract-antidote-history.py` décode statiquement les quatre tables de `Grimoire.05.psi` et conserve auteurs, œuvres, citations, mots et références dans `originaux/historique-antidote-original.json`. Il produit `finition/historique-antidote-finition.json` et `finition/citation-antidote-finition.json`. Ce dernier contient les citations des attestations historiques, pas le dictionnaire général de citations. Les références natives absentes sont recensées dans `preuves/historique-extraction.json`, sans texte inventé. Les codes de datation non interprétés restent dans l’original ; les modifications graphiques historiques de l’application ne sont pas reproduites.

Ces fichiers privés restent ignorés par Git et exclus des packs publics. Le décodage natif du champ lexical, des étymologies et du corpus général de citations n’est pas établi ; les preuves de l’investigation Combi restent dans le dossier privé `preuves/`.
