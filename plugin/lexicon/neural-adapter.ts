import { Lexicon, wordKey } from "../modes/finition-corrector/lexicon";
import type { SharedDictionary, Orthography } from "./shared";

export function adaptNeural(dictionary: SharedDictionary, personalForms: string[] = [], orthography?: Orthography): Lexicon {
	const mask = orthography === "fr-classic" ? 1 : 2;
	const blocked = new Set(orthography ? dictionary.variants?.filter(([, variants]) => !(variants & mask)).map(([form]) => wordKey(form)) : []);
	return new Lexicon(orthography ? dictionary.entries.filter(row => !blocked.has(wordKey(row[0]))) : dictionary.entries,
		[...dictionary.forms, ...personalForms].filter(form => !blocked.has(wordKey(form))));
}
