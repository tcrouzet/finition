import { wordKey } from "../modes/finition-corrector/lexicon";
import type { LexemeRow } from "../modes/finition-corrector/lexicon";
import type { SharedDictionary, Orthography } from "./shared";

export interface GraphspellDictionary {
	lookup(word: string): boolean;
	_morph(word: string): string[];
	getMorph(word: string): string[];
	suggest(word: string, limit?: number, splitTrailingNumbers?: boolean): string[];
}

const category: Record<string, string> = { nom: "N", adjectif: "A", adverbe: "W", préposition: "R", interjection: "J", nombre: "B" };
export function grammarMorphology(row: LexemeRow): string | undefined {
	const tag = Object.hasOwn(category, row[2]) ? category[row[2]] : undefined;
	// Les groupes verbaux et sous-types grammaticaux absents de Morphalou ne sont pas inventés.
	if (!tag) return undefined;
	return `>${row[1]}/:${[tag, row[3], row[4]].filter(Boolean).join(":")}`;
}

export function adaptGrammalecte<T extends GraphspellDictionary>(native: T, dictionary: SharedDictionary, variant: Orthography, personalForms: string[] = []): T {
	const mask = variant === "fr-classic" ? 1 : 2;
	const blocked = new Set(dictionary.variants?.filter(([, variants]) => !(variants & mask)).map(([form]) => wordKey(form)));
	const extra = new Map<string, string[]>(dictionary.extras);
	for (const row of dictionary.extras ? [] : dictionary.entries) {
		const form = row[0].normalize("NFC").replace(/’/g, "'");
		if (blocked.has(wordKey(form)) || native.lookup(form)) continue;
		const values = extra.get(form) ?? [];
		const morph = grammarMorphology(row);
		if (morph && !values.includes(morph)) values.push(morph);
		extra.set(form, values);
	}
	const forms = new Set([...dictionary.forms, ...personalForms].filter(form => !blocked.has(wordKey(form))).map(form => form.normalize("NFC").replace(/’/g, "'")));
	const adapter = Object.create(native) as T;
	adapter.lookup = word => native.lookup(word) || extra.has(word) || forms.has(word);
	adapter._morph = word => {
		const existing = native._morph(word);
		return existing.length ? existing : [...(extra.get(word) ?? [])];
	};
	adapter.suggest = (word, limit, splitTrailingNumbers) => native.suggest(word, limit, splitTrailingNumbers);
	return adapter;
}
