import type { DictionaryRow } from "../dictionaries";
import { decodeDictionary } from "../lexicon/shared";
import { wordKey } from "../modes/finition-corrector/lexicon";

export async function lookupFamily(read: () => Promise<ArrayBuffer>, word: string): Promise<DictionaryRow[]> {
	const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await read()));
	const { entries } = await decodeDictionary(value, "neural", 256 * 1024 * 1024);
	const key = wordKey(word), lemmas = new Set<string>();
	for (const row of entries) if (wordKey(row[0]) === key || wordKey(row[1]) === key) lemmas.add(wordKey(row[1]));
	const groups = new Map<string, { label: string; forms: Set<string> }>();
	for (const [form, lemma, category, gender, number, inflection] of entries) {
		const lemmaKey = wordKey(lemma);
		if (!lemmas.has(lemmaKey)) continue;
		let group = groups.get(lemmaKey);
		if (!group) { group = { label: lemma, forms: new Set() }; groups.set(lemmaKey, group); }
		const details = [category, gender, number, inflection].filter(Boolean).join(", ");
		group.forms.add(details ? `${form} — ${details}` : form);
	}
	return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, "fr"))
		.map(group => ({ label: group.label, examples: [...group.forms].sort((left, right) => left.localeCompare(right, "fr")) }));
}
