/** Mode "Hedging épistémique" : locutions de prudence rhétorique (liste statique). */

import { Highlight } from "../types";

/** Index de palette dédié au hedging (classe .finition-color-4 dans styles.css). */
const HEDGING_COLOR_INDEX = 4;

/** Détecte les occurrences des locutions d'hedging épistémique (insensible à la casse). */
export function computeHedgingHighlights(text: string, phrases: string[]): Highlight[] {
	if (phrases.length === 0) return [];
	// Les locutions les plus longues d'abord, pour éviter qu'une locution
	// courte masque une correspondance plus longue qui la contient.
	const sorted = [...phrases].sort((a, b) => b.length - a.length);
	// Chaque apostrophe de la locution (droite ' ou typographique ’) doit matcher
	// les deux variantes dans le texte, sans normaliser le texte lui-même (on
	// garde les positions d'origine intactes pour le surlignage).
	const pattern = sorted
		.map((phrase) =>
			phrase
				.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
				.replace(/['’]/g, "['’]")
		)
		.join("|");
	const regex = new RegExp(pattern, "gi");
	const highlights: Highlight[] = [];
	const occupied: { from: number; to: number }[] = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const from = match.index;
		const to = from + match[0].length;
		if (occupied.some((range) => from < range.to && to > range.from)) continue;
		occupied.push({ from, to });
		highlights.push({ from, to, lemma: match[0].toLowerCase().replace(/'/g, "’"), colorIndex: HEDGING_COLOR_INDEX });
	}
	return highlights;
}
