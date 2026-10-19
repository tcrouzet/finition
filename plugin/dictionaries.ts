import type { DataAdapter } from "obsidian";
import { resourceHash } from "./linguistic-resources";
import { isSynonymDocumentation, isSynonymWord, personalSynonymPath, synonymFileLimit, synonymKey, type SynonymMetadata } from "./synonyms";

export const dictionaryKinds = ["definitions", "antonymes", "phonetique", "rimes"] as const;
export type DictionaryKind = typeof dictionaryKinds[number];
export const dictionaryLabels: Record<DictionaryKind, string> = { definitions: "Définitions", antonymes: "Antonymes", phonetique: "Phonétique", rimes: "Rimes" };
export const dictionaryDocumentation = "https://github.com/tcrouzet/finition/blob/main/doc/dictionnaires.md";
export interface DictionaryRow { label?: string; text?: string; examples?: string[]; words?: string[] }
export interface WordDictionary extends SynonymMetadata {
	format: "finition-dictionnaire"; version: 1; language: "fr"; kind: DictionaryKind;
	encoding?: "phonetic-internal";
	entries: Record<string, DictionaryRow[]>;
}
export interface StoredDictionary extends SynonymMetadata { kind: DictionaryKind; path: string }
export interface DictionarySettings { wordDictionaries: StoredDictionary[]; wordDictionaryPaths: Partial<Record<DictionaryKind, string>> }

export function parseWordDictionary(text: string, kind: DictionaryKind): WordDictionary {
	const fail = (): never => { throw new Error("Dictionnaire invalide ou incompatible avec cette section."); };
	const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
	const string = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !Array.from(v).some(c => c.charCodeAt(0) < 32);
	if (!text.length || text.length > synonymFileLimit) return fail();
	const value: unknown = JSON.parse(text);
	if (!object(value) || value.format !== "finition-dictionnaire" || value.version !== 1 || value.language !== "fr" || value.kind !== kind || !dictionaryKinds.includes(kind) || !string(value.name, 100) || !object(value.entries)) return fail();
	if (value.description !== undefined && value.description !== "" && !string(value.description, 1000)) return fail();
	if (value.documentation !== undefined && value.documentation !== "" && !isSynonymDocumentation(value.documentation)) return fail();
	if (value.encoding !== undefined && value.encoding !== "phonetic-internal") return fail();
	const entries = Object.entries(value.entries);
	if (!entries.length || entries.length > 1200000) return fail();
	for (const [word, rows] of entries) {
		if (word.length > 200 || !isSynonymWord(word) || synonymKey(word) !== word || !Array.isArray(rows) || !rows.length || rows.length > 2048) return fail();
		for (const row of rows) {
			if (!object(row) || (row.label !== undefined && !string(row.label, 1000)) || (row.text !== undefined && !string(row.text, 20000))) return fail();
			if (row.examples !== undefined && (!Array.isArray(row.examples) || row.examples.length > 256 || !row.examples.every(item => string(item, 10000)))) return fail();
			if (row.words !== undefined && (!Array.isArray(row.words) || !row.words.length || row.words.length > 2048 || !row.words.every(item => string(item, 200)))) return fail();
			if (kind === "definitions" && !row.text && (!Array.isArray(row.examples) || !row.examples.length)) return fail();
			if (kind === "phonetique" && !row.text) return fail();
			if (kind === "antonymes" && !row.words) return fail();
			if (kind === "rimes" && !row.text && !row.words) return fail();
		}
	}
	return value as unknown as WordDictionary;
}

export class WordDictionaries {
	options: StoredDictionary[] = [];
	private cached: { path: string; loading: Promise<WordDictionary> } | null = null;
	constructor(private adapter: DataAdapter, private directory: string, private settings: () => DictionarySettings, private save: () => Promise<void>) {}

	private owns(path: string, kind: DictionaryKind): boolean {
		const prefix = `${this.directory}/data/dictionnaires-${kind}-`;
		return path.startsWith(prefix) && /^[a-f0-9]{64}\/data\.json$/u.test(path.slice(prefix.length));
	}
	async refresh(): Promise<void> {
		const settings = this.settings();
		const seen = new Set<string>();
		settings.wordDictionaries = (Array.isArray(settings.wordDictionaries) ? settings.wordDictionaries : []).filter(entry => {
			if (!entry || !dictionaryKinds.includes(entry.kind) || typeof entry.path !== "string" || !this.owns(entry.path, entry.kind) || seen.has(entry.path) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 100) return false;
			seen.add(entry.path);
			return true;
		}).map(entry => ({ path: entry.path, kind: entry.kind, name: entry.name,
			...(typeof entry.description === "string" && entry.description.length <= 1000 ? { description: entry.description } : {}),
			...(isSynonymDocumentation(entry.documentation) ? { documentation: entry.documentation } : {}),
		}));
		const paths = settings.wordDictionaryPaths;
		settings.wordDictionaryPaths = Object.fromEntries(dictionaryKinds.flatMap(kind => paths && typeof paths[kind] === "string" && this.owns(paths[kind], kind) ? [[kind, paths[kind]]] : []));
		this.options = [];
		for (const entry of settings.wordDictionaries) {
			try {
				const stat = await this.adapter.stat(entry.path);
				if (stat?.type === "file" && stat.size > 0 && stat.size <= synonymFileLimit) this.options.push(entry);
			} catch { /* Un fichier absent reste indisponible. */ }
		}
	}
	has(kind: DictionaryKind): boolean { return this.options.some(entry => entry.kind === kind && entry.path === this.settings().wordDictionaryPaths[kind]); }
	private async persist(entries: StoredDictionary[], paths: DictionarySettings["wordDictionaryPaths"]): Promise<void> {
		const settings = this.settings(), previous = { entries: settings.wordDictionaries, paths: settings.wordDictionaryPaths };
		settings.wordDictionaries = entries;
		settings.wordDictionaryPaths = paths;
		try { await this.save(); }
		catch (error) { settings.wordDictionaries = previous.entries; settings.wordDictionaryPaths = previous.paths; throw error; }
		this.cached = null;
	}
	async select(kind: DictionaryKind, path: string): Promise<void> {
		await this.refresh();
		if (!this.options.some(entry => entry.kind === kind && entry.path === path)) throw new Error("Dictionnaire indisponible.");
		await this.persist(this.settings().wordDictionaries, { ...this.settings().wordDictionaryPaths, [kind]: path });
	}
	async import(kind: DictionaryKind, raw: ArrayBuffer): Promise<void> {
		if (!raw.byteLength || raw.byteLength > synonymFileLimit) throw new Error("Choisis un dictionnaire JSON de 128 Mio maximum.");
		const dictionary = parseWordDictionary(new TextDecoder("utf-8", { fatal: true }).decode(raw), kind);
		const hash = await resourceHash(raw);
		const root = `${this.directory}/data`, directory = `${root}/dictionnaires-${kind}-${hash}`, path = `${directory}/data.json`;
		if (!await this.adapter.exists(path)) {
			for (const folder of [root, directory]) if (!await this.adapter.exists(folder)) await this.adapter.mkdir(folder);
			await this.adapter.writeBinary(path, raw);
		}
		if (await resourceHash(await this.adapter.readBinary(path)) !== hash) throw new Error("Copie du dictionnaire incomplète ou altérée.");
		await this.persist([...this.settings().wordDictionaries.filter(entry => entry.path !== path), { path, kind, name: dictionary.name,
			...(dictionary.description ? { description: dictionary.description } : {}), ...(dictionary.documentation ? { documentation: dictionary.documentation } : {}),
		}], { ...this.settings().wordDictionaryPaths, [kind]: path });
		await this.refresh();
	}
	async importPath(kind: DictionaryKind, path: string): Promise<void> {
		path = personalSynonymPath(path);
		const stat = await this.adapter.stat(path);
		if (stat?.type !== "file" || stat.size < 1 || stat.size > synonymFileLimit) throw new Error("Choisis un dictionnaire JSON existant de 128 Mio maximum.");
		await this.import(kind, await this.adapter.readBinary(path));
	}
	async remove(kind: DictionaryKind, path: string): Promise<void> {
		if (!this.owns(path, kind) || !this.settings().wordDictionaries.some(entry => entry.kind === kind && entry.path === path)) throw new Error("Sélectionne un dictionnaire installé à effacer.");
		const previous = { entries: this.settings().wordDictionaries, paths: this.settings().wordDictionaryPaths };
		const paths = { ...previous.paths };
		if (paths[kind] === path) paths[kind] = this.options.find(entry => entry.kind === kind && entry.path !== path)?.path ?? "";
		await this.persist(previous.entries.filter(entry => entry.path !== path), paths);
		try { await this.adapter.remove(path); }
		catch (error) { await this.persist(previous.entries, previous.paths); throw error; }
		await this.refresh();
	}
	async lookup(kind: DictionaryKind, word: string): Promise<{ dictionary: WordDictionary; rows: DictionaryRow[] }> {
		if (!isSynonymWord(word)) throw new Error("Sélectionne un seul mot.");
		if (!this.has(kind)) throw new Error("Charge un dictionnaire dans les réglages de Finition.");
		const path = this.settings().wordDictionaryPaths[kind]!;
		if (this.cached?.path !== path) {
			const loading = this.adapter.readBinary(path).then(raw => {
				if (raw.byteLength > synonymFileLimit) throw new Error("Dictionnaire trop volumineux.");
				return parseWordDictionary(new TextDecoder("utf-8", { fatal: true }).decode(raw), kind);
			}).catch((error: unknown) => { if (this.cached?.path === path) this.cached = null; throw error; });
			this.cached = { path, loading };
		}
		const dictionary = await this.cached.loading;
		const key = synonymKey(word);
		const rows = Object.prototype.hasOwnProperty.call(dictionary.entries, key) ? dictionary.entries[key] : [];
		if (kind !== "rimes" || rows.some(row => row.words)) return { dictionary, rows };
		const endings = rows.flatMap(row => {
			const ending = row.text?.match(/[aàâeéèêëiîïoôöuûüyɑɛɔœøəɒɐɜɞɪʊɤɨɯʉɘɶɚɝ][^aàâeéèêëiîïoôöuûüyɑɛɔœøəɒɐɜɞɪʊɤɨɯʉɘɶɚɝ]*$/iu)?.[0];
			return ending ? [ending] : [];
		});
		if (!endings.length) return { dictionary, rows: [] };
		// shortcut: suffixes internes communs, remplacer par un classement de rimes vérifié quand disponible.
		const matches: Array<{ word: string; score: number }> = [];
		for (const candidate of Object.keys(dictionary.entries)) {
			if (candidate === key) continue;
			let score = 0;
			for (const row of dictionary.entries[candidate]) for (const ending of endings) {
				if (row.text?.endsWith(ending)) score = Math.max(score, ending.length);
			}
			if (score > 0) matches.push({ word: candidate, score });
		}
		matches.sort((a, b) => b.score - a.score || a.word.length - b.word.length || a.word.localeCompare(b.word, "fr"));
		return { dictionary, rows: matches.length ? [{ label: "Terminaisons phonétiques communes (200 résultats maximum)", words: matches.slice(0, 200).map(match => match.word) }] : [] };
	}
}
