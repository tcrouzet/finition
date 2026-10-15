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
export type FinitionMode = "none" | "repetition" | "hedging" | "stereotype" | "burstiness" | "ternary";

/** Nombre de classes de couleur disponibles dans styles.css (.finition-color-0 à -19). */
export const PALETTE_SIZE = 20;

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
}

export const DEFAULT_SETTINGS: FinitionSettings = {
	mode: "repetition",
	span: 1500,
	debounceMs: 300,
	maxDocumentLength: 200_000,
	customStopWords: null,
	burstThreshold: 3,
	burstToleranceK: 1.0,
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
	settingsVersion: number;
}
