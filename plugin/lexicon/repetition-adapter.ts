import type { SharedDictionary } from "./shared";
import { synonymKey } from "../synonyms";

export function adaptRepetitions(dictionary: SharedDictionary): Map<string, string> {
	const lemmas = new Map<string, string>();
	for (const [form, lemma] of dictionary.entries) {
		const key = form.toLowerCase();
		if (!lemmas.has(key)) lemmas.set(key, lemma.toLowerCase());
	}
	for (const [form, lemma] of dictionary.lemmaOverrides ?? []) lemmas.set(form, lemma);
	return lemmas;
}

export function dictionaryLemmaVariants(dictionary: SharedDictionary, lemmas: Map<string, string>): Map<string, string[]> {
	const variants = new Map<string, Set<string>>();
	for (const [form, lemma] of dictionary.entries) {
		const key = synonymKey(form), value = synonymKey(lemma), canonical = lemmas.get(key);
		if (canonical && value === synonymKey(canonical)) continue;
		let values = variants.get(key);
		if (!values) { values = new Set(canonical ? [synonymKey(canonical)] : []); variants.set(key, values); }
		values.add(value);
	}
	return new Map([...variants].map(([form, values]) => [form, [...values]]));
}
