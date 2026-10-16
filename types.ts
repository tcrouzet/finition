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
	debounceMs: number;
	maxDocumentLength: number; // garde-fou perf
	// Liste de mots-outils éditée par l'utilisateur, séparés par espace
	// et/ou virgule. Une fois définie (même vide), elle remplace
	// entièrement la liste chargée depuis data/function-words.json.
	customStopWords: string | null;
	// Mode "Burstiness" : nombre minimal de phrases consécutives de longueur
	// proche pour former une "série" repérable (voir modes/burstiness.ts).
	burstThreshold: number;
	// Tolérance de la loi de Weber-Fechner (marge perceptible = k·√longueur
	// moyenne) : plus k est grand, plus deux phrases de longueurs différentes
	// sont considérées "proches".
	burstToleranceK: number;
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
}

/** Valeurs de palette par défaut (16 pastel, reprises de palette.css au 16/10). */
export const DEFAULT_PALETTE: string[] = [
	"#d2edf7", // 0 — bleu pastel
	"#ebecec", // 1 — gris pastel
	"#c6ecc3", // 2 — vert pastel
	"#e6c9f2", // 3 — violet pastel
	"#fefda8", // 4 — jaune pastel
	"#f9e4bb", // 5 — pêche pastel
	"#f6a9c9", // 6 — rose pastel
	"#b1c7f3", // 7 — bleu-mauve pastel
	"#b6f3ed", // 8 — turquoise pastel
	"#f5e1a8", // 9 — doré pastel
	"#f5c3bb", // 10 — saumon pastel
	"#c1adde", // 11 — lavande pastel
	"#e8eec3", // 12 — olive pastel
	"#9ad8fb", // 13 — bleu ciel pastel
	"#c9daf2", // 14 — bleu clair pastel
	"#a8e6cf", // 15 — menthe pastel
];

export const DEFAULT_SETTINGS: FinitionSettings = {
	mode: "repetition",
	span: 1500,
	debounceMs: 300,
	maxDocumentLength: 200_000,
	customStopWords: null,
	burstThreshold: 3,
	burstToleranceK: 1.0,
	cadenceSpan: 500,
	hedgingColorIndex: 4,
	stereotypeColorIndex: 8,
	ternaryColorIndex: 3,
	hingeColorIndex: 9,
	palette: DEFAULT_PALETTE,
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
