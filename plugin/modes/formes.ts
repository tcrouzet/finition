import { FORM_TYPES, type FinitionSettings, type Highlight } from "../types";
import { linkRanges, mergeRanges } from "../markdown-links";
import { hashtagRanges } from "../markdown-tags";
import { sentenceRanges, trimRange } from "./clause-split";
import { maskMarkdown } from "./finition-corrector/markdown";

export function hasNegation(text: string): boolean {
	const words = text.toLowerCase().match(/[\p{L}\p{M}]+|[,;:.!?…]/gu) ?? [];
	const markers = new Set(["pas", "plus", "jamais", "guère", "point", "rien", "personne", "aucun", "aucune", "aucuns", "aucunes", "nul", "nulle", "nullement", "ni"]);
	let opening = false, precedingNegative = false;
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		if (/^[,;:.!?…]$/u.test(word)) { opening = false; precedingNegative = false; continue; }
		if (word === "ne" || word === "n") {
			if (precedingNegative) return true;
			opening = true;
			continue;
		}
		if (opening && markers.has(word) && !["un", "une", "le", "la", "du", "ce", "son"].includes(words[index - 1])) return true;
		if (["que", "qu", "qui", "dont", "où"].includes(word)) opening = false;
		if (["personne", "rien", "aucun", "aucune", "nul", "nulle", "ni"].includes(word) && !["la", "une", "cette"].includes(words[index - 1])) precedingNegative = true;
	}
	return /^(?:\s*[«“"—–]\s*)?(?:pas|jamais|plus)\s+(?:de|d[’']|du|des|un|une)\b/iu.test(text);
}

export function computeFormHighlights(text: string, settings: FinitionSettings): Highlight[] {
	const masked = maskMarkdown(text);
	let prose = "", cursor = 0;
	for (const [from, to] of mergeRanges([...linkRanges(text), ...hashtagRanges(text)])) {
		prose += masked.slice(cursor, from) + masked.slice(from, to).replace(/[^\r\n]/g, " ");
		cursor = to;
	}
	prose += masked.slice(cursor);
	const highlights: Highlight[] = [];
	for (const [start, end] of sentenceRanges(prose)) {
		const [from, to] = trimRange(prose, start, end);
		const sentence = prose.slice(from, to);
		if (!/\p{L}/u.test(sentence) || /^#{1,6}[ \t]/u.test(sentence)) continue;
		const types = FORM_TYPES.filter(type => {
			if (type.id === "negative") return hasNegation(sentence);
			if (type.id === "question") return sentence.includes("?");
			if (type.id === "exclamation") return sentence.includes("!");
			return /…|\.{3}/u.test(sentence);
		});
		if (!types.length) continue;
		// La ponctuation donne la couleur principale ; le survol conserve toutes les formes.
		const primary = types.find(type => type.id !== "negative") ?? types[0];
		highlights.push({ from, to, lemma: primary.id, colorIndex: settings[primary.key], title: types.map(type => type.label).join(" · ") });
	}
	return highlights;
}
