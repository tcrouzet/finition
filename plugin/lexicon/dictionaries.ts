import type { DataAdapter } from "obsidian";
import { resourceHash, type LinguisticResources } from "../linguistic-resources";
import { isSynonymDocumentation, synonymFileLimit, type SynonymMetadata } from "../synonyms";
import { decodeDictionary, dictionaryFile } from "./shared";

export const lexiconDocumentation = "https://github.com/tcrouzet/finition/blob/main/doc/lexique.md";
export const publicLexiconMetadata = { name: "Finition", description: "Morphalou, Lexique et Grammalecte", documentation: lexiconDocumentation };
type StoredLexicon = SynonymMetadata & { path: string };
interface LexiconSettings { lexiconDictionaryPath: string; lexiconDictionaries: StoredLexicon[] }

export async function parseLexicon(raw: ArrayBuffer): Promise<SynonymMetadata> {
	if (!raw.byteLength || raw.byteLength > synonymFileLimit) throw new Error("Choisis un lexique JSON de 128 Mio maximum.");
	const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
	const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
	if (!value || typeof value !== "object" || !("version" in value) || value.version !== 2 || !("language" in value) || value.language !== "fr"
		|| !("name" in value) || !text(value.name, 100)) throw new Error("Choisis un lexique commun Finition version 2, avec ses index Grammalecte.");
	if ("description" in value && value.description !== "" && !text(value.description, 1000)) throw new Error("Remarque du lexique invalide.");
	if ("documentation" in value && value.documentation !== "" && !isSynonymDocumentation(value.documentation)) throw new Error("Lien du lexique invalide.");
	const dictionary = await decodeDictionary(value, "all", 256 * 1024 * 1024);
	if (!dictionary.entries.length) throw new Error("Le lexique ne contient aucune analyse forme–lemme.");
	return { name: value.name === "finition-dictionnaire" ? "Finition" : value.name,
		...("description" in value && value.description ? { description: value.description as string } : {}),
		...("documentation" in value && value.documentation ? { documentation: value.documentation as string } : {}) };
}

export class LexiconDictionaries {
	options: StoredLexicon[] = [];
	constructor(private adapter: DataAdapter, private directory: string, private settings: () => LexiconSettings, private save: () => Promise<void>, private resources: LinguisticResources) {}
	private owns(path: string): boolean {
		const prefix = `${this.directory}/data/lexique/imports/`;
		return path.startsWith(prefix) && /^[a-f0-9]{64}\.json$/u.test(path.slice(prefix.length));
	}
	get available(): boolean { return this.options.some(option => option.path === this.settings().lexiconDictionaryPath); }
	async refresh(): Promise<void> {
		const settings = this.settings(), seen = new Set<string>();
		if (typeof settings.lexiconDictionaryPath !== "string") settings.lexiconDictionaryPath = "";
		settings.lexiconDictionaries = (Array.isArray(settings.lexiconDictionaries) ? settings.lexiconDictionaries : []).filter(entry => {
			if (!entry || typeof entry.path !== "string" || !this.owns(entry.path) || seen.has(entry.path) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 100) return false;
			seen.add(entry.path); return true;
		}).map(entry => ({ path: entry.path, name: entry.name,
			...(typeof entry.description === "string" && entry.description.length <= 1000 ? { description: entry.description } : {}),
			...(isSynonymDocumentation(entry.documentation) ? { documentation: entry.documentation } : {}) }));
		const options: StoredLexicon[] = this.resources.available("lexique") ? [{ path: "", ...publicLexiconMetadata }] : [];
		for (const entry of settings.lexiconDictionaries) {
			try {
				const stat = await this.adapter.stat(entry.path);
				if (stat?.type === "file" && stat.size > 0 && stat.size <= synonymFileLimit) options.push(entry);
			} catch { /* Un lexique absent reste indisponible. */ }
		}
		this.options = options;
	}
	private async persist(path: string, entries = this.settings().lexiconDictionaries): Promise<void> {
		const settings = this.settings(), previous = { path: settings.lexiconDictionaryPath, entries: settings.lexiconDictionaries };
		settings.lexiconDictionaryPath = path; settings.lexiconDictionaries = entries;
		try { await this.save(); }
		catch (error) { settings.lexiconDictionaryPath = previous.path; settings.lexiconDictionaries = previous.entries; throw error; }
	}
	async select(path: string): Promise<void> {
		if (!this.options.some(option => option.path === path)) throw new Error("Lexique indisponible.");
		await this.persist(path);
	}
	async import(raw: ArrayBuffer): Promise<void> {
		const metadata = await parseLexicon(raw), hash = await resourceHash(raw);
		const root = `${this.directory}/data/lexique/imports`, path = `${root}/${hash}.json`;
		for (const folder of [`${this.directory}/data`, `${this.directory}/data/lexique`, root]) if (!await this.adapter.exists(folder)) await this.adapter.mkdir(folder);
		if (!await this.adapter.exists(path)) await this.adapter.writeBinary(path, raw);
		if (await resourceHash(await this.adapter.readBinary(path)) !== hash) throw new Error("Copie du lexique incomplète ou altérée.");
		await this.persist(path, [...this.settings().lexiconDictionaries.filter(entry => entry.path !== path), { path, ...metadata }]);
		await this.refresh();
	}
	async remove(path: string): Promise<void> {
		if (!this.owns(path) || !this.settings().lexiconDictionaries.some(entry => entry.path === path)) throw new Error("Sélectionne un lexique importé à effacer.");
		const previous = { path: this.settings().lexiconDictionaryPath, entries: this.settings().lexiconDictionaries };
		const fallback = this.resources.available("lexique") ? "" : this.options.find(option => option.path !== path)?.path ?? "";
		await this.persist(previous.path === path ? fallback : previous.path, previous.entries.filter(entry => entry.path !== path));
		try { await this.adapter.remove(path); }
		catch (error) { await this.persist(previous.path, previous.entries); throw error; }
		await this.refresh();
	}
	async read(): Promise<ArrayBuffer> {
		if (!this.available) throw new Error("Lexique sélectionné absent. Charge un lexique dans les réglages de Finition.");
		const path = this.settings().lexiconDictionaryPath;
		return path ? this.adapter.readBinary(path) : this.resources.read("lexique", dictionaryFile);
	}
}
