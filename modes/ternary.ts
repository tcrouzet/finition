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
import { WORD_RE, clauseRanges, trimRange } from "./clause-split";

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

// Séparateur entre les trois groupes d'une séquence ternaire : virgule
// et/ou "et"/"ou"/"ni" (insensible à la casse).
const GROUP_SEPARATOR_RE = /\s*(?:,|\b(?:et|ou|ni)\b)\s*/gi;

/** Détecte les séquences ternaires et retourne leurs plages de caractères. */
export function ternaryCharRanges(text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (const [clauseStartRaw, clauseEndRaw] of clauseRanges(text)) {
		const clause = text.slice(clauseStartRaw, clauseEndRaw);
		if (!clause.includes(",")) continue; // court-circuit : pas de virgule, pas de ternaire possible
		const groups = clause.split(GROUP_SEPARATOR_RE);
		if (groups.length !== 3) continue;
		const signatures = groups.map(groupSignature);
		const [first, second, third] = signatures;
		if (second.length === 0 || !sameSignature(second, third)) continue;
		const suffix = first.slice(Math.max(0, first.length - second.length));
		if (!sameSignature(suffix, second)) continue;

		ranges.push(trimRange(text, clauseStartRaw, clauseEndRaw));
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
