import type { GrammalecteError } from "./grammalecte";

export async function analyzeCorrections(engine: { parse(text: string, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> }, document: string, from: number, to: number, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> {
	const offset = from === to ? 0 : from;
	const text = from === to ? document : document.slice(from, to);
	const shift = (errors: GrammalecteError[]) => errors.map(error => ({ ...error, nStart: error.nStart + offset, nEnd: error.nEnd + offset }));
	return shift(await engine.parse(text, onPartial ? errors => onPartial(shift(errors)) : undefined));
}
