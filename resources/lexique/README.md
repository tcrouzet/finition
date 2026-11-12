# Lexique commun

`finition-dictionnaire.json` est le dictionnaire public commun aux répétitions, stéréotypes, statistiques, à Grammalecte et au correcteur neuronal. Il contient les analyses fusionnées de Morphalou, Lexique et Grammalecte, ainsi que les index natifs nécessaires à ce dernier. Les formes personnelles et les poids neuronaux ne font pas partie de ce fichier.

Voir [le format, les adaptateurs et la préparation](../../doc/lexique.md). Les licences des sources figurent dans le JSON ; la MPL-2.0 est reproduite dans le fichier voisin. `npm run resources` prépare une seule pièce jointe `lexique-finition-dictionnaire.json`, référencée par le catalogue indépendant `lexique-resources.json` et ceux des deux moteurs.
