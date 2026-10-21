/**
 * Types, réglages par défaut et petits utilitaires partagés entre
 * main.ts (orchestrateur), les modes d'analyse (modes/*.ts) et le moteur
 * de décoration CM6 (editor-extension.ts).
 *
 * Rien ici ne dépend d'Obsidian ni de CodeMirror : ce fichier ne contient
 * que des types et des fonctions pures, pour rester facile à tester et à
 * réutiliser.
 */

import type { SynonymMetadata } from "./synonyms";
import type { DictionaryKind, StoredDictionary } from "./dictionaries";
import AI_MODEL_PRESETS from "./ai/models.json";

/**
 * Modes d'analyse, mutuellement exclusifs : un seul actif à la fois
 * (cumuler les surlignages rendrait le texte illisible et serait coûteux
 * à calculer en direct). "none" = aucun surlignage.
 */
export type FinitionMode = "none" | "repetition" | "hedging" | "stereotype" | "burstiness" | "ternary" | "cadence" | "hinges" | "formes" | "copules" | "tic-ia";

export const FORM_TYPES = [
	{ id: "negative", key: "formNegativeColorIndex", label: "Négatives" },
	{ id: "question", key: "formQuestionColorIndex", label: "Interrogatives" },
	{ id: "exclamation", key: "formExclamationColorIndex", label: "Exclamatives" },
	{ id: "ellipsis", key: "formEllipsisColorIndex", label: "Points de suspension" },
] as const;

// Prompts "système" de Corrections IA, édités directement dans ai/prompt-*.md
// (pas en dur dans le code) — inlinés comme texte au build par esbuild (voir
// esbuild.config.mjs, loader: { ".md": "text" }). Chaque fichier commence par
// une ligne "name: Nom affiché dans le menu déroulant" suivie du prompt
// lui-même ; voir parsePromptFile() ci-dessous pour la séparation des deux
// (la ligne "name:" ne doit JAMAIS être envoyée à l'IA).
//
// Pour ajouter un nouveau prompt système : créer ai/prompt-xxx.md (en
// commençant par "name: ..."), l'importer ci-dessous, et l'ajouter au
// tableau BUILTIN_PROMPT_RAWS. Esbuild ne sachant pas importer un dossier
// entier par motif (pas de glob), cette liste doit être tenue à jour à la
// main — mais c'est la SEULE étape : tout le reste (menu déroulant,
// protection contre la suppression, réinjection si l'entrée a disparu de
// data.json) suit automatiquement depuis ce tableau.
import RAW_PROMPT_CORRECTIONS from "./ai/prompt-corrections.md";
import RAW_PROMPT_REVISION from "./ai/prompt-revision.md";
import type { ResourcePack } from "./linguistic-files";

const BUILTIN_PROMPT_RAWS: string[] = [
	RAW_PROMPT_CORRECTIONS, // premier de la liste = prompt actif par défaut
	RAW_PROMPT_REVISION,
];

export interface SavedPrompt {
	name: string;
	prompt: string;
	// Identifiant de modèle associé à CE prompt. Chaîne vide = pas de modèle
	// dédié : charger ce prompt laisse `aiModel` (le modèle par défaut)
	// inchangé.
	model: string;
	// Prompt fourni avec le plugin (ai/prompt-*.md) : non supprimable depuis
	// les réglages, et automatiquement réinjecté s'il venait à manquer de
	// data.json. Un prompt créé par l'utilisateur via "Enregistrer sous ce
	// nom" a toujours `builtin: false`.
	builtin: boolean;
}

/**
 * Sépare la ligne d'en-tête "name: ..." (nom affiché dans le menu déroulant
 * des prompts enregistrés) du corps du prompt réellement envoyé à l'IA.
 * Si la première ligne ne commence pas par "name:", tout le fichier est
 * considéré comme le corps et le nom de secours "Sans titre" est utilisé.
 */
function parsePromptFile(raw: string): SavedPrompt {
	const match = raw.match(/^name:\s*(.*)\r?\n/);
	if (!match) {
		return { name: "Sans titre", prompt: raw.trim(), model: "", builtin: true };
	}
	return { name: match[1].trim(), prompt: raw.slice(match[0].length).trim(), model: "", builtin: true };
}

/** Les prompts système, dans l'ordre de BUILTIN_PROMPT_RAWS (le premier est le défaut). */
export const BUILTIN_PROMPTS: SavedPrompt[] = BUILTIN_PROMPT_RAWS.map(parsePromptFile);

/** Nombre de classes de couleur disponibles dans styles.css (.finition-color-0 à -19). */
export const PALETTE_SIZE = 16;

export interface Highlight {
	from: number;
	to: number;
	lemma: string;
	colorIndex: number;
	title?: string;
}

export interface FinitionSettings {
	mode: FinitionMode;
	documentCountDisplay: "none" | "words" | "characters" | "both";
	hideBacklinksCount: boolean;
	debugMode: boolean;
	span: number; // empan de répétition, en caractères
	// Longueur minimale (en caractères) d'un mot pour être compté comme
	// répétition : un mot de longueur <= ce seuil n'est jamais surligné,
	// même répété (ex. "et", "ou", "si"...). Par défaut 2 : seuls les mots
	// d'au moins 3 lettres sont pris en compte.
	repetitionMinLength: number;
	debounceMs: number;
	maxDocumentLength: number; // garde-fou perf
	// Liste de mots-outils éditée par l'utilisateur, séparés par espace
	// et/ou virgule. Une fois définie (même vide), elle remplace
	// entièrement la liste chargée depuis data/function-words.json.
	customStopWords: string | null;
	// Mode "Monotonie" : nombre minimal de phrases consécutives de longueur
	// proche pour former une "série" repérable (voir modes/burstiness.ts).
	burstThreshold: number;
	// Tolérance en pourcentage de la longueur moyenne des deux phrases
	// comparées : deux phrases sont "proches" si leur écart (en mots) ne
	// dépasse pas ce pourcentage de leur longueur moyenne, avec un minimum
	// absolu d'1 mot (ex. 10 % par défaut : pour deux phrases de 10 mots,
	// 1 mot d'écart est toléré ; pour deux phrases de 30 mots, 3 mots).
	burstTolerancePercent: number;
	// Mode "Cadence" : empan de comparaison entre deux phrases, en
	// caractères — distinct de `span` (répétitions), car une structure
	// rythmique se perçoit sur une portée plus courte qu'une répétition de
	// lemme.
	cadenceSpan: number;
	// Moteur utilisé par Cadence pour regrouper les phrases :
	// - "fast" : heuristique historique, comparaison de longueurs de
	//   clauses délimitées par charnières syntaxiques (data/syntax-hinges.json).
	//   Synchrone, instantané, aucune dépendance externe.
	// - "grammalecte" : identifiant historique du mode syntaxique (SUJET/VERBE/
	//   COMPLÉMENT/PROPOSITION_SUBORDONNÉE...), portée de stats.py
	//   (projet unshiter), en s'appuyant sur les catégories grammaticales
	//   du moteur choisi dans Corrections. Asynchrone (requêtes au Worker) : les surlignages se complètent après un court délai
	//   plutôt qu'instantanément à chaque frappe.
	cadenceEngine: "fast" | "grammalecte";
	// Index de couleur (0 à PALETTE_SIZE-1, cf. palette.css) utilisé par les
	// modes à couleur UNIQUE (pas de rotation ni de comparaison, contrairement
	// aux répétitions/burstiness/cadence) : réglable dans l'onglet Palette.
	hedgingColorIndex: number;
	stereotypeColorIndex: number;
	ternaryColorIndex: number;
	hingeColorIndex: number;
	copuleColorIndex: number;
	formNegativeColorIndex: number;
	formQuestionColorIndex: number;
	formExclamationColorIndex: number;
	formEllipsisColorIndex: number;
	// La palette elle-même (PALETTE_SIZE couleurs hexadécimales), éditable
	// via un sélecteur de couleur natif dans les réglages — plus besoin de
	// toucher palette.css à la main. Appliquée en direct par main.ts via une
	// feuille de style injectée (voir applyPalette()).
	palette: string[];

	// --- Révision IA (Claude) ----------------------------------------------
	// Clé API Anthropic, stockée en clair dans data.json comme la quasi-
	// totalité des plugins IA de l'écosystème Obsidian (pas de coffre-fort
	// chiffré natif disponible pour un plugin tiers).
	aiApiKey: string;
	aiModel: string;
	localAIServer: string;
	localAIModel: string;
	// Taille maximale d'un tronçon envoyé à l'IA, en caractères (le texte est
	// découpé par paragraphes, comme dans le pipeline Python d'origine).
	aiChunkSize: number;
	aiMaxTokens: number;
	// Prompt système envoyé à l'IA, éditable sans toucher au code. C'est
	// toujours CE champ qui est réellement utilisé par les appels IA — les
	// prompts "enregistrés" (savedPrompts) ne sont qu'une bibliothèque dans
	// laquelle on peut (re)charger du contenu ici.
	aiPrompt: string;
	// Nom du prompt actuellement chargé dans aiPrompt, s'il correspond à une
	// entrée de savedPrompts (null = prompt par défaut ou modifié librement,
	// sans correspondance exacte avec une entrée nommée).
	activePromptName: string | null;
	// Bibliothèque de prompts nommés et sauvegardés par l'utilisateur, pour
	// pouvoir basculer rapidement entre plusieurs variantes (ex. "Sobre",
	// "Littéraire", "Journalistique"...) sans retaper le texte à chaque fois.
	// `model` : identifiant de modèle associé à CE prompt (ex. un prompt de
	// relecture fine avec un modèle plus puissant). Chaîne vide = pas de
	// modèle dédié : charger ce prompt laisse `aiModel` (le modèle par
	// défaut réglé plus bas) inchangé.
	savedPrompts: SavedPrompt[];
	// Clé API OpenAI, utilisée à la place d'Anthropic quand aiModel pointe
	// vers un modèle GPT (voir isOpenAIModel() dans ai/provider.ts). Un seul
	// champ "Modèle" au total : c'est le nom du modèle choisi qui détermine
	// quel fournisseur (et donc quelle clé) est utilisé.
	openaiApiKey: string;

	// --- Grammalecte (orthographe / grammaire) ------------------------------
	analysisEngine: "grammalecte" | "finition-corrector";
	spellingEngine: "grammalecte" | "finition-corrector";
	spellingNeural: boolean;
	neuralModel: string;
	resourcePacks: Partial<Record<ResourcePack, string>>;
	lexiconDictionaryPath: string;
	lexiconDictionaries: Array<SynonymMetadata & { path: string }>;
	synonymDictionaryPath: string;
	synonymDictionaries: Array<SynonymMetadata & { path: string }>;
	wordDictionaries: StoredDictionary[];
	wordDictionaryPaths: Partial<Record<DictionaryKind, string>>;
	// Dictionnaire utilisé par le moteur orthographique : "fr-classic"
	// (orthographe traditionnelle) ou "fr-reform" (rectifications de 1990).
	// Variantes du lexique commun, décrit dans doc/lexique.md.
	grammalecteDictionary: "fr-classic" | "fr-reform";
	// Index dans settings.palette utilisé comme fond coloré derrière les
	// erreurs Grammalecte, en plus du soulignement ondulé rouge/bleu.
	grammalecteColorIndex: number;
	// Dictionnaire personnel : mots que Grammalecte signale comme absents du
	// dictionnaire (noms propres, néologismes...) mais qu'on ne veut plus
	// voir soulignés. Même format que customStopWords (séparés par espace
	// et/ou virgule), rempli soit manuellement dans les réglages, soit via
	// le bouton "Ajouter au dictionnaire" du popup Grammalecte. Toujours une
	// chaîne (jamais null) : contrairement aux mots-outils, il n'y a pas de
	// liste par défaut à remplacer, juste une liste à compléter.
	grammalecteCustomDictionary: string;
}

/**
 * Valeurs de palette par défaut (16 pastel) : gris en premier, puis une
 * boucle continue sur le cercle chromatique — bleu → turquoise → vert →
 * jaune → orange → rouge/saumon → rose → violet → lavande — qui referme la
 * boucle juste avant de retomber sur le bleu de départ.
 */
export const DEFAULT_PALETTE: string[] = [
	"#ebecec", // 0 — gris pastel
	"#b1c7f3", // 1 — bleu-mauve pastel
	"#c9daf2", // 2 — bleu clair pastel
	"#9ad8fb", // 3 — bleu ciel pastel
	"#d2edf7", // 4 — bleu pastel
	"#b6f3ed", // 5 — turquoise pastel
	"#a8e6cf", // 6 — menthe pastel
	"#c6ecc3", // 7 — vert pastel
	"#e8eec3", // 8 — olive pastel
	"#fefda8", // 9 — jaune pastel
	"#f5e1a8", // 10 — doré pastel
	"#f9e4bb", // 11 — pêche pastel
	"#f5c3bb", // 12 — saumon pastel (rouge)
	"#f6a9c9", // 13 — rose pastel
	"#e6c9f2", // 14 — violet pastel
	"#c1adde", // 15 — lavande pastel
];

export const DEFAULT_SETTINGS: FinitionSettings = {
	mode: "repetition",
	documentCountDisplay: "none",
	hideBacklinksCount: false,
	debugMode: false,
	span: 1500,
	repetitionMinLength: 2,
	debounceMs: 300,
	maxDocumentLength: 200_000,
	customStopWords: null,
	burstThreshold: 3,
	burstTolerancePercent: 10,
	cadenceSpan: 500,
	cadenceEngine: "fast",
	hedgingColorIndex: 9, // jaune pastel (même couleur qu'avant, nouvel index)
	stereotypeColorIndex: 5, // turquoise pastel (même couleur qu'avant, nouvel index)
	ternaryColorIndex: 14, // violet pastel (même couleur qu'avant, nouvel index)
	hingeColorIndex: 2, // bleu clair pastel
	copuleColorIndex: 14,
	formNegativeColorIndex: 3,
	formQuestionColorIndex: 6,
	formExclamationColorIndex: 12,
	formEllipsisColorIndex: 15,
	palette: DEFAULT_PALETTE,
	aiApiKey: "",
	aiModel: AI_MODEL_PRESETS[0].value,
	localAIServer: "",
	localAIModel: "",
	aiChunkSize: 5000,
	aiMaxTokens: 8000,
	// Le premier prompt système (BUILTIN_PROMPT_RAWS[0], "Corrections") est
	// le prompt actif par défaut ; les autres (ex. "Révision stylistique")
	// restent disponibles dans la bibliothèque, sélectionnables dans le menu
	// déroulant des réglages.
	aiPrompt: BUILTIN_PROMPTS[0].prompt,
	activePromptName: BUILTIN_PROMPTS[0].name,
	savedPrompts: [...BUILTIN_PROMPTS],
	openaiApiKey: "",
	analysisEngine: "grammalecte",
	spellingEngine: "grammalecte",
	spellingNeural: false,
	neuralModel: "auto",
	resourcePacks: {},
	lexiconDictionaryPath: "",
	lexiconDictionaries: [],
	synonymDictionaryPath: "",
	synonymDictionaries: [],
	wordDictionaries: [],
	wordDictionaryPaths: {},
	grammalecteDictionary: "fr-classic",
	grammalecteColorIndex: 9,
	grammalecteCustomDictionary: "",
};

/** Découpe une liste saisie par l'utilisateur, séparée par espaces et/ou virgules. */
export function parseStopWords(raw: string): Set<string> {
	return new Set(
		raw
			.split(/[,\s]+/)
			.map((word) => word.trim().toLowerCase())
			.filter((word) => word.length > 0)
	);
}

/**
 * Découpe le dictionnaire personnel Grammalecte (même format que les
 * mots-outils : séparés par espace et/ou virgule). Comparaison toujours en
 * minuscules — un mot ajouté "Dupont" doit aussi couvrir "dupont" en début
 * de phrase, et inversement.
 */
export function parseGrammalecteDictionary(raw: string): Set<string> {
	return parseStopWords(raw);
}

/**
 * Ajoute un mot au dictionnaire personnel Grammalecte (chaîne brute telle
 * que stockée dans settings.grammalecteCustomDictionary), sans doublon
 * (comparaison insensible à la casse). Renvoie la chaîne inchangée si le mot
 * y figure déjà.
 */
export function addWordToDictionaryText(raw: string, word: string): string {
	const trimmedWord = word.trim();
	if (!trimmedWord) return raw;
	const existing = parseGrammalecteDictionary(raw);
	if (existing.has(trimmedWord.toLowerCase())) return raw;
	const trimmedRaw = raw.trim();
	return trimmedRaw.length > 0 ? `${trimmedRaw}, ${trimmedWord}` : trimmedWord;
}

/**
 * Données et réglages nécessaires au calcul des décorations, sans dépendre
 * de la classe Plugin elle-même. Chaque mode (modes/*.ts) et le moteur de
 * décoration (editor-extension.ts) ne connaissent que cette interface,
 * jamais FinitionPlugin directement : ça évite les imports circulaires et
 * ça permet de tester un mode isolément.
 */
export interface FinitionRuntime {
	updateAnalysisHighlights: (view: import("@codemirror/view").EditorView, highlights: Highlight[], pending: boolean) => void;
	updateTicIAStats: (view: import("@codemirror/view").EditorView, tagged: number, total: number, pending: boolean) => void;
	settings: FinitionSettings;
	lexicon: Map<string, string>;
	copuleLexicon: import("./modes/copules").CopuleLexicon;
	functionWords: Set<string>;
	hedgingPhrases: string[];
	// Motifs de stéréotypes : chaque entrée est une séquence de lemmes
	// (ex. ["serrer", "le", "poing"]), générée hors-ligne par
	// export_lemmas.py à partir de stereotypes.txt. Voir modes/stereotype.ts.
	stereotypePatterns: string[][];
	// Mots jouant le rôle de charnière syntaxique pour le mode "Cadence"
	// (ex. "qui", "que", "et"...), chargés depuis data/syntax-hinges.json.
	syntaxHinges: string[];
	settingsVersion: number;

	// --- Cadence, moteur "grammalecte" --------------------------------------
	// Cache des catégories grammaticales déjà résolues par Grammalecte
	// (clé = mot en minuscules, valeur = "nom"/"verbe"/"adjectif"/"adverbe"/
	// "pronom"/"préposition"/"déterminant"/"conjonction"/""). Rempli de façon
	// asynchrone : voir ensureWordCategories().
	wordCategoryCache: Map<string, string>;
	// Incrémenté CHAQUE FOIS que wordCategoryCache reçoit de nouvelles
	// entrées (voir ensureWordCategories()). Nécessaire car
	// refreshAllEditors() ne fait qu'un dispatch CM6 vide : sans ce
	// compteur, editor-extension.ts (qui ne recalcule que sur docChanged ou
	// changement de settingsVersion) ignorait ce rafraîchissement et gardait
	// un affichage calculé avec un cache encore incomplet, jusqu'au
	// prochain clic (qui recalcule, lui, inconditionnellement) — d'où des
	// résultats Tricolon/Cadence qui semblaient changer "tout seuls" ou ne
	// jamais se mettre à jour après une frappe.
	wordCategoryCacheVersion: number;
	// Demande (sans bloquer) la résolution des catégories grammaticales des
	// mots fournis qui ne sont pas encore dans wordCategoryCache. Une fois
	// résolus, rafraîchit tous les éditeurs ouverts pour appliquer le
	// regroupement Cadence avec les catégories désormais connues.
	ensureWordCategories: (words: string[]) => void;
}
