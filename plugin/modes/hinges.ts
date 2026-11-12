/**
 * Mode "Charnières" : surligne simplement, dans tout le texte, les mots
 * qui jouent un rôle de charnière syntaxique (liste dans
 * data/syntax-hinges.json, réutilisée par le mode Cadence : "qui", "que",
 * "comme", "et", "ou", "ni"...). Surligne uniquement les MOTS, jamais la
 * ponctuation (la virgule, par exemple, est aussi une charnière pour
 * Cadence, mais elle n'a rien à colorer ici). Une seule couleur pour
 * toutes les occurrences, pas de comparaison entre elles.
 */

import { Highlight } from "../types";

function escapeRegExp(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// \b en JS ne reconnaît que les lettres ASCII : "où" (accentué) ne
// matcherait jamais ses frontières avec \b. On utilise des lookarounds
// Unicode (\p{L}) à la place, qui gèrent correctement les lettres
// accentuées des deux côtés du mot.
function buildHingeRegex(hinges: string[]): RegExp | null {
	if (hinges.length === 0) return null;
	const alternatives = hinges.map(escapeRegExp).join("|");
	const pattern = "(^|[^\\p{L}\\p{N}_])(" + alternatives + ")(?![\\p{L}\\p{N}_])";
	return new RegExp(pattern, "giu");
}

/** Point d'entrée pour editor-extension.ts : chaque mot-charnière = un surlignage. */
export function computeHingeHighlights(text: string, hinges: string[]): Highlight[] {
	const regex = buildHingeRegex(hinges);
	if (!regex) return [];
	const highlights: Highlight[] = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const from = match.index + match[1].length;
		highlights.push({ from, to: from + match[2].length, lemma: match[2].toLowerCase(), colorIndex: 0 });
	}
	return highlights;
}
