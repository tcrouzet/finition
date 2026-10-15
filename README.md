# Finition — Répétitions dans Obsidian

Plugin Obsidian qui détecte les répétitions lexicales (même lemme répété
à faible distance) et colore les mots concernés directement dans l'éditeur
(Live Preview et mode Source), en live pendant la frappe.

## Principe

- Tokenisation + filtrage des mots-outils
- Détection de répétitions du même **lemme** dans une fenêtre glissante de
  N caractères (réglable, 1500 par défaut)
- Attribution de couleurs tournantes (une classe CSS parmi 20, reprises
  telles quelles de `assets/chart-palette.yml` dans le repo `unshiter`,
  pour rester visuellement cohérent avec les graphiques générés par
  `analyse.sh`), avec recyclage des couleurs libérées une fois qu'un
  groupe de répétition sort de la fenêtre

## Limite assumée sur la lemmatisation

Une vraie lemmatisation contextuelle (désambiguïser "la" article vs
pronom, par exemple) demande un pipeline NLP complet, trop lourd à
embarquer dans un plugin Obsidian. Le plugin utilise à la place un
**dictionnaire statique mot → lemme** (format `lexicon.json`), généré une
fois par un script externe. Conséquences :

- Pas de désambiguïsation par catégorie grammaticale (un mot ambigu prend
  toujours le même lemme, quel que soit son usage dans la phrase)
- Les mots absents du dictionnaire (néologismes, noms propres) sont
  traités comme leur propre lemme
- Le filtrage des mots-outils se fait par liste de formes exactes, sans
  filtrage par catégorie grammaticale

C'est une approximation raisonnable, sans dépendance lourde (pas de
pipeline NLP, pas de venv) et compatible avec le bundle d'un plugin
Obsidian classique.

## Architecture du code (plugin/)

```
main.ts               orchestrateur : chargement des données/réglages,
                       barre d'état, menu de mode exclusif
types.ts               types partagés, réglages par défaut, FinitionRuntime
editor-extension.ts    intégration CodeMirror 6 (décorations en direct)
settings-tab.ts        onglet de réglages
modes/
  repetition.ts         algorithme "répétitions lexicales"
  hedging.ts            algorithme "hedging épistémique"
```

Pour ajouter un futur mode (stéréotypes, burstiness...) : un nouveau
fichier dans `modes/`, un cas ajouté dans `buildDecorations()` côté
`editor-extension.ts`, une entrée de menu dans `main.ts` branchée sur
`setMode("...")`, et une option dans le dropdown de `settings-tab.ts`.

## Mise en place

### 1. Générer le dictionnaire lexical

Le script `python-export/export_lemmas.py` fourni ici s'appuie sur un
index Morphalou (forme → lemme) existant. Place-le dans
`script/export/export_lemmas.py` de ton projet (il importe le package
`detector/` qui vit dans `script/`), puis lance-le depuis la racine du
projet :

```sh
venv/bin/python script/export/export_lemmas.py
```

Pas besoin de `-m` ni de variable `PYTHONPATH` : le script s'ajoute
lui-même `script/` à son `sys.path` avant d'importer `detector`.

Cela produit trois fichiers dans `obsidian-plugin/data/` :
- `lexicon.json` (mot → lemme, uniquement les formes où mot ≠ lemme)
- `function-words.json` (liste à plat des mots-outils)
- `epistemic-hedging.json` (locutions de prudence épistémique, pour le mode « Prudence épistémique »)

Copie-les ensuite dans `data/` du plugin (voir structure ci-dessous).

### 2. Builder le plugin

```sh
cd unshiter-obsidian/plugin
npm install
npm run build
```

### 3. Installer dans ton vault

Copie `main.js`, `manifest.json`, `styles.css` et le dossier `data/`
(avec `lexicon.json`, `function-words.json` et `epistemic-hedging.json`) dans :

```
<ton-vault>/.obsidian/plugins/finition/
```

Active le plugin dans Obsidian (Réglages → Plugins communautaires).

## Point d'entrée : la note de musique dans la barre d'état (Finition)

Une icône ♪ apparaît dans la barre d'état en bas d'Obsidian. Cliquer dessus
ouvre un menu de choix du mode d'analyse actif, **mutuellement exclusifs** :
activer un mode désactive automatiquement les autres (cumuler les
surlignages rendrait le texte illisible et serait inutilement coûteux à
calculer en direct). Recliquer sur le mode déjà actif l'éteint.

- **Répétitions** — détection par lemme sur une fenêtre glissante
- **Prudence épistémique** — surligne les locutions de prudence rhétorique
  (« il semblerait que », « dans une certaine mesure »...), par simple
  correspondance de locutions sur `epistemic-hedging.json`
- **Stéréotypes (non portable en JS)** — grisé en permanence : dépend de
  l'analyse syntaxique spaCy (dépendances, morphologie verbale) côté
  Python, pas d'équivalent léger en JS
- **Burstiness (bientôt)** — entrée grisée, en attente de portage

Ajouter un mode futur revient à ajouter une entrée de menu + son propre
calcul de surlignage, relié à `plugin.setMode(...)`, sans toucher à
l'architecture générale.

L'icône est atténuée quand aucun mode n'est actif, pleine opacité sinon.

## Réglages disponibles

- **Mode actif** (menu déroulant : Aucun / Répétitions / ...),
  redondant avec le clic sur l'icône de la barre d'état, les deux restent
  synchronisés
- **Empan de répétition** en caractères, réglable (équivalent du 3ᵉ
  argument `empan_caracteres` de `analyse.sh`) — **1500 par défaut**
- Longueur minimale des mots pris en compte

## Limites connues de ce scaffold v0.1

- Document entier recalculé à chaque frappe (debouncé), pas d'analyse par
  fenêtre de viewport → à affiner pour les très longs documents
  (garde-fou actuel : désactivation au-delà de 200 000 caractères)
- Pas encore de visualisation des autres métriques (stéréotypes,
  ternaires) — seulement les répétitions et la prudence épistémique. La même
  architecture (regex/dictionnaire → Decoration.mark) s'étend facilement
  si tu veux les ajouter ensuite.
- Licence Morphalou (LGPL-LR) : vérifie qu'elle autorise la redistribution
  du dictionnaire dérivé dans un plugin public avant publication sur la
  Community Plugins d'Obsidian.
