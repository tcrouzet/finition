/**
 * Découpage partagé par les modes "Ternaires" et "Cadence" : bloc (titre /
 * paragraphe) → phrase → clause, plus le motif de mot français utilisé par
 * les deux (apostrophe comprise, pour voir les élisions "l'", "d'"...).
 */

// Mot français, apostrophe comprise (pour repérer les élisions "l'", "d'",
// "qu'"...) et ligatures œ/æ comprises — même esprit que tokenize.ts, mais
// l'apostrophe reste ici DANS le mot (contrairement à tokenize.ts) car les
// deux modes ont besoin de voir le préfixe élidé ("l'", "d'"...).
export const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+)?/g;

/** Découpe `text[start:end)` selon `separator`, en conservant les positions. */
export function splitRanges(text: string, start: number, end: number, separator: RegExp): Array<[number, number]> {
	const slice = text.slice(start, end);
	const ranges: Array<[number, number]> = [];
	let cursor = start;
	const re = new RegExp(separator.source, separator.flags.includes("g") ? separator.flags : `${separator.flags}g`);
	re.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(slice)) !== null) {
		const matchStart = start + match.index;
		ranges.push([cursor, matchStart]);
		cursor = start + match.index + match[0].length;
		if (match[0].length === 0) re.lastIndex++; // garde-fou anti-boucle infinie
	}
	ranges.push([cursor, end]);
	return ranges;
}

// Frontière dure qu'aucune phrase/clause ne doit jamais traverser : saut de
// paragraphe (ligne vide) ou ligne de titre Markdown ("# ...", "## ..."),
// qui n'ont généralement pas de ponctuation finale. Une fin de paragraphe
// vaut une fin de phrase même sans point : sans cette règle, un texte sans
// ponctuation finale (titre, ligne isolée...) se retrouvait fusionné avec
// le paragraphe suivant dans une seule "phrase", et la plage surlignée
// d'une séquence détectée plus loin pouvait déborder en arrière jusqu'à
// englober ce texte qui n'a pourtant rien à voir avec elle.
export const BLOCK_BREAK_RE = /\n[ \t]*\n+|(?:^|\n)[ \t]*#{1,6}[ \t][^\n]*(?:\n|$)/g;

// Fin de phrase : ".", "!", "?", "…", éventuellement suivi de guillemets
// fermants puis d'une espace (ou de la fin du segment), ou suivi d'un
// guillemet ouvrant.
//
// Trois alternatives, dans cet ordre :
// 1. Un éventuel espace (insécable en typo française avant "»") puis UN OU
//    PLUSIEURS guillemets fermants puis une vraie frontière (espace ou fin) :
//    gère "Il dit : « Je pars. »" en avalant le guillemet fermant dans la
//    même frontière.
// 2. Une frontière normale (espace/fin), mais SEULEMENT s'il n'y a PAS de
//    guillemet fermant juste après (lookahead négatif) : sans ce garde-fou,
//    "« Manman ! », comme si..." coupait la phrase juste après "!", avant
//    même d'atteindre "»", laissant la réplique "coupée en deux" alors
//    qu'elle continue après le guillemet (bug remonté sur du texte réel).
// 3. Suivi direct d'un guillemet ouvrant (nouvelle réplique qui s'enchaîne).
export const SENTENCE_SEPARATOR_RE =
	/[.!?…](?:[ \u00A0\u202F]*[»”"]+(?:\s+|$)|(?!\s*[»”"])(?:\s+|$)|(?=[«“]))/;
// Bornes de proposition à l'intérieur d'une phrase.
export const CLAUSE_SEPARATOR_RE = /[;:—–]/;

function sentenceRangesWithin(text: string, start: number, end: number): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const slice = text.slice(start, end);
	const separator = new RegExp(SENTENCE_SEPARATOR_RE.source, "g");
	let cursor = start;
	let match: RegExpExecArray | null;
	while ((match = separator.exec(slice)) !== null) {
		ranges.push([cursor, start + match.index + match[0].trimEnd().length]);
		cursor = start + match.index + match[0].length;
	}
	ranges.push([cursor, end]);
	return ranges;
}

/** Plages de clauses (bloc → phrase → clause), utilisé par le mode Ternaires. */
export function clauseRanges(text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (const [blockStart, blockEnd] of splitRanges(text, 0, text.length, BLOCK_BREAK_RE)) {
		for (const [sentenceStart, sentenceEnd] of sentenceRangesWithin(text, blockStart, blockEnd)) {
			for (const clauseRange of splitRanges(text, sentenceStart, sentenceEnd, CLAUSE_SEPARATOR_RE)) {
				ranges.push(clauseRange);
			}
		}
	}
	return ranges;
}

/**
 * Plages de PHRASES ENTIÈRES (bloc → phrase), sans découpage sur ";:—–",
 * utilisé par le mode Cadence : un point-virgule, un deux-points ou un
 * tiret d'incise ne termine pas une phrase, seul un point (ou un saut de
 * paragraphe/titre) le fait.
 */
export function sentenceRanges(text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (const [blockStart, blockEnd] of splitRanges(text, 0, text.length, BLOCK_BREAK_RE)) {
		for (const sentenceRange of sentenceRangesWithin(text, blockStart, blockEnd)) {
			ranges.push(sentenceRange);
		}
	}
	return ranges;
}

/** Rogne les espaces en tête/queue d'une plage de caractères. */
export function trimRange(text: string, start: number, end: number): [number, number] {
	let trimmedStart = start;
	let trimmedEnd = end;
	while (trimmedStart < trimmedEnd && /\s/.test(text[trimmedStart])) trimmedStart++;
	while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1])) trimmedEnd--;
	return [trimmedStart, trimmedEnd];
}
