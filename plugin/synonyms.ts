export interface SynonymGroup {
	category: string; label: string; words: string[]; sources: string[];
	sense?: string;
	unmarked?: string[];
	registers?: Array<{ labels: string[]; words: string[] }>;
}
export interface SynonymMetadata {
	name: string; description?: string; documentation?: string;
}
export const synonymDocumentation = "https://github.com/tcrouzet/finition/blob/main/doc/synonymes.md";
export const finitionSynonymMetadata: SynonymMetadata = { name: "Finition", description: "myThes et WOLF", documentation: synonymDocumentation };
export interface SynonymDictionary extends SynonymMetadata {
	format: "finition-synonymes"; version: 1; language: "fr";
	sources: Array<{ id: string; name: string; license: string; url: string }>;
	groups: SynonymGroup[]; index: Record<string, number[]>;
}

export const synonymKey = (word: string): string => word.normalize("NFC").replace(/[’ʼ]/gu, "'").replace(/‑/gu, "-").toLocaleLowerCase("fr");
export const isSynonymWord = (word: string): boolean => /^\p{L}[\p{L}\p{M}]*(?:['’ʼ\-‑][\p{L}\p{M}]+)*$/u.test(word);
export interface DictionaryLemmas { lemmas: Map<string, string>; variants: Map<string, string[]> }
export const emptyDictionaryLemmas: DictionaryLemmas = { lemmas: new Map(), variants: new Map() };
export function dictionaryKeys(word: string, lexicon: DictionaryLemmas): string[] {
	const key = synonymKey(word);
	const lemmas = [lexicon.lemmas.get(key), ...(lexicon.variants.get(key) ?? [])].filter((value): value is string => Boolean(value));
	return [...new Set(lemmas.length ? lemmas.map(synonymKey) : [key])];
}
export const synonymFileLimit = 128 * 1024 * 1024;
function hasControl(text: string): boolean {
	for (const char of text) if (char.charCodeAt(0) < 32) return true;
	return false;
}
export function isSynonymDocumentation(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 2000 || hasControl(value)) return false;
	try { return ["http:", "https:"].includes(new URL(value).protocol); }
	catch { return false; }
}
export function personalSynonymPath(path: string): string {
	if (path && (path.startsWith("/") || /[\\:]/u.test(path) || hasControl(path) || path.split("/").some(part => !part || part === "." || part === "..") || !path.endsWith(".json"))) throw new Error("Indique un chemin JSON relatif au coffre.");
	return path;
}

export function parseSynonymDictionary(text: string): SynonymDictionary {
	const fail = (): never => { throw new Error("Dictionnaire de synonymes invalide ou incompatible."); };
	if (text.length > synonymFileLimit) fail();
	const value: unknown = JSON.parse(text);
	const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
	const string = (item: unknown, max: number, empty = false): item is string => typeof item === "string" && (empty || item.trim().length > 0) && item.length <= max && !hasControl(item);
	if (!object(value) || value.format !== "finition-synonymes" || value.version !== 1 || value.language !== "fr" || !string(value.name, 100) || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 100 || !Array.isArray(value.groups) || !value.groups.length || value.groups.length > 500000 || !object(value.index)) return fail();
	if (value.description !== undefined && !string(value.description, 1000, true)) return fail();
	if (value.documentation !== undefined && value.documentation !== "" && !isSynonymDocumentation(value.documentation)) return fail();
	const sources = new Set<string>();
	for (const source of value.sources) {
		if (!object(source) || !string(source.id, 64) || !/^[a-z0-9][a-z0-9-]*$/u.test(source.id) || sources.has(source.id) || !string(source.name, 200) || !string(source.license, 100) || !string(source.url, 2000, true)) return fail();
		sources.add(source.id);
	}
	for (const group of value.groups) {
		if (!object(group) || !string(group.category, 100, true) || !string(group.label, 1000, true) || !Array.isArray(group.words) || !group.words.length || group.words.length > 2048 || !group.words.every(word => string(word, 200)) || !Array.isArray(group.sources) || !group.sources.length || !group.sources.every(source => typeof source === "string" && sources.has(source))) return fail();
		if (group.sense !== undefined && !string(group.sense, 10000, true)) return fail();
		if (group.registers !== undefined || group.unmarked !== undefined) {
			const words = new Set(group.words.map(word => synonymKey(word)));
			if (group.unmarked !== undefined && (!Array.isArray(group.unmarked) || group.unmarked.length > 2048 || !group.unmarked.every(word => string(word, 200) && words.has(synonymKey(word))))) return fail();
			if (group.registers !== undefined && (!Array.isArray(group.registers) || group.registers.length > 2048)) return fail();
			for (const row of group.registers ?? []) {
				if (!object(row) || !Array.isArray(row.labels) || !row.labels.length || row.labels.length > 8 || !row.labels.every(label => string(label, 100)) || !Array.isArray(row.words) || !row.words.length || row.words.length > 2048 || !row.words.every(word => string(word, 200) && words.has(synonymKey(word)))) return fail();
			}
		}
	}
	const entries = Object.entries(value.index);
	const groups = value.groups;
	if (!entries.length || entries.length > 1200000) return fail();
	for (const [word, indexes] of entries) {
		if (word.length > 200 || !isSynonymWord(word) || synonymKey(word) !== word || !Array.isArray(indexes) || !indexes.length || indexes.length > 10000 || !indexes.every(index => typeof index === "number" && Number.isSafeInteger(index) && index >= 0 && index < groups.length)) return fail();
	}
	return value as unknown as SynonymDictionary;
}

export class SynonymsDictionary {
	private loading: Promise<SynonymDictionary> | null = null;
	constructor(private read: () => Promise<ArrayBuffer>, private readLemmas?: () => Promise<DictionaryLemmas>) {}
	async lookupGroups(word: string): Promise<SynonymGroup[]> {
		if (!isSynonymWord(word)) throw new Error("Sélectionne un seul mot.");
		const keys = dictionaryKeys(word, await this.readLemmas?.() ?? emptyDictionaryLemmas);
		this.loading ??= this.read().then(raw => {
			if (raw.byteLength > synonymFileLimit) throw new Error("Dictionnaire de synonymes trop volumineux.");
			return parseSynonymDictionary(new TextDecoder("utf-8", { fatal: true }).decode(raw));
		}).catch((error: unknown) => { this.loading = null; throw error; });
		const dictionary = await this.loading;
		const indexes = [...new Set(keys.flatMap(key => Object.prototype.hasOwnProperty.call(dictionary.index, key) ? dictionary.index[key] : []))];
		const priority = new Map(dictionary.sources.map((source, index) => [source.id, index]));
		const rank = (group: SynonymGroup) => Math.min(...group.sources.map(source => priority.get(source)!));
		const groups = indexes.map(index => dictionary.groups[index]).sort((left, right) => rank(left) - rank(right));
		const excluded = new Set([...keys, synonymKey(word)]);
		return groups.map(group => {
			const seen = new Set(excluded);
			const words = group.words.filter(candidate => {
				const key = synonymKey(candidate);
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
			const registers = group.registers?.map(row => ({ ...row, words: row.words.filter(word => !excluded.has(synonymKey(word))) })).filter(row => row.words.length);
			const unmarked = group.unmarked?.filter(word => !excluded.has(synonymKey(word)));
			return { ...group, words, ...(registers ? { registers } : {}), ...(unmarked ? { unmarked } : {}) };
		}).filter(group => group.words.length);
	}
	async lookup(word: string): Promise<string[]> {
		const seen = new Set<string>();
		return (await this.lookupGroups(word)).flatMap(group => group.words.filter(candidate => {
			const key = synonymKey(candidate);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}));
	}
}
