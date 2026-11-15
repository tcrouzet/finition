import type { GrammalecteError } from "./grammalecte";
import { markdownExclusionRanges, maskMarkdownExclusions } from "../markdown-tags";
import { bracketEscapeRanges } from "../markdown-links";
import { preserveBracketEscapes } from "../ai/diff";

export async function analyzeCorrections(engine: { parse(text: string, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> }, document: string, from: number, to: number, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> {
	const offset = from === to ? 0 : from;
	const protectedRanges = markdownExclusionRanges(document), masked = maskMarkdownExclusions(document, protectedRanges);
	const text = from === to ? masked : masked.slice(from, to);
	if (!text.trim()) return [];
	const bracketEscapes = bracketEscapeRanges(document);
	const shift = (errors: GrammalecteError[]) => errors.map(error => ({ ...error, nStart: error.nStart + offset, nEnd: error.nEnd + offset }))
		.filter(error => !protectedRanges.some(([start, end]) => error.nStart === error.nEnd ? error.nStart >= start && error.nStart <= end : error.nStart < end && error.nEnd > start))
		.flatMap(error => {
			const escapes = bracketEscapes.filter(([start, end]) => error.nStart < end && error.nEnd > start);
			if (!escapes.length || !error.aSuggestions.length) return [error];
			const source = document.slice(error.nStart, error.nEnd);
			const tail = /^[[\]]/u.test(document.slice(error.nEnd, error.nEnd + 1)) ? document[error.nEnd] : "";
			const aSuggestions = [...new Set(error.aSuggestions.map(suggestion => {
				const preserved = preserveBracketEscapes(source + tail, suggestion + tail);
				return tail ? preserved.slice(0, -1) : preserved;
			}))].filter(suggestion => suggestion !== source);
			return aSuggestions.length ? [{ ...error, aSuggestions }] : [];
		});
	return shift(await engine.parse(text, onPartial ? errors => onPartial(shift(errors)) : undefined));
}
