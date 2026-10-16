/**
 * Types, réglages par défaut et petits utilitaires partagés entre
 * main.ts (orchestrateur), les modes d'analyse (modes/*.ts) et le moteur
 * de décoration CM6 (editor-extension.ts).
 *
 * Rien ici ne dépend d'Obsidian ni de CodeMirror : ce fichier ne contient
 * que des types et des fonctions pures, pour rester facile à tester et à
 * réutiliser.
 */

/**
 * Modes d'analyse, mutuellement exclusifs : un seul actif à la fois
 * (cumuler les surlignages rendrait le texte illisible et serait coûteux
 * à calculer en direct). "none" = aucun surlignage.
 */
export type FinitionMode = "none" | "repetition" | "hedging" | "stereotype" | "burstiness" | "ternary" | "cadence" | "hinges";

// Prompt par défaut d'Ortho-typo IA, édité directement dans ai/prompt-revision.md
// (pas en dur dans le code) — inliné comme texte au build par esbuild (voir
// esbuild.config.mjs, loader: { ".md": "text" }).
import DEFAULT_AI_PROMPT from "./ai/prompt-revision.md";

/** Nombre de classes de couleur disponibles dans styles.css (.finition-color-0 à -19). */
export const PALETTE_SIZE = 16;

export interface Highlight {
	from: number;
	to: number;
	lemma: string;
	colorIndex: number;
}

export interface FinitionSettings {
	mode: FinitionMode;
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
	// Index de couleur (0 à PALETTE_SIZE-1, cf. palette.css) utilisé par les
	// modes à couleur UNIQUE (pas de rotation ni de comparaison, contrairement
	// aux répétitions/burstiness/cadence) : réglable dans l'onglet Palette.
	hedgingColorIndex: number;
	stereotypeColorIndex: number;
	ternaryColorIndex: number;
	hingeColorIndex: number;
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
	// Taille maximale d'un tronçon envoyé à l'IA, en caractères (le texte est
	// découpé par paragraphes, comme dans le pipeline Python d'origine).
	aiChunkSize: number;
	aiMaxTokens: number;
	// Prompt système envoyé à l'IA, éditable sans toucher au code.
	aiPrompt: string;

	// --- Grammalecte (orthographe / grammaire) ------------------------------
	// Dictionnaire utilisé par le moteur orthographique : "fr-classic"
	// (orthographe traditionnelle) ou "fr-reform" (rectifications de 1990).
	// Fichiers correspondants dans data/grammalecte/_dictionaries/.
	grammalecteDictionary: "fr-classic" | "fr-reform";
	// Index dans settings.palette utilisé comme fond coloré derrière les
	// erreurs Grammalecte, en plus du soulignement ondulé rouge/bleu.
	grammalecteColorIndex: number;
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
	span: 1500,
	repetitionMinLength: 2,
	debounceMs: 300,
	maxDocumentLength: 200_000,
	customStopWords: null,
	burstThreshold: 3,
	burstTolerancePercent: 10,
	cadenceSpan: 500,
	hedgingColorIndex: 9, // jaune pastel (même couleur qu'avant, nouvel index)
	stereotypeColorIndex: 5, // turquoise pastel (même couleur qu'avant, nouvel index)
	ternaryColorIndex: 14, // violet pastel (même couleur qu'avant, nouvel index)
	hingeColorIndex: 2, // bleu clair pastel
	palette: DEFAULT_PALETTE,
	aiApiKey: "",
	aiModel: "claude-sonnet-5-5",
	aiChunkSize: 5000,
	aiMaxTokens: 8000,
	aiPrompt: DEFAULT_AI_PROMPT,
	grammalecteDictionary: "fr-classic",
	grammalecteColorIndex: 9,
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
 * Données et réglages nécessaires au calcul des décorations, sans dépendre
 * de la classe Plugin elle-même. Chaque mode (modes/*.ts) et le moteur de
 * décoration (editor-extension.ts) ne connaissent que cette interface,
 * jamais FinitionPlugin directement : ça évite les imports circulaires et
 * ça permet de tester un mode isolément.
 */
export interface FinitionRuntime {
	settings: FinitionSettings;
	lexicon: Map<string, string>;
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
}
