/** Mode "Répétitions lexicales" : détection par lemme sur une fenêtre glissante. */

import { Highlight, PALETTE_SIZE } from "../types";
import { tokenize } from "./tokenize";

// Un titre Markdown ("#", "##"...) n'est pas une phrase rédigée : un mot répété
// entre un titre et le corps du texte (ou entre deux titres) ne doit jamais être
// surligné. On neutralise les lignes de titre en les remplaçant par des espaces
// de même longueur, pour ne pas décaler les positions des mots restants.
const MARKDOWN_HEADING_RE = /^#{1,6}[ \t].*$/gm;
function blankMarkdownHeadings(text: string): string {
	return text.replace(MARKDOWN_HEADING_RE, (line) => " ".repeat(line.length));
}

/** Détecte les répétitions lexicales par lemme dans une fenêtre glissante de `span` caractères. */
export function computeRepetitions(
	text: string,
	lexicon: Map<string, string>,
	functionWords: Set<string>,
	span: number
): Highlight[] {
	// La tokenisation (découpage en mots + résolution de lemme, élisions
	// comprises) est partagée avec le mode "stéréotypes" : voir tokenize.ts.
	const tokens = tokenize(blankMarkdownHeadings(text), lexicon).filter(
		(token) => !functionWords.has(token.form) && !functionWords.has(token.lemma)
	);

	// Un mot est "répété" s'il partage son lemme avec une occurrence
	// précédente située à moins de `span` caractères.
	const repeatedIndexes = new Set<number>();
	const previousByLemma = new Map<string, number>();
	tokens.forEach((token, index) => {
		const previous = previousByLemma.get(token.lemma);
		if (previous !== undefined && token.start - tokens[previous].start <= span) {
			repeatedIndexes.add(previous);
			repeatedIndexes.add(index);
		}
		previousByLemma.set(token.lemma, index);
	});

	// Couleurs tournantes (golden angle, recyclées quand un groupe expire ;
	// tri naïf plutôt qu'un tas, les volumes en jeu dans un éditeur restent
	// faibles), mappées sur la palette fixe définie dans styles.css.
	const sortedIndexes = Array.from(repeatedIndexes).sort((a, b) => a - b);
	const active = new Map<string, { color: number; last: number }>();
	const freeColors: number[] = [];
	let nextColor = 0;
	const highlights: Highlight[] = [];

	const popMinFreeColor = (): number => {
		freeColors.sort((a, b) => a - b);
		return freeColors.shift() as number;
	};

	for (const index of sortedIndexes) {
		const token = tokens[index];
		for (const [key, value] of Array.from(active.entries())) {
			if (token.start - value.last > span) {
				freeColors.push(value.color);
				active.delete(key);
			}
		}
		let color: number;
		if (active.has(token.lemma)) {
			color = active.get(token.lemma)!.color;
		} else {
			color = freeColors.length > 0 ? popMinFreeColor() : nextColor++;
		}
		active.set(token.lemma, { color, last: token.start });
		highlights.push({ from: token.start, to: token.end, lemma: token.lemma, colorIndex: color % PALETTE_SIZE });
	}

	return highlights;
}
