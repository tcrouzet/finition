/**
 * Mode "Stéréotypes" : détection d'expressions figées ("cœur s'emballer",
 * "serrer poings") par comparaison de séquences de lemmes contiguës, après
 * avoir retiré les mots-outils du flux de texte — exactement comme le fait
 * export_lemmas.py côté Python sur les motifs eux-mêmes. Sans ce filtrage
 * commun, un motif "cœur cogner dans poitrine" exigerait un calage mot à mot
 * strict avec le texte, qui insère toujours des mots-outils différents ou
 * des mots en plus ("son cœur cognait fort dans sa poitrine").
 *
 * Ces expressions sont fournies à l'infinitif mais apparaissent conjuguées
 * dans un texte réel, d'où la comparaison par lemme plutôt que par texte
 * littéral (voir modes/tokenize.ts pour la résolution de lemme). Mêmes
 * dictionnaire et mécanique de lemmatisation que le mode "répétitions".
 */

import { Highlight } from "../types";
import { tokenize } from "./tokenize";

/** Index de palette dédié aux stéréotypes (classe .finition-color-8 dans styles.css). */
const STEREOTYPE_COLOR_INDEX = 8;

/**
 * Détecte les occurrences des motifs de `patterns` (listes de lemmes de mots
 * pleins, générées hors-ligne par export_lemmas.py à partir de
 * stereotypes.txt) dans `text`. Les mots-outils (déterminants, prépositions,
 * pronoms, conjonctions...) sont retirés du flux de mots avant comparaison,
 * des deux côtés, pour tolérer les variations grammaticales du texte réel.
 * Les motifs les plus longs sont essayés en premier pour éviter qu'un motif
 * court masque une correspondance plus longue qui le contient.
 */
export function computeStereotypeHighlights(
	text: string,
	lexicon: Map<string, string>,
	functionWords: Set<string>,
	patterns: string[][]
): Highlight[] {
	if (patterns.length === 0) return [];
	const tokens = tokenize(text, lexicon).filter(
		(token) => !functionWords.has(token.form) && !functionWords.has(token.lemma)
	);
	const sortedPatterns = [...patterns].sort((a, b) => b.length - a.length);
	const highlights: Highlight[] = [];

	let index = 0;
	while (index < tokens.length) {
		const match = sortedPatterns.find((pattern) =>
			pattern.every((lemma, offset) => tokens[index + offset]?.lemma === lemma)
		);
		if (match) {
			const first = tokens[index];
			const last = tokens[index + match.length - 1];
			highlights.push({
				from: first.start,
				to: last.end,
				lemma: match.join(" "),
				colorIndex: STEREOTYPE_COLOR_INDEX,
			});
			index += match.length;
		} else {
			index += 1;
		}
	}
	return highlights;
}
