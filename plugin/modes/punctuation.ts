import { linkRanges, mergeRanges } from "../markdown-links";
import { markdownExclusionRanges } from "../markdown-tags";
import { SENTENCE_SEPARATOR_RE } from "./clause-split";
import { preserveNonbreakingSpaces } from "../ai/diff";
import units from "../data/units.json";

/**
 * Correction déterministe des espaces insécables et des tirets, selon le
 * code typographique français, en conservant les insécables de l’auteur.
 *
 * Règles implémentées :
 * 1. Espace insécable AVANT ! ? : ; » (double ponctuation).
 * 2. Espace insécable APRÈS «, espace normale avant « (non touchée).
 * 3. Tiret de dialogue en début de ligne : normalisé en em dash (—) suivi
 *    d'une espace insécable. On ne touche QUE les lignes qui commencent déjà
 *    par un tiret (– ou —), jamais un simple "-", pour ne jamais casser une
 *    liste à puces Markdown ("- item").
 * 4. Tirets intérieurs : demi-cadratins, avec une insécable après l'ouvrant
 *    et avant le fermant. La fin de phrase ferme l'incise. Un tiret fermant
 *    devant un point est supprimé.
 * 5. Apostrophes droites (') remplacées par des apostrophes typographiques (’).
 * 6. Jamais plus de deux sauts de ligne consécutifs (un pour finir le
 *    paragraphe, un pour le séparer du suivant) — SAUF entre deux entrées
 *    d'une liste (-, *, +, ou numérotée), où un seul saut de ligne est
 *    conservé (pas de ligne vide entre les entrées).
 * 7. Espace insécable entre un nombre et une unité présente dans le dictionnaire.
 *
 * Les zones suivantes sont protégées (jamais modifiées) : blocs de code
 * (```...```), code inline (`...`), liens Markdown [texte](url), liens
 * wiki [[note]], URLs, et horaires (10:30). Les blocs de code étant
 * remplacés par un jeton sans saut de ligne pendant la protection, leurs
 * lignes vides internes (significatives en code) ne sont jamais touchées
 * par la règle 6.
 */

// Les blocs de code doivent avoir leurs balises ``` SEULES en début de ligne
// (syntaxe Markdown standard) — sinon un simple ``` oublié quelque part dans
// la note pouvait apparier avec un ``` sans rapport bien plus loin, et
// avaler plusieurs paragraphes (et leurs sauts de ligne) comme "protégés",
// jamais corrigés par erreur.
const PROTECT_RE = /^[ \t]*```.*$[\s\S]*?^[ \t]*```[ \t]*$|`[^`\n]*`|\b\d{1,2}:\d{2}(?::\d{2})?\b/gm;

export function protectSpans(text: string): { text: string; restore: (s: string) => string } {
	const ranges = mergeRanges([...linkRanges(text), ...markdownExclusionRanges(text), ...[...text.matchAll(PROTECT_RE)].map(match => [match.index, match.index + match[0].length] as const)]);
	const stash: string[] = [];
	let prefix = "\uE000";
	while (text.includes(prefix)) prefix += "\uE000";
	let protectedText = "", cursor = 0;
	for (const [from, to] of ranges) {
		protectedText += text.slice(cursor, from) + `${prefix}${stash.length}\uE001`;
		stash.push(text.slice(from, to));
		cursor = to;
	}
	protectedText += text.slice(cursor);
	return { text: protectedText, restore: value => value.replace(new RegExp(`${prefix}(\\d+)\uE001`, "g"), (match, index: string) => stash[Number(index)] ?? match) };
}

function fixGuillemets(text: string): string {
	const openings: number[] = [];
	const nested = new Set<number>();
	for (const match of text.matchAll(/[«»]|\r?\n[^\S\r\n]*(?:\r?\n)+/g)) {
		if (match[0].includes("\n")) openings.length = 0;
		else if (match[0] === "«") openings.push(match.index);
		else {
			const opening = openings.pop();
			if (opening !== undefined && openings.length > 0) {
				nested.add(opening);
				nested.add(match.index);
			}
		}
	}
	return text.replace(/«[\u00A0\u202F \t]*|[\u00A0\u202F \t]*»/g, (mark: string, offset: number) => {
		const opening = mark.startsWith("«");
		if (nested.has(opening ? offset : offset + mark.length - 1)) return opening ? "“" : "”";
		return opening ? "«\u00A0" : mark;
	});
}

function fixDoublePunctuation(text: string): string {
	// Consomme toute espace existante (normale ou insécable) avant le signe
	// et la remplace par une seule espace insécable — idempotent.
	return text.replace(/[\u00A0\u202F \t]*([!?:;»])/g, "\u00A0$1");
}

function fixLineStartDashes(text: string): string {
	// Uniquement si la ligne commence déjà par un tiret moyen/long (– ou —) :
	// un simple "-" est laissé intact pour ne pas casser les listes Markdown.
	return text.replace(/^[ \t]*[–—][\u00A0\u202F \t]*/gm, "—\u00A0");
}

function fixInciseDashesInParagraph(paragraph: string): string {
	const separator = new RegExp(`[\\u00A0\\u202F \\t]*[–—][\\u00A0\\u202F \\t]*|${SENTENCE_SEPARATOR_RE.source}`, "gm");
	let result = "";
	let cursor = 0;
	let open = false;
	for (const match of paragraph.matchAll(separator)) {
		result += paragraph.slice(cursor, match.index);
		cursor = match.index + match[0].length;
		if (!/[–—]/u.test(match[0]) || match.index === 0 || paragraph[match.index - 1] === "\n") {
			open = false;
			result += match[0];
		} else if (/\d/u.test(paragraph[match.index - 1] ?? "") && /^\d/u.test(paragraph[cursor] ?? "")) {
			result += match[0].replace("—", "–");
		} else if (open) {
			if (paragraph[cursor] !== ".") {
				result += "\u00A0–";
				if (cursor < paragraph.length && !/[\r\n,;:!?…)\]»”]/u.test(paragraph[cursor])) result += " ";
			}
			open = false;
		} else {
			result += " –\u00A0";
			open = true;
		}
	}
	result += paragraph.slice(cursor);
	return result;
}

function fixInciseDashes(text: string): string {
	const parts = text.split(/(\r?\n[ \t]*(?:\r?\n)+)/);
	return parts.map((part, i) => (i % 2 === 1 ? part : fixInciseDashesInParagraph(part))).join("");
}

function fixApostrophes(text: string): string {
	return text.replace(/'/g, "’");
}

export function fixApostrophesProtected(text: string): string {
	const protectedText = protectSpans(text);
	return protectedText.restore(fixApostrophes(protectedText.text));
}

const unitPattern = (entries: string[], flags: string) => {
	const alternatives = [...entries].sort((a, b) => b.length - a.length)
		.map(unit => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	return new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_])(\\d+(?:[.,]\\d+)?(?:[eE][+-]?\\d+)?)[ \\t\\u00a0\\u202f]*(${alternatives})(?![\\p{L}\\p{M}\\p{N}_/²³’'-])`, flags);
};
const symbolUnits = unitPattern(units.symbols, "gu");
const namedUnits = unitPattern(units.names, "giu");

const LIST_ITEM_START_RE = /[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * Règle structurelle (sauts de ligne entre paragraphes) : appliquée à part,
 * sur le DOCUMENT ENTIER plutôt que sur la sélection (voir main.ts). Une
 * sélection de texte ne contient presque jamais les sauts de ligne qui
 * suivent un paragraphe, donc cette règle n'aurait aucun effet si elle
 * restait cantonnée à fixPunctuationSpacing comme les autres.
 */
export function fixBlankLines(text: string): string {
	// D'abord : une ligne "blanche" qui contient en fait des espaces, des
	// tabulations ou des espaces insécables résiduelles (invisibles à
	// l'œil, souvent issues d'un copier-coller) est vidée complètement —
	// une ligne vide doit être réellement vide (0 caractère). Sans cette
	// étape, une seule ligne "presque vide" entre deux paragraphes ne
	// déclenche jamais la règle suivante (qui ne réagit qu'à partir de 2
	// lignes vides consécutives), et reste donc jamais nettoyée.
	let result = text.replace(/^[ \t\u00A0]+$/gm, "");
	// Jamais plus de deux sauts de ligne consécutifs (= au plus une ligne
	// vide entre deux paragraphes).
	result = result.replace(/\n{3,}/g, "\n\n");
	// Entre deux entrées de liste séparées par une ou plusieurs lignes
	// vides, on les retire : une liste n'a qu'un saut de ligne entre ses
	// entrées. Le lookahead (non consommé) permet d'enchaîner plusieurs
	// entrées de suite en un seul passage.
	const betweenListItems = new RegExp(`^(${LIST_ITEM_START_RE.source}.*)\\n\\n+(?=${LIST_ITEM_START_RE.source})`, "gm");
	result = result.replace(betweenListItems, "$1\n");
	return result;
}

/** Règles de ponctuation inline (espaces, tirets, apostrophes), sur le texte passé tel quel (typiquement une sélection). */
export function fixPunctuationSpacing(text: string, replaceApostrophes = true): string {
	const { text: protectedText, restore } = protectSpans(text);
	let result = protectedText.replace(/\.{3,}/g, "…");
	result = fixGuillemets(result);
	result = fixDoublePunctuation(result);
	result = fixLineStartDashes(result);
	result = fixInciseDashes(result);
	if (replaceApostrophes) result = fixApostrophes(result);
	result = result.replace(symbolUnits, "$1$2\u00a0$3").replace(namedUnits, "$1$2\u00a0$3");
	return preserveNonbreakingSpaces(text, restore(result));
}

/** fixBlankLines, mais avec la même protection (blocs de code...) que fixPunctuationSpacing. */
export function fixBlankLinesProtected(text: string): string {
	const { text: protectedText, restore } = protectSpans(text);
	return restore(fixBlankLines(protectedText));
}
