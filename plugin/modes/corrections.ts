import type { GrammalecteError } from "./grammalecte";
import { markdownExclusionRanges, maskMarkdownExclusions } from "../markdown-tags";

export async function analyzeCorrections(engine: { parse(text: string, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> }, document: string, from: number, to: number, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> {
	const offset = from === to ? 0 : from;
	const protectedRanges = markdownExclusionRanges(document), masked = maskMarkdownExclusions(document, protectedRanges);
	const text = from === to ? masked : masked.slice(from, to);
	if (!text.trim()) return [];
	const shift = (errors: GrammalecteError[]) => errors.map(error => ({ ...error, nStart: error.nStart + offset, nEnd: error.nEnd + offset }))
		.filter(error => !protectedRanges.some(([start, end]) => error.nStart === error.nEnd ? error.nStart >= start && error.nStart <= end : error.nStart < end && error.nEnd > start));
	return shift(await engine.parse(text, onPartial ? errors => onPartial(shift(errors)) : undefined));
}
