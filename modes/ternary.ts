/**
 * Mode "Ternaires" : repère les séquences de trois groupes parallèles,
 * séparés par une virgule et/ou "et"/"ou"/"ni", de même structure
 * grammaticale (port de `ternary_char_ranges()` dans
 * script/detector/syntax_depth.py côté unshiter).
 *
 * Contrairement à l'original Python, aucune analyse syntaxique spaCy n'est
 * disponible ici : le filtre annexe `_ternary_is_binary_qualification`
 * (qui écarte les cas où le 1er groupe n'est qu'un adjectif+adverbe
 * qualifiant les deux groupes suivants, ex. « grand et beau, intelligent »)
 * n'est pas porté. Quelques faux positifs supplémentaires sont donc
 * possibles sur ce cas précis — le reste de l'algorithme (comparaison de
 * "signature grammaticale" des groupes : déterminant / préposition /
 * pronom / relatif / auxiliaire / mot plein) est identique à l'original.
 */

import { Highlight } from "../types";

// Mot français, apostrophe comprise (pour repérer les élisions "l'", "d'",
// "qu'"...) et ligatures œ/æ comprises — même esprit que tokenize.ts, mais
// l'apostrophe reste ici DANS le mot (contrairement à tokenize.ts) car la
// signature grammaticale a besoin de voir le préfixe élidé ("l'", "d'"...).
const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+)?/g;

type Category = "DET" | "PREP" | "PRON" | "REL" | "AUX" | "WORD";

const DETERMINERS = new Set([
	"le", "la", "les", "un", "une", "des", "du", "ce", "cet", "cette", "ces",
	"mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
	"notre", "nos", "votre", "vos", "leur", "leurs",
]);
const PREPOSITIONS = new Set([
	"à", "de", "dans", "par", "pour", "en", "vers", "avec", "sans", "sous",
	"sur", "chez", "entre", "devant", "derrière",
]);
const PRONOUNS = new Set([
	"je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
	"me", "te", "se", "moi", "toi", "lui", "eux",
]);
const RELATIVES = new Set(["qui", "que", "quoi", "dont", "où", "lequel", "laquelle", "lesquels", "lesquelles"]);
const AUXILIARIES = new Set([
	"être", "avoir", "ai", "as", "a", "avons", "avez", "ont",
	"suis", "es", "est", "sommes", "êtes", "sont",
]);

/** Catégorie grammaticale d'un mot (éventuellement élidé : "l'", "qu'"...). */
function wordSignature(rawWord: string): Category[] {
	const word = rawWord.toLowerCase().replace(/’/g, "'");
	const result: Category[] = [];
	let body = word;
	const apostropheIndex = word.indexOf("'");
	if (apostropheIndex !== -1) {
		const prefix = word.slice(0, apostropheIndex);
		const remainder = word.slice(apostropheIndex + 1);
		if (remainder.length > 0) {
			if (prefix === "l") result.push("DET");
			else if (prefix === "d") result.push("PREP");
			else if (prefix === "j" || prefix === "m" || prefix === "t" || prefix === "s" || prefix === "n") result.push("PRON");
			else if (prefix === "qu") result.push("REL");
			body = remainder;
		}
	}
	if (DETERMINERS.has(body)) result.push("DET");
	else if (PREPOSITIONS.has(body)) result.push("PREP");
	else if (PRONOUNS.has(body)) result.push("PRON");
	else if (RELATIVES.has(body)) result.push("REL");
	else if (AUXILIARIES.has(body)) result.push("AUX");
	else result.push("WORD");
	return result;
}

/** Signature grammaticale complète d'un groupe (concaténation de ses mots). */
function groupSignature(group: string): Category[] {
	const signature: Category[] = [];
	WORD_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = WORD_RE.exec(group)) !== null) {
		signature.push(...wordSignature(match[0]));
	}
	return signature;
}

function sameSignature(a: Category[], b: Category[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Découpe `text[start:end)` selon `separator`, en conservant les positions. */
function splitRanges(text: string, start: number, end: number, separator: RegExp): Array<[number, number]> {
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
// d'un ternaire détecté plus loin pouvait déborder en arrière jusqu'à
// englober ce texte qui n'a pourtant rien à voir avec la séquence repérée.
const BLOCK_BREAK_RE = /\n[ \t]*\n+|(?:^|\n)[ \t]*#{1,6}[ \t][^\n]*(?:\n|$)/g;

// Fin de phrase : ".", "!", "?", "…", éventuellement suivi de guillemets
// fermants puis d'une espace (ou de la fin du segment), ou suivi d'un
// guillemet ouvrant.
const SENTENCE_SEPARATOR_RE = /(?<=[.!?…])(?:[»”"]*(?:\s+|$)|(?=[«“]))/;
// Bornes de proposition à l'intérieur d'une phrase.
const CLAUSE_SEPARATOR_RE = /[;:—–]/;
// Séparateur entre les trois groupes d'une séquence ternaire : virgule
// et/ou "et"/"ou"/"ni" (insensible à la casse).
const GROUP_SEPARATOR_RE = /\s*(?:,|\b(?:et|ou|ni)\b)\s*/gi;

/** Position de chaque groupe dans `text`, recherchés dans l'ordre à partir de `clauseStart`. */
function groupRanges(text: string, clauseStart: number, clauseEnd: number, groups: string[]): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let cursor = clauseStart;
	for (const group of groups) {
		const start = text.indexOf(group, cursor);
		const end = start === -1 ? -1 : start + group.length;
		ranges.push([start, end]);
		if (start !== -1 && end <= clauseEnd) cursor = end;
	}
	return ranges;
}

/** Détecte les séquences ternaires et retourne leurs plages de caractères. */
export function ternaryCharRanges(text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (const [blockStart, blockEnd] of splitRanges(text, 0, text.length, BLOCK_BREAK_RE)) {
		for (const [sentenceStart, sentenceEnd] of splitRanges(text, blockStart, blockEnd, SENTENCE_SEPARATOR_RE)) {
			for (const [clauseStartRaw, clauseEndRaw] of splitRanges(text, sentenceStart, sentenceEnd, CLAUSE_SEPARATOR_RE)) {
				const clause = text.slice(clauseStartRaw, clauseEndRaw);
				if (!clause.includes(",")) continue; // court-circuit : pas de virgule, pas de ternaire possible
				const groups = clause.split(GROUP_SEPARATOR_RE);
				if (groups.length !== 3) continue;
				const signatures = groups.map(groupSignature);
				const [first, second, third] = signatures;
				if (second.length === 0 || !sameSignature(second, third)) continue;
				const suffix = first.slice(Math.max(0, first.length - second.length));
				if (!sameSignature(suffix, second)) continue;

				let clauseStart = clauseStartRaw;
				let clauseEnd = clauseEndRaw;
				while (clauseStart < clauseEnd && /\s/.test(text[clauseStart])) clauseStart++;
				while (clauseEnd > clauseStart && /\s/.test(text[clauseEnd - 1])) clauseEnd--;
				ranges.push([clauseStart, clauseEnd]);
			}
		}
	}
	return ranges;
}

/** Point d'entrée pour editor-extension.ts : une séquence ternaire = un surlignage. */
export function computeTernaryHighlights(text: string): Highlight[] {
	return ternaryCharRanges(text).map(([from, to], index) => ({
		from,
		to,
		lemma: `ternary-${index}`,
		colorIndex: 0,
	}));
}
