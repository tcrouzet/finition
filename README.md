# Finition

Un plugin Obsidian pour relire la prose française : répétitions, stéréotypes, atténuations, monotonie, tricolons et cadences. Il propose aussi une correction locale avec Grammalecte, une normalisation de la ponctuation et, sur demande, une relecture ou des synonymes par IA.

Une icône ♪ apparaît dans la barre d'état en bas d'Obsidian. Cliquer dessus ouvre un menu de choix du mode d'analyse actif, **mutuellement exclusifs** : activer un mode désactive automatiquement les autres. Recliquer sur le mode déjà actif l'éteint.

Activer un mode place le curseur sur sa première occurrence et affiche le nombre d’occurrences surlignées dans la barre d’état. La flèche descendante rejoint la suivante et revient à la première après la dernière. Le compteur suit les modifications du texte et la note active.

Après une analyse Grammalecte, la même flèche rejoint la faute suivante et boucle vers la première. Le compteur suit les fautes restantes après correction ou ignorance d’une occurrence.

## Modes

- **Répétitions** — détection par lemme sur une fenêtre glissante (réglable), couleurs tournantes
- **Atténuation** — surligne les locutions de prudence rhétorique (« il semblerait que », « dans une certaine mesure »...)
- **Stéréotypes** — repère les lieux communs et clichés corporels/émotionnels (« serrer les poings », « le cœur s'emballer »...)
- **Monotonie** — repère les séries de phrases consécutives de longueur perceptiblement proche, sans dictionnaire
- **Tricolons** — repère les séquences d’exactement trois groupes parallèles séparés par virgule et/ou « et »/« ou »/« ni », de même signature grammaticale. Les listes plus longues ne sont pas découpées en tricolons ; les séries repérées reçoivent des couleurs tournantes.
- **Cadence** — rapproche des phrases voisines de même construction. Le moteur **Rapide** compare exactement les nombres de mots des groupes séparés par virgules ou charnières ; le moteur **Grammalecte** compare leurs signatures syntaxiques. Le choix du moteur et l’empan sont réglables.
- **Charnières** — surligne simplement les mots-charnières du texte (« qui », « que », « et », « mais »...), sans comparaison

Chaque mode peut aussi être réglé dans **Réglages → Finition** : empans, tolérances, mots-outils et palette de 16 couleurs. Atténuation, Stéréotypes, Charnières et Grammalecte ont une couleur réglable ; Répétitions, Cadence et Tricolons utilisent des couleurs tournantes.

Le mode expérimental Tic IA est désactivé dans le menu et les réglages : son pourcentage n’est pas un indicateur fiable. Si ce mode était mémorisé, le plugin active Tricolons au chargement. Le moteur et le dictionnaire restent conservés dans les sources. Tricolons reste disponible pour analyser les procédés du texte sans leur attribuer une origine IA. La commande Structure et son entrée dans le menu s’affichent en activant **Mode debug** dans Réglages → Finition ; ce réglage est désactivé par défaut.

## Grammalecte et Structure

**Grammalecte** analyse toute la note, localement et hors ligne, sans clé API. Les fautes d’orthographe et de grammaire sont soulignées différemment. Sélectionner un mot souligné ouvre les suggestions : choisir une correction, **Ignorer** cette occurrence ou **Ajouter au dictionnaire** pour les mots inconnus à conserver. Les autres fautes restent disponibles ; le compteur et la flèche de la barre d’état suivent les fautes restantes.

Dans **Réglages → Finition → Grammalecte**, on peut choisir le dictionnaire classique ou les rectifications de 1990, éditer le dictionnaire personnel et régler la couleur. Le moteur et les dictionnaires sont intégrés au plugin : aucun téléchargement supplémentaire n’est nécessaire.

**Structure**, accessible seulement en mode debug, crée une nouvelle note d’analyse phrase par phrase : cadratifs, sujets, verbes, compléments, coordinations, ponctuation et groupes ternaires numérotés. L’original n’est pas modifié. Ce découpage est heuristique et reste à vérifier à la lecture.

## Ortho-typo IA

L’entrée **Ortho-typo IA** du menu ♪ envoie uniquement le texte sélectionné au fournisseur correspondant au modèle configuré : Anthropic ou OpenAI. Il faut renseigner la clé API du fournisseur dans **Réglages → Finition** ; ces appels peuvent être payants. Le prompt de relecture et le modèle sont personnalisables, avec une bibliothèque de prompts enregistrés.

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

### Méthode recommandée : BRAT, sans terminal

Finition s’installe directement depuis GitHub avec [BRAT](https://github.com/TfTHacker/obsidian42-brat), sans attendre son admission au catalogue Obsidian.

1. Dans Obsidian, ouvrir **Réglages → Plugins communautaires → Parcourir**, chercher **BRAT**, l’installer et l’activer.
2. Ouvrir la palette de commandes (`Cmd+P` sur macOS, `Ctrl+P` sur Windows/Linux), puis lancer **BRAT: Add a beta plugin for testing**.
3. Renseigner `tcrouzet/finition`, puis sélectionner **Add Plugin**.
4. Quand BRAT confirme l’installation, ouvrir **Réglages → Plugins communautaires** et activer **Finition** si nécessaire.
5. Pour les nouvelles versions, utiliser les vérifications de mises à jour de BRAT ; il télécharge les releases et recharge le plugin.

BRAT est à installer dans chaque coffre où l’on souhaite utiliser Finition. Voir aussi le [guide officiel de BRAT](https://tfthacker.com/brat-quick-guide).

### Shell : install.sh

Pour les personnes à l’aise avec le terminal, [install.sh](install.sh) fonctionne avec **Bash, curl et jq** sur macOS et Linux. Il est aussi utilisable sous Windows avec Git Bash et ces commandes disponibles ; pour une installation sans shell sous Windows, utiliser BRAT.

```sh
curl -fL https://raw.githubusercontent.com/tcrouzet/finition/main/install.sh -o install.sh
bash install.sh
```

Le script lit uniquement les registres de coffres connus d’Obsidian, affiche les coffres accessibles et demande lequel utiliser. Il ne parcourt pas tout le disque. Sous Linux, les emplacements habituels, Flatpak et Snap sont pris en compte.

Pour indiquer directement un coffre, ou un dossier de configuration personnalisé :

```sh
bash install.sh "/chemin/vers/Mon coffre"
bash install.sh "/chemin/vers/Mon coffre" ".obsidian-perso"
```

Fermer Obsidian avant de confirmer l’installation. Le script télécharge les trois fichiers d’une même release stable, vérifie le manifest, puis remplace uniquement `main.js`, `manifest.json` et `styles.css`. Les anciens fichiers sont sauvegardés dans `<coffre>/<configuration>/finition-backups/` ; les réglages personnels (`data.json`) et les notes sont conservés. En cas d’échec pendant le remplacement, il tente de restaurer les fichiers précédents et indique la sauvegarde si une restauration manuelle est nécessaire. Relancer le même script permet de mettre à jour Finition.

### Copie manuelle

Télécharger `main.js`, `manifest.json` et `styles.css` depuis la [dernière release GitHub](https://github.com/tcrouzet/finition/releases/latest) et les copier dans `<coffre>/.obsidian/plugins/finition/`. Aucun dossier `data` supplémentaire n’est requis. Sous Windows, on peut aussi utiliser PowerShell :

```powershell
New-Item -ItemType Directory -Force -Path "<vault>\.obsidian\plugins\finition"
Set-Location "<vault>\.obsidian\plugins\finition"
Invoke-WebRequest -Uri "https://github.com/tcrouzet/finition/releases/latest/download/main.js" -OutFile "main.js"
Invoke-WebRequest -Uri "https://github.com/tcrouzet/finition/releases/latest/download/manifest.json" -OutFile "manifest.json"
Invoke-WebRequest -Uri "https://github.com/tcrouzet/finition/releases/latest/download/styles.css" -OutFile "styles.css"
```

Après installation ou mise à jour manuelle, rouvrir Obsidian et activer Finition dans **Réglages → Plugins communautaires**, ou désactiver puis réactiver le plugin s’il était déjà installé.

## Confidentialité

Les analyses stylistiques, Structure, Ponctuation et Grammalecte fonctionnent localement. Les fonctions IA ne s’exécutent que sur demande : Ortho-typo envoie la sélection, Synonymes envoie la sélection et son contexte décrit plus haut, au fournisseur configuré. Les clés API sont enregistrées dans les réglages du plugin. L’installation et les mises à jour via BRAT, le script ou la copie manuelle nécessitent une connexion à GitHub, sans envoi du contenu des notes.

## Soumission au catalogue Obsidian

Après avoir publié la release avec `release.sh` et poussé le même `manifest.json` sur la branche GitHub par défaut, lance `./submit.sh` (GitHub CLI connecté et `jq` requis). Le script vérifie la release publique, ses fichiers obligatoires et la concordance des manifests, puis ouvre [la gestion des plugins du compte Obsidian](https://community.obsidian.md/account/plugins). Il ne pousse aucun fichier chez Obsidian et ne crée aucune pull request.

La [procédure officielle](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) demande de se connecter sur [Obsidian Community](https://community.obsidian.md/account/plugins), de lier son compte GitHub, puis de choisir **New plugin** et de renseigner `https://github.com/tcrouzet/finition`. La validation des règles et l’envoi du formulaire restent manuels. Après acceptation au catalogue, les nouvelles versions passent uniquement par les releases GitHub, sans nouvelle soumission.

## Architecture (bref)

Le plugin s’appuie sur les dictionnaires de `data/`, intégrés par esbuild dans `main.js`, jamais lus dans un dossier séparé au moment de l’exécution :

- `lexicon.json` — dictionnaire mot → lemme (dérivé de Morphalou), utilisé par Répétitions et Stéréotypes. Pas de désambiguïsation grammaticale : un mot ambigu garde toujours le même lemme.
- `function-words.json` — liste des mots-outils exclus des Répétitions (éditable aussi depuis les réglages).
- `epistemic-hedging.json` — locutions détectées par le mode Atténuation.
- `stereotypes.json` — séquences de lemmes détectées par le mode Stéréotypes.
- `syntax-hinges.json` — liste des mots-charnières, partagée par Cadence et Charnières.
- `tic-ia.json` — catalogue des tics, motifs de détection, seuils et limites des règles sémantiques.

Le code est découpé dans `modes/`, orchestré par `main.ts` et `editor-extension.ts`. `grammalecte-extension.ts` gère les corrections locales, `ai/` les appels IA et leurs suggestions, et `ui/` la navigation et la fenêtre de synonymes. Les scripts et données Grammalecte sont intégrés comme ressources textuelles par `raw-assets.mjs` et `modes/grammalecte-resources.ts`.

## Développement et vérification

```sh
npm install
npm run build
npm run lint
npx --no-install jiti scripts/check-install.ts
npx --no-install jiti scripts/check-submit.ts
npx --no-install jiti scripts/check-structure.ts
```

Les tests d’installation utilisent de faux coffres et des téléchargements simulés : aucun vrai coffre n’est modifié. Le test Structure accepte aussi un chemin de rapport en argument pour vérifier son corpus sans modifier les notes. `scripts/check-tic-click.ts` vérifie les interactions de l’éditeur et le moteur de la release dans Chromium ; ce contrôle nécessite Google Chrome sur macOS et un `main.js` fraîchement compilé.

## Limites connues

- Document entier recalculé à chaque frappe (debouncé) ; désactivation automatique au-delà de 200 000 caractères.
- La reconnaissance syntaxique et celle des tricolons restent heuristiques : faux positifs et omissions sont possibles.
