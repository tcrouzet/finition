# Finition

Finition aide à relire les textes français dans Obsidian : répétitions, clichés, rythme des phrases, orthographe et ponctuation.

Le plugin se télécharge gratuitement depuis GitHub, hors du catalogue officiel d’Obsidian. Seules les fonctions IA peuvent entraîner des frais auprès du fournisseur choisi.

## Installer

### Sans terminal, avec BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) est un plugin qui installe d’autres plugins depuis GitHub.

1. Dans **Réglages → Plugins communautaires → Parcourir**, installer et activer **BRAT**.
2. Ouvrir la palette de commandes (`Cmd+P` sur Mac, `Ctrl+P` sur Windows/Linux) et lancer **BRAT: Add a beta plugin for testing**.
3. Saisir `tcrouzet/finition`, puis cliquer sur **Add Plugin**.
4. Activer **Finition** dans **Réglages → Plugins communautaires**.

Pour mettre à jour Finition, utiliser la recherche de mises à jour de BRAT. Répéter l’installation dans chaque coffre concerné. [Guide de BRAT](https://tfthacker.com/brat-quick-guide).

### Avec le terminal

Il faut **Bash, curl et jq** : sur Mac ou Linux, ou sous Windows avec Git Bash.

Fermer Obsidian, puis lancer :

```sh
curl -fL https://raw.githubusercontent.com/tcrouzet/finition/main/install.sh -o install.sh
bash install.sh
```

Choisir le coffre dans la liste et confirmer. Le script installe la dernière version publiée sur GitHub, conserve les notes et les réglages, et sauvegarde l’ancienne version dans `.obsidian/finition-backups/`.

Si le coffre n’apparaît pas, indiquer son chemin :

```sh
bash install.sh "/chemin/vers/Mon coffre"
bash install.sh "/chemin/vers/Mon coffre" ".obsidian-perso"
```

Le second exemple sert aux coffres dont le dossier de configuration ne s’appelle pas `.obsidian`.

Rouvrir Obsidian et activer **Finition** dans **Réglages → Plugins communautaires**. Pour mettre à jour, relancer le script après avoir fermé Obsidian.

## Utiliser Finition

Cliquer sur **♪**, en bas d’Obsidian, puis choisir une analyse :

- **Répétitions** : mots répétés, en tenant compte de leurs formes conjuguées ou accordées.
- **Atténuation** : expressions comme « il semblerait que » ou « dans une certaine mesure ».
- **Stéréotypes** : clichés et lieux communs.
- **Monotonie** : suites de phrases de longueur proche.
- **Tricolons** : séries de trois groupes de même construction. Les listes de plus de trois éléments sont exclues.
- **Cadence** : phrases voisines construites de façon comparable.
- **Charnières** : mots de liaison comme « mais », « et » ou « que ».

Une seule analyse est active à la fois. Cliquer à nouveau sur son nom la désactive. Le compteur indique le nombre de passages repérés ; la flèche descendante mène au suivant. Les couleurs et les critères d’analyse se règlent dans **Réglages → Finition**.

### Orthographe et ponctuation

**Grammalecte** vérifie l’orthographe et la grammaire sans connexion Internet. Cliquer sur une faute pour la corriger, l’ignorer ou ajouter le mot au dictionnaire personnel. La flèche de la barre d’état passe à la faute suivante. Le choix entre orthographe classique et rectifications de 1990 se fait dans les réglages.

**Ponctuation** modifie directement toute la note : espaces insécables, apostrophes, tirets et lignes vides. Le code, les liens et les horaires sont préservés.

### Fonctions IA

Renseigner une clé API Anthropic ou OpenAI et choisir le modèle dans **Réglages → Finition**, puis sélectionner du texte :

- **Ortho-typo IA** propose des corrections. Cliquer sur une proposition pour l’appliquer ; rien n’est remplacé sans validation.
- **Synonymes IA** propose une liste de variantes. Choisir un synonyme pour remplacer la sélection, ou le copier. Le bouton **Copier toute la liste** copie toutes les propositions. Déplacer la fenêtre par son titre pour lire le texte en dessous.

Les consignes d’Ortho-typo IA sont personnalisables dans les réglages.

### Analyse de structure

Activer **Mode debug** dans les réglages fait apparaître **Structure** dans le menu ♪. Cette fonction crée une note qui décrit chaque phrase : cadratifs, sujets, verbes, compléments et groupes de trois. L’original reste intact. Les analyses de structure et de tricolons peuvent manquer des passages ou en signaler à tort.

## Confidentialité

Les analyses, Grammalecte et Ponctuation restent sur l’appareil. Les fonctions IA envoient du texte au fournisseur choisi, uniquement sur demande : la sélection pour Ortho-typo, et le paragraphe de la sélection avec celui d’avant et celui d’après pour Synonymes, s’ils existent. Les clés API sont conservées dans les réglages du plugin. L’installation et les mises à jour passent par GitHub sans envoyer les notes.

## Développement

```sh
npm install
npm run build
npm run lint
npx --no-install jiti scripts/check-install.ts
npx --no-install jiti scripts/check-structure.ts
```
