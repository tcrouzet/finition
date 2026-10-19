# Finition

Finition aide à relire les textes français dans Obsidian : répétitions, clichés, rythme des phrases, orthographe et ponctuation.

Obsidian 1.14 ou ultérieur est requis. Les réglages sont indexés par la recherche des paramètres.

Les identifiants des commandes Ponctuations, Corrections et Structure ont été normalisés pour Obsidian ; réattribuer leurs raccourcis personnalisés après cette mise à jour.

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

Cliquer sur **♫**, en bas d’Obsidian, puis choisir une analyse :

- **Répétitions** : mots répétés, en tenant compte de leurs formes conjuguées ou accordées.
- **Atténuation** : expressions comme « il semblerait que » ou « dans une certaine mesure ».
- **Stéréotypes** : clichés et lieux communs.
- **Monotonie** : suites de phrases de longueur proche.
- **Tricolons** : séries de trois groupes de même construction. Les listes de plus de trois éléments sont exclues.
- **Cadence** : phrases voisines construites de façon comparable.
- **Charnières** : mots de liaison comme « mais », « et » ou « que ».

Une seule analyse est active à la fois. Cliquer à nouveau sur son nom la désactive. Le compteur indique le nombre de passages repérés ; la flèche descendante mène au suivant. Les couleurs et les critères d’analyse se règlent dans **Réglages → Finition**.

Dans **Réglages → Finition → Compteur du document**, choisir mots, signes, les deux ou masquer le compteur. Il apparaît à gauche de ♫ et suit le document entier ; les signes incluent les espaces. Au-delà de 1 000, les valeurs sont abrégées : 1K, 1,1K, 10K, 10,5K. Au survol du compteur, l’infobulle affiche toujours les deux totaux exacts, mots et signes, sans arrondi.

### Orthographe et ponctuation

Les trois fichiers du plugin (`main.js`, `manifest.json`, `styles.css`) doivent totaliser moins de 5 Mo ; la suite de vérification contrôle ce plafond. Les grands lexiques intégrés sont compressés comme données et décompressés par l’API native du navigateur.

Dans **Réglages → Finition → Corrections**, **Grammalecte** permet de charger ses données et de choisir **Classique** ou **Réforme 1990**. La même section contient le sélecteur **Correcteur neuronal par défaut**, vide avant installation, puis **CamemBERT**, installable depuis GitHub, et les modèles locaux. Les deux variantes Grammalecte partagent le même moteur et utilisent des dictionnaires différents ; changer de variante recharge le dictionnaire à la prochaine analyse. Les modèles neuronaux locaux apparaissent dans ce même sélecteur sous leur propre nom et sont listés avec description, lien éventuel et bouton **Effacer**. **Charger un modèle neuronal** importe un dossier conforme au [format neuronal Finition](doc/neural-model.md), par chemin ou sélecteur de dossiers, après vérification des empreintes ; seule la copie dans le plugin est utilisée. Les correcteurs locaux absents restent grisés ; **Tricolons** et **Structure** demandent un moteur linguistique installé. Chaque téléchargement provient des fichiers joints à la version du plugin sur GitHub ; tailles et empreintes sont vérifiées avant activation. Il contient uniquement des dictionnaires, poids, vocabulaires et notices. Tout le code de correction est livré avec le plugin ; aucun runtime n’est téléchargé ni installé. Les packs neuronaux de l’ancien format doivent être téléchargés à nouveau après mise à jour.

Dans la même section du menu ♫, **Grammalecte**, **Neuronal** et **Corrections IA** lancent directement le correcteur choisi. Les correcteurs locaux analysent la sélection, ou toute la note sans sélection. Neuronal active la correction contextuelle locale. Cliquer sur une faute pour la corriger, l’ignorer ou ajouter le mot au dictionnaire personnel. Un second clic sur le correcteur coché efface ses suggestions. La flèche de la barre d’état passe à la faute suivante. Grammalecte propose l’orthographe classique et les rectifications de 1990. Neuronal associe dictionnaire morphologique, accords simples, modèles neuronaux locaux et groupes phonétiques ; ce moteur reste expérimental. Choisir un modèle active les corrections contextuelles correspondantes, sans interrupteur supplémentaire.

**Correcteur neuronal par défaut** permet de choisir **CamemBERT**, pour les confusions lexicales en contexte, ou un modèle grammatical local par son nom, en complément de CamemBERT. **Charger un modèle neuronal** l’importe dans le stockage privé ignoré par Git ; **Effacer** supprime sa copie après confirmation. Le choix **CamemBERT** utilise le modèle public sans ce complément grammatical. Voir [la structure des modèles, leur installation et l’entraînement Python](doc/neural-model.md). Les ressources locales privées sont exclues des packs téléchargeables.

Les données publiques distribuées séparément du plugin sont regroupées dans [ressources/](ressources/README.md) : Grammalecte, dictionnaire Finition, CamemBERT et synonymes. Le code des moteurs reste livré dans `main.js`.

La commande **Ponctuations** modifie directement toute la note : espaces insécables, apostrophes, tirets et lignes vides. Le code, les liens et les horaires sont préservés.

### Synonymes

Après les réglages généraux, les sections sont ordonnées ainsi : **Corrections**, **Corrections IA**, **Synonymes**, **Définitions**, **Antonymes**, **Phonétique**, **Rimes**, **Répétitions**, **Cadence**, **Monotonie**, **Palette**. Elles sont toutes repliées par défaut ; cliquer sur leur titre pour les ouvrir. Les dictionnaires supplémentaires se règlent juste après Synonymes : choix du dictionnaire, import JSON, description et suppression de la copie. Les commandes correspondantes cherchent un seul mot sélectionné, hors ligne. Voir le [format des dictionnaires et les limites de la recherche de rimes](doc/dictionnaires.md).

Dans **Réglages → Finition → Synonymes**, le sélecteur **Dictionnaire** liste les dictionnaires disponibles et mémorise le choix actif ; la liste est vide avant toute installation. En dessous, une liste commune affiche **Finition** avec **Charger/Recharger** depuis GitHub, puis chaque dictionnaire personnel avec son propre bouton **Effacer**. Finition ne peut pas être effacé. Sous la liste, **Charger un dictionnaire** permet d’importer un JSON par son chemin ou, si le champ reste vide, avec le sélecteur de fichiers. Le lien **JSON au format Finition** ouvre le [format documenté](doc/synonymes.md) sur GitHub. Le champ `name` fournit le nom affiché ; les champs facultatifs `description` et `documentation` ajoutent une description et son lien sous le nom du dictionnaire. Les imports valides sont copiés dans `data/` à la racine du plugin ; la source reste intacte. Sélectionner un seul mot et choisir **Synonyme** dans ♫ ou la palette pour chercher hors ligne, remplacer la sélection ou copier la liste. Les données sont téléchargées séparément du plugin et conservent leurs licences libres respectives.

### Fonctions IA

Renseigner une clé API Anthropic ou OpenAI et choisir le modèle dans **Réglages → Finition**, puis sélectionner du texte :

- **Corrections IA** propose des corrections. Cliquer sur une proposition pour l’appliquer ; rien n’est remplacé sans validation.
- **Synonymes IA** propose une liste compacte de variantes. Cliquer sur un mot pour remplacer la sélection ; l’icône de copie copie toute la liste. **Synonyme** utilise la même présentation, organisée par catégorie, définition de sens et groupe lorsque ces informations sont disponibles. Les libellés sont en gras sur la même ligne que les synonymes ; les registres apparaissent en sous-listes indentées. L’affichage reste en HTML natif ; la copie conserve la hiérarchie en Markdown. Déplacer la fenêtre par son titre pour lire le texte en dessous.

Les consignes de Corrections IA sont personnalisables dans les réglages.

### Analyse de structure

Le réglage **Mode debug**, placé avant **Corrections**, affiche **Structure** dans le menu ♫ et la palette de commandes. Désactivé par défaut, il masque ces accès lorsqu’il est coupé. **Structure** utilise le moteur linguistique installé pour créer une note qui décrit chaque phrase : cadratifs, sujets, verbes, compléments et groupes de trois. L’original reste intact. Les analyses de structure et de tricolons peuvent manquer des passages ou en signaler à tort.

## Confidentialité

Les analyses, les moteurs de correction locaux, Synonyme et Ponctuations restent sur l’appareil. Une connexion sert uniquement au téléchargement initial des ressources linguistiques, déclenché dans les réglages ; aucune note n’est envoyée à GitHub. Les fonctions IA envoient du texte au fournisseur choisi, uniquement sur demande : la sélection pour Corrections IA, et le paragraphe de la sélection avec celui d’avant et celui d’après pour Synonymes IA, s’ils existent. Les clés API sont conservées dans les réglages du plugin. L’installation et les mises à jour passent par GitHub sans envoyer les notes.

Les boutons **Copier** écrivent uniquement les résultats affichés dans le presse-papiers, après un clic explicite. Finition ne lit jamais le contenu du presse-papiers. Les fichiers du coffre et les copies de dictionnaires sont gérés par l’API Obsidian ; un fichier extérieur n’est lu que lorsqu’il est choisi dans le sélecteur d’import.

## Développement

`main.ts` est le point d’entrée ; l’implémentation, les modules et les données embarquées sont regroupés dans `plugin/`. Les outils de développement, de préparation des ressources et de publication sont dans `helper/` ; `git.sh`, `install.sh` et `release.sh` restent à la racine. Les données publiques téléchargeables restent dans `ressources/`, l’entraînement Python dans `helper/neural/`, la documentation dans `doc/` et les fichiers privés dans le dossier ignoré par Git. `manifest.json`, `styles.css`, la licence et les configurations npm, TypeScript et ESLint restent à la racine.

```sh
npm install
npm run build
npm run lint
npx --no-install jiti helper/check-install.ts
npx --no-install jiti helper/check-structure.ts
npx --no-install jiti helper/check-synonym-dictionary.ts
PYTHONDONTWRITEBYTECODE=1 python3 helper/check-synonym-data.py
```
