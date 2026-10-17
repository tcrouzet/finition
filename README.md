# Finition

Un plugin Obsidian pour fignoler vos textes : traque les répétitions, les stéréotypes, les lieux communs, les phrases de longueur semblable en cascade, les ternaires et les effets de cadence…

Une icône ♪ apparaît dans la barre d'état en bas d'Obsidian. Cliquer dessus ouvre un menu de choix du mode d'analyse actif, **mutuellement exclusifs** : activer un mode désactive automatiquement les autres. Recliquer sur le mode déjà actif l'éteint.

Activer un mode place le curseur sur sa première occurrence et affiche le nombre d’occurrences surlignées dans la barre d’état. La flèche descendante rejoint la suivante et revient à la première après la dernière. Le compteur suit les modifications du texte et la note active.

Après une analyse Grammalecte, la même flèche rejoint la faute suivante et boucle vers la première. Le compteur suit les fautes restantes après correction ou ignorance d’une occurrence.

## Modes

- **Répétitions** — détection par lemme sur une fenêtre glissante (réglable), couleurs tournantes
- **Atténuation** — surligne les locutions de prudence rhétorique (« il semblerait que », « dans une certaine mesure »...)
- **Stéréotypes** — repère les lieux communs et clichés corporels/émotionnels (« serrer les poings », « le cœur s'emballer »...)
- **Monotonie** — repère les séries de phrases consécutives de longueur perceptiblement proche, sans dictionnaire
- **Tricolon** — repère les séquences d’exactement trois groupes parallèles séparés par virgule et/ou « et »/« ou »/« ni », de même signature grammaticale. Les listes plus longues ne sont pas découpées en tricolons.
- **Cadence** — découpe chaque phrase en groupes (séparés par virgule ou mot-charnière) et surligne la phrase ENTIÈRE quand sa séquence de longueurs de groupes (ex. 3, 5, 3 mots) est EXACTEMENT identique, groupe par groupe, à celle d'une autre phrase à proximité — pas juste une longueur totale comparable (voir Monotonie pour ça), mais le même rythme interne, groupe pour groupe
- **Charnières** — surligne simplement les mots-charnières du texte (« qui », « que », « et », « mais »...), sans comparaison

Chaque mode peut aussi être réglé dans Réglages → Finition (empans, tolérances, mots-outils, et une palette de 16 couleurs entièrement personnalisable, avec association possible d'une couleur à Atténuation/Stéréotypes/Tricolon/Charnières).

Le mode expérimental Tic IA est désactivé dans le menu et les réglages : son pourcentage n’est pas un indicateur fiable. Si ce mode était mémorisé, le plugin active Tricolons au chargement. Le moteur et le dictionnaire restent conservés dans les sources. Tricolons reste disponible pour analyser les procédés du texte sans leur attribuer une origine IA. La commande Structure et son entrée dans le menu s’affichent en activant **Mode debug** dans Réglages → Finition ; ce réglage est désactivé par défaut.

Vérification locale : `npx jiti scripts/check-structure.ts`. Un chemin de rapport Structure peut être fourni en argument pour analyser son corpus sans modifier les notes.

## Ortho-typo IA

Une entrée séparée du menu ♪ ("Ortho-typo IA") envoie le texte **sélectionné** à Claude (API Anthropic) pour une relecture orthographique, grammaticale et stylistique. Nécessite une clé API Anthropic, à renseigner dans Réglages → Finition.

- Le texte est découpé en tronçons par paragraphe entier (jamais coupé au milieu d'un paragraphe), envoyés un par un.
- **Le document n'est jamais modifié automatiquement.** Les corrections proposées s'affichent en couleur (texte original barré en rouge, proposition en vert) comme de simples commentaires visuels.
- Cliquer sur une suggestion (sa partie rouge ou verte) l'applique réellement au document — et seulement à ce moment-là. Les autres suggestions en attente restent inchangées.
- "Ortho-typo IA : effacer les suggestions en attente" (palette de commandes, ou bouton dans les réglages) efface les suggestions non validées sans toucher au document.
- Le prompt de correction est entièrement éditable dans les réglages.

## Synonymes IA

L’entrée **Synonymes IA** du menu ♪ et la commande du même nom cherchent des variantes du texte sélectionné avec le modèle configuré dans les réglages. Chaque lancement envoie au fournisseur correspondant (Anthropic ou OpenAI) le paragraphe précédent, le paragraphe sélectionné et le suivant, lorsqu’ils existent. La sélection est encadrée de `**` dans ce contexte. Le prompt dédié `ai/system-prompt-synonymes.md` est intégré à la compilation.

Choisir une proposition remplace uniquement la sélection d’origine ; **Copier** place le synonyme dans le presse-papiers sans modifier la note. **Copier toute la liste**, en pied de fenêtre, copie les propositions sous forme de liste à puces Markdown. Glisser le titre déplace la fenêtre pour lire le texte en dessous. Si la note ou son contenu a changé pendant la recherche, le remplacement est refusé et la copie reste disponible.

## Ponctuation

Une entrée séparée du menu ♪ ("Ponctuation") corrige, immédiatement et sans validation (règles objectives, pas un jugement), **toute la note** :

- Espace insécable avant `!` `?` `:` `»` et après `«`.
- Tiret de dialogue en début de ligne normalisé en em dash (—) + insécable (jamais un simple `-`, pour ne pas casser les listes Markdown).
- Tirets d'incise dans le texte (– ... –) : insécable après le premier, avant le second.
- Apostrophes droites (`'`) → typographiques (`’`).
- Jamais plus de deux sauts de ligne consécutifs, sauf entre deux entrées d'une liste où un seul est conservé.

Blocs de code, code inline, liens Markdown/wiki, URLs et horaires sont protégés (jamais modifiés).

## Installation

Trois fichiers à récupérer depuis la [dernière release GitHub](https://github.com/tcrouzet/finition/releases) : `main.js`, `manifest.json`, `styles.css`. Aucun autre fichier n'est nécessaire : les dictionnaires et le moteur Grammalecte sont intégrés dans `main.js`. Grammalecte fonctionne hors ligne sans dossier `data` à installer. Remplace `<vault>` ci-dessous par le chemin de ton coffre Obsidian.

### macOS / Linux (Terminal)

```sh
mkdir -p "<vault>/.obsidian/plugins/finition"
cd "<vault>/.obsidian/plugins/finition"
curl -LO https://github.com/tcrouzet/finition/releases/latest/download/main.js
curl -LO https://github.com/tcrouzet/finition/releases/latest/download/manifest.json
curl -LO https://github.com/tcrouzet/finition/releases/latest/download/styles.css
```

### Windows (PowerShell)

```powershell
New-Item -ItemType Directory -Force -Path "<vault>\.obsidian\plugins\finition"
Set-Location "<vault>\.obsidian\plugins\finition"
Invoke-WebRequest -Uri "https://github.com/tcrouzet/finition/releases/latest/download/main.js" -OutFile "main.js"
Invoke-WebRequest -Uri "https://github.com/tcrouzet/finition/releases/latest/download/manifest.json" -OutFile "manifest.json"
Invoke-WebRequest -Uri "https://github.com/tcrouzet/finition/releases/latest/download/styles.css" -OutFile "styles.css"
```

Puis, dans les deux cas : active le plugin dans Obsidian (Réglages → Plugins communautaires → désactiver le mode sans échec si besoin → activer « Finition »).

## Architecture (bref)

Le plugin s'appuie sur quelques dictionnaires statiques, dans `plugin/data/` — importés comme des modules TypeScript (`resolveJsonModule`) et inlinés par esbuild directement dans `main.js` au build, jamais lus depuis le disque au runtime :

- `lexicon.json` — dictionnaire mot → lemme (dérivé de Morphalou), utilisé par Répétitions et Stéréotypes. Pas de désambiguïsation grammaticale : un mot ambigu garde toujours le même lemme.
- `function-words.json` — liste des mots-outils exclus des Répétitions (éditable aussi depuis les réglages).
- `epistemic-hedging.json` — locutions détectées par le mode Atténuation.
- `stereotypes.json` — séquences de lemmes détectées par le mode Stéréotypes.
- `syntax-hinges.json` — liste des mots-charnières, partagée par Cadence et Charnières.
- `tic-ia.json` — catalogue des tics, motifs de détection, seuils et limites des règles sémantiques.

Le code est découpé en un module par mode dans `plugin/modes/`, orchestrés par `main.ts` (menu, réglages) et `editor-extension.ts` (surlignage en direct dans l'éditeur CodeMirror 6).

## Limites connues

- Document entier recalculé à chaque frappe (debouncé) ; désactivation automatique au-delà de 200 000 caractères.
- Mode Tricolon porté sans le filtre spaCy annexe de l'outil Python d'origine, donc légèrement plus de faux positifs sur certaines qualifications binaires (ex. « grand et beau, intelligent »).
