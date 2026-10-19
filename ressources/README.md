# Données publiques téléchargeables

`grammalecte/` contient les dictionnaires et données grammaticales. `camembert/` contient les poids publics CamemBERT, son vocabulaire, ses notices et le dictionnaire morphologique utilisé par le correcteur. Ce dernier sert à reconnaître les mots et leurs flexions ; il ne contient pas les définitions, antonymes ou rimes consultables. Les licences et provenances de ces données restent à conserver avec les packs.

La liste des fichiers effectivement distribués et les données partagées sont définies dans [linguistic-files.ts](../plugin/linguistic-files.ts). `npm run resources -- /chemin/de/destination` prépare les fichiers de téléchargement et leurs catalogues SHA-256 à partir de ce dossier. Les données supplémentaires de préparation ou de test ne sont pas ajoutées automatiquement aux packs.

`synonymes/` contient la fusion publique de myThes français et WOLF, leurs originaux, leurs provenances et leurs licences LGPL-2.1-or-later / CeCILL-C. Le pack téléchargeable contient le JSON fusionné et ses notices ; les originaux restent dans le dépôt pour le reproduire. Voir [le format JSON et la conversion](../doc/synonymes.md).

Les dictionnaires de définitions, antonymes, phonétique et rimes actuellement disponibles sont des imports privés : leurs JSON convertis restent dans `Antidote/dictionnaires/`, avec une copie active dans `data/dictionnaires-<kind>-<empreinte>/data.json`. Aucun pack public correspondant n’a encore été constitué dans `ressources/`. Voir [les dictionnaires locaux](../doc/dictionnaires.md).

Le code des moteurs reste intégré au plugin. Les modèles locaux ajoutés par l’utilisateur se trouvent dans `helper/neural/models/` et les ressources privées dans le dossier ignoré par Git ; aucun de ces dossiers ne fait partie des packs publics. Voir [le format des modèles](../doc/neural-model.md).
