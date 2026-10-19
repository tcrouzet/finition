/**
 * Découpage du texte en tronçons pour l'envoi à l'IA, par limite de
 * PARAGRAPHE uniquement : un paragraphe n'est jamais coupé en deux, même
 * s'il dépasse `maxSize` à lui seul (il forme alors son propre tronçon,
 * plus grand que la limite). Contrairement au script Python d'origine
 * (qui tronquait brutalement un paragraphe trop long), ici la cohérence du
 * texte prime toujours sur le respect strict de la taille.
 *
 * Chaque tronçon garde ses positions exactes (`start`/`end`) dans le texte
 * d'origine : la concaténation de tous les tronçons reconstitue le texte
 * intégral, offsets inclus — indispensable puisque le document n'est
 * jamais réécrit automatiquement (voir diff.ts) et que les corrections
 * validées doivent s'appliquer aux bonnes positions.
 */

export interface Chunk {
	text: string;
	start: number;
	end: number;
}

// Une "rupture de paragraphe" = une ou plusieurs lignes vides. Capturée pour
// rattacher la rupture au paragraphe qui la précède (le découpage par
// tranches [start, end) couvre alors tout le texte sans trou).
const PARAGRAPH_BREAK_RE = /\r?\n[ \t]*(?:\r?\n)+/g;

export function splitIntoChunks(text: string, maxSize: number): Chunk[] {
	if (text.length === 0) return [];

	const paragraphBounds: Array<[number, number]> = [];
	let cursor = 0;
	PARAGRAPH_BREAK_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = PARAGRAPH_BREAK_RE.exec(text)) !== null) {
		const breakEnd = match.index + match[0].length;
		paragraphBounds.push([cursor, breakEnd]);
		cursor = breakEnd;
	}
	paragraphBounds.push([cursor, text.length]);

	const chunks: Chunk[] = [];
	let chunkStart = 0;
	let chunkEnd = 0;
	for (const [pStart, pEnd] of paragraphBounds) {
		const candidateLength = pEnd - chunkStart;
		// On ferme le tronçon courant SEULEMENT s'il contient déjà du texte
		// (sinon un paragraphe isolé plus grand que maxSize resterait entier,
		// comme voulu) et que l'ajout de ce paragraphe dépasserait la limite.
		if (chunkEnd > chunkStart && candidateLength > maxSize) {
			chunks.push({ text: text.slice(chunkStart, chunkEnd), start: chunkStart, end: chunkEnd });
			chunkStart = pStart;
		}
		chunkEnd = pEnd;
	}
	if (chunkEnd > chunkStart) {
		chunks.push({ text: text.slice(chunkStart, chunkEnd), start: chunkStart, end: chunkEnd });
	}
	return chunks;
}
