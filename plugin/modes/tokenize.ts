/**
 * Tokenisation partagée entre les modes "répétitions" et "stéréotypes" :
 * découpage en mots français + résolution de lemme via le dictionnaire
 * commun Finition, avec gestion correcte des élisions.
 */

import { linkRanges } from "../markdown-links";

export interface Token {
	start: number;
	end: number;
	form: string; // forme écrite, normalisée en minuscules
	lemma: string; // lemme résolu (ou la forme elle-même si inconnue du dictionnaire)
	segment: number;
}

// L'apostrophe (droite ' ou typographique ’) n'est volontairement PAS incluse
// dans le motif : elle marque une élision ("t'as", "c'est", "qu'il", "l'homme"),
// donc chaque côté de l'apostrophe doit être découpé en mot distinct.
// Le trait d'union reste accepté pour les mots composés ("peut-être", "grand-mère").
// Les ligatures "œ/Œ" et "æ/Æ" (U+0152, U+0153, U+00C6, U+00E6) sont hors de
// la plage À-ÖØ-öø-ÿ : sans elles, "cœur", "sœur", "œil", "bœuf"... étaient
// coupés en deux faux mots de part et d'autre de la ligature.
const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+(?:-[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+)*/g;

// Un résidu d'élision ("t'as" -> "t" + "as") n'est pas un mot en soi : on le
// résout directement vers le lemme de la forme pleine qu'il sous-entend,
// pour qu'il se comporte ensuite comme n'importe quel "le", "de", "que"...
// (filtré par les mots-outils en mode répétitions, reconnu tel quel dans un
// motif de stéréotype comme "l'estomac").
const ELISION_LEMMAS: Record<string, string> = {
	l: "le",
	d: "de",
	j: "je",
	m: "me",
	t: "te",
	s: "se",
	n: "ne",
	c: "ce",
	qu: "que",
	jusqu: "jusque",
	lorsqu: "lorsque",
	puisqu: "puisque",
	quoiqu: "quoique",
	presqu: "presque",
	entr: "entre",
	quelqu: "quelque",
};

/** Découpe `text` en mots et résout le lemme de chacun (élisions comprises). */
export function tokenize(text: string, lexicon: Map<string, string>): Token[] {
	const tokens: Token[] = [];
	const links = linkRanges(text);
	let segment = 0;
	WORD_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = WORD_RE.exec(text)) !== null) {
		while (segment < links.length && links[segment][1] <= match.index) segment++;
		if (segment < links.length && match.index + match[0].length > links[segment][0]) {
			WORD_RE.lastIndex = links[segment][1];
			continue;
		}
		const raw = match[0];
		const form = raw.toLowerCase();
		const lemma = ELISION_LEMMAS[form] ?? lexicon.get(form) ?? form;
		tokens.push({ start: match.index, end: match.index + raw.length, form, lemma, segment });
	}
	return tokens;
}
