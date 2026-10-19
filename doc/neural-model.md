# Modèles neuronaux locaux

Dans les paramètres de Finition, **Corrections** présente Grammalecte avec son choix **Classique** ou **Réforme 1990**. Cette même section contient **Correcteur neuronal par défaut**, vide avant installation, puis **CamemBERT** à charger depuis GitHub et les modèles grammaticaux locaux affichés sous leur nom. Le choix automatique existant affiche le nom du modèle réellement choisi. Sélectionner un modèle active ses corrections sans interrupteur supplémentaire. Les modèles grammaticaux utilisent les ressources communes de CamemBERT ; sans ces ressources, un modèle importé reste dans la liste mais ne peut pas être lancé.

Sous les ressources publiques, chaque modèle local affiche son `name`, sa `description` facultative et **Effacer**. Si `documentation` contient une URL HTTP ou HTTPS, la description devient cliquable ; sans description, le lien affiche **Documentation**. Sans URL, aucun lien n’est ajouté. Effacer demande confirmation et supprime uniquement le dossier de ce modèle dans le plugin. Si le modèle était actif, Finition revient à **CamemBERT**, sans modèle grammatical spécialisé.

## Installer un modèle

Sous la liste des modèles, **Charger un modèle neuronal** accepte le chemin du dossier ou de son `pack.json` dans le coffre. Un chemin absolu situé dans le coffre est aussi accepté. Si le champ reste vide, **Charger** ouvre le sélecteur de dossiers, utilisable pour un modèle situé ailleurs sur la machine. Le dossier doit contenir `pack.json` et les quatre fichiers de données listés ci-dessous. Finition vérifie leurs tailles et empreintes SHA-256 et les copie dans `Antidote/models/<empreinte-du-catalogue>/`, le stockage local privé déjà ignoré par Git ; la source reste intacte. Les autres fichiers du dossier source, notamment les checkpoints Python, ne sont pas importés. Un import incomplet ou altéré conserve le choix précédent. Réimporter le même catalogue ne crée pas de doublon. Les poids se chargent pour l’analyse seulement à la première utilisation ; l’import les lit pour contrôler leur intégrité. Changer de modèle arrête ses Workers et efface les suggestions précédentes.

L’ajout manuel dans `helper/neural/models/<identifiant>/` reste possible, avec un identifiant composé de lettres ASCII, chiffres, traits d’union ou tirets bas ; recharger le plugin pour redécouvrir ces dossiers.

Le dossier privé `Antidote/model/` suit le même format. Il est ignoré par Git, réservé aux ressources locales et exclu des packs de téléchargement. Le choix automatique existant utilise ce modèle privé s’il est présent, sinon le premier modèle compatible de `helper/neural/models/`, puis de `Antidote/models/`, triés par identifiant dans chaque dossier. Le choix **CamemBERT** désactive le complément grammatical spécialisé. Un modèle explicitement sélectionné puis retiré produit une erreur ; il n’est pas remplacé silencieusement.

Un dossier de modèle contient `pack.json`, `electra/model.json`, `electra/weights.bin`, `electra/tokenizer.json` et `electra/labels.json`. Le catalogue contient `version: 1`, `architecture: "finition-electra-v1"`, un `name` de 1 à 80 caractères et une liste `files`. Les champs facultatifs `description` (texte simple de 1000 caractères maximum) et `documentation` (URL HTTP ou HTTPS de 2000 caractères maximum) fournissent les métadonnées affichées ; les caractères de contrôle sont refusés. Chaque entrée contient `path`, `bytes` et `sha256`, une empreinte SHA-256 hexadécimale minuscule. Les quatre chemins de données sont imposés ; aucun script ou runtime ne peut être ajouté. Les tailles sont contrôlées pendant la découverte, puis les empreintes lors du chargement. Les checkpoints Python ne font pas partie de ce catalogue.

## Profil finition-electra-v1

Le format conserve l’architecture prise en charge par le moteur existant. Il ne transforme pas les poids d’une architecture différente. La définition TypeScript des tenseurs est `ModelData` dans [model.ts](../plugin/modes/finition-corrector/model.ts), avec `version: 1` et `kind: "electra"`.

L’encodeur possède un vocabulaire de 32005 entrées, des embeddings de largeur 128, 512 positions, 2 types de jetons, une projection vers 256 dimensions, 6 couches Transformer et 4 têtes d’attention. Le bloc intermédiaire possède 1024 dimensions et une activation GELU. Les normalisations utilisent leur epsilon enregistré dans `model.json`. Les positions commencent à zéro ; les types de jetons sont tous zéro. Les identifiants imposés sont `<pad>` = 1, `<unk>` = 3, `<s>` = 5 et `</s>` = 6. Les fenêtres grammaticales sont encadrées par 5 et 6 ; leur contenu comprend au plus 128 sous-jetons.

Chaque classifieur suit `Linear(256,128) → ReLU → Linear(128,128) → LayerNorm(128) → ReLU → Linear(128,n)`. Les sorties sont les suivantes :

| Nom | Classes | Interprétation |
| --- | ---: | --- |
| `VirguleManquanteGeneraleDevant` | 2 | `O`, puis virgule avant le mot |
| `MotsManquantsGeneralDevant` | 125 | `O`, puis mot ou élision à insérer avant le mot |
| `est` | 12 | `O`, puis graphies de la famille est/et |
| `ou` | 3 | `O`, puis graphies de la famille ou/où |
| `ces` | 5 | `O`, puis graphies de la famille ces/ses |

`labels.json` contient ces cinq listes, dans l’ordre exact des logits du modèle. L’index zéro désigne toujours `O`, aucune correction. La liste des virgules est exactement `["O", ","]`. Les classes textuelles et le tokenizer appartiennent au modèle ; entraîner un modèle exige ses propres données et annotations, pas les poids privés.

Les tenseurs de `weights.bin` sont décrits par `{offset, dims, type}` : offset en octets, dimensions en ordre ligne, type `f32`, `i8`, `u8` ou `i32`. Les nombres de plusieurs octets sont little-endian et alignés sur quatre octets. Une matrice dense utilise `[sorties, entrées]`, son biais `[sorties]`. Les embeddings indiquent une échelle et un zéro ; une valeur se décode par `(valeur - zéro) × échelle`. L’export Python écrit exclusivement du float32, sans quantification. Le lecteur conserve aussi les types du format historique ; il ne requantifie pas les poids privés.

## Entraîner un modèle indépendant

[helper/neural/train.py](../helper/neural/train.py) entraîne un nouveau modèle depuis une initialisation aléatoire, sans lire le modèle privé et sans téléchargement implicite. Il peut être exécuté sur une machine équipée de PyTorch, Transformers, Tokenizers, NumPy et Safetensors, y compris un environnement de calcul Hugging Face. Il utilise CUDA si disponible, sinon le CPU ; le chemin CUDA n’a pas été vérifié sur cette machine Mac. Python sert à l’entraînement et à l’export ; le plugin utilise uniquement les quatre fichiers de données et son moteur embarqué.

Préparer un tokenizer compatible de 32005 identifiants, ses cinq listes de classes et deux corpus JSONL distincts. Chaque ligne contient `input_ids`, une liste de 3 à 130 identifiants commençant par 5 et finissant par 6, et `labels`, un objet contenant les cinq listes d’indices de classes. Chaque liste a la longueur de `input_ids`. Utiliser `-100` pour les jetons ignorés, dont les deux bornes, `0` pour les positions correctes, et l’indice de la correction attendue aux positions fautives. Annoter le premier sous-jeton du mot, utilisé par l’affichage du correcteur ; ignorer ses autres sous-jetons. Inclure suffisamment de phrases correctes pour mesurer les faux positifs. Le script refuse les doublons et les séquences communes aux corpus d’entraînement et de validation.

Invocation avec des données à fournir, non exécutée comme entraînement de production :

```bash
python helper/neural/train.py --train corpus/train.jsonl --valid corpus/valid.jsonl --tokenizer corpus/tokenizer.json --labels corpus/labels.json --output helper/neural/models/mon-modele --name "Mon modèle" --epochs 3
```

Le dossier de sortie doit être nouveau. Le script affiche la perte de validation après chaque époque, puis écrit un pack sélectionnable et un checkpoint `training.safetensors`. La qualité d’un modèle nouvellement initialisé dépend du volume et de la qualité du corpus ; un entraînement court ne fournit pas un correcteur utilisable. Les seuils prudents de Finition restent ceux du moteur existant et doivent être évalués sur un corpus représentatif, notamment pour les faux positifs.

## Vérifier la compatibilité

`helper/neural/check.py` effectue un pas d’entraînement indépendant, vérifie les annotations et exporte les scores de référence PyTorch. Il reçoit le tokenizer, les classes et un nouveau dossier de sortie. `helper/check-trained-model.ts` recharge cet export dans le moteur TS et compare ses scores à la référence avec une tolérance absolue de 0,001. Ces contrôles prouvent le chargement et la fidélité numérique des exemples ; ils ne mesurent pas la qualité linguistique générale.

Le contrôle `helper/check-finition-model.ts` compare séparément les modèles locaux existants à leurs sources ONNX, sans modifier leurs fichiers. Le test navigateur `helper/check-tic-click.ts` couvre les changements de modèle, leur persistance, la désactivation, les fichiers altérés et l’exclusion des poids privés du catalogue public.
