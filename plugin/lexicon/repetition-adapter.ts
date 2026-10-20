import type { SharedDictionary } from "./shared";

export function adaptRepetitions(dictionary: SharedDictionary): Map<string, string> {
	const lemmas = new Map<string, string>();
	for (const [form, lemma] of dictionary.entries) {
		const key = form.toLowerCase();
		if (!lemmas.has(key)) lemmas.set(key, lemma.toLowerCase());
	}
	for (const [form, lemma] of dictionary.lemmaOverrides ?? []) lemmas.set(form, lemma);
	return lemmas;
}
