# Finition

Un plugin Obsidian pour fignoler vos textes : traque les répétitions, les stéréotypes, les lieux communs, les phrases de longueur semblable en cascade, les ternaires et les effets de cadence…

Une icône ♪ apparaît dans la barre d'état en bas d'Obsidian. Cliquer dessus ouvre un menu de choix du mode d'analyse actif, **mutuellement exclusifs** : activer un mode désactive automatiquement les autres. Recliquer sur le mode déjà actif l'éteint.

## Modes

- **Répétitions** — détection par lemme sur une fenêtre glissante (réglable), couleurs tournantes
- **Atténuation** — surligne les locutions de prudence rhétorique (« il semblerait que », « dans une certaine mesure »...)
- **Stéréotypes** — repère les lieux communs et clichés corporels/émotionnels (« serrer les poings », « le cœur s'emballer »...)
- **Burstiness** — repère les séries de phrases consécutives de longueur perceptiblement proche, sans dictionnaire
- **Ternaires** — repère les séquences de trois groupes parallèles séparés par virgule et/ou « et »/« ou »/« ni », de même signature grammaticale
- **Cadence** — repère les phrases entières qui partagent une structure identique (même nombre de mots par groupe) quand cette structure se répète à proximité
- **Charnières** — surligne simplement les mots-charnières du texte (« qui », « que », « et », « mais »...), sans comparaison

Chaque mode peut aussi être réglé dans Réglages → Finition (empans, tolérances, mots-outils, et une palette de 16 couleurs entièrement personnalisable, avec association possible d'une couleur à Atténuation/Stéréotypes/Ternaires/Charnières).

## Installation

1. Télécharge `main.js`, `manifest.json` et `styles.css` depuis la [dernière release GitHub](https://github.com/tcrouzet/finition/releases).
2. Crée le dossier `<ton-vault>/.obsidian/plugins/finition/` et copies-y ces trois fichiers (aucun autre fichier n'est nécessaire : les dictionnaires sont inlinés dans `main.js`).
3. Active le plugin dans Obsidian (Réglages → Plugins communautaires).

## Architecture (bref)

Le plugin s'appuie sur quelques dictionnaires statiques, dans `plugin/data/` — importés comme des modules TypeScript (`resolveJsonModule`) et inlinés par esbuild directement dans `main.js` au build, jamais lus depuis le disque au runtime :

- `lexicon.json` — dictionnaire mot → lemme (dérivé de Morphalou), utilisé par Répétitions et Stéréotypes. Pas de désambiguïsation grammaticale : un mot ambigu garde toujours le même lemme.
- `function-words.json` — liste des mots-outils exclus des Répétitions (éditable aussi depuis les réglages).
- `epistemic-hedging.json` — locutions détectées par le mode Atténuation.
- `stereotypes.json` — séquences de lemmes détectées par le mode Stéréotypes.
- `syntax-hinges.json` — liste des mots-charnières, partagée par Cadence et Charnières.

Le code est découpé en un module par mode dans `plugin/modes/`, orchestrés par `main.ts` (menu, réglages) et `editor-extension.ts` (surlignage en direct dans l'éditeur CodeMirror 6).

## Limites connues

- Document entier recalculé à chaque frappe (debouncé) ; désactivation automatique au-delà de 200 000 caractères.
- Mode Ternaires porté sans le filtre spaCy annexe de l'outil Python d'origine, donc légèrement plus de faux positifs sur certaines qualifications binaires (ex. « grand et beau, intelligent »).
