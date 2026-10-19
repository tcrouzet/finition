import type { GrammalecteError } from "./grammalecte";
import { hashtagRanges, maskHashtags } from "../markdown-tags";

export async function analyzeCorrections(engine: { parse(text: string, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> }, document: string, from: number, to: number, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> {
	const offset = from === to ? 0 : from;
	const tags = hashtagRanges(document), masked = maskHashtags(document, tags);
	const text = from === to ? masked : masked.slice(from, to);
	if (!text.trim()) return [];
	const shift = (errors: GrammalecteError[]) => errors.map(error => ({ ...error, nStart: error.nStart + offset, nEnd: error.nEnd + offset }))
		.filter(error => !tags.some(([start, end]) => error.nStart < end && error.nEnd > start));
	return shift(await engine.parse(text, onPartial ? errors => onPartial(shift(errors)) : undefined));
}
