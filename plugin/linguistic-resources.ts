import { requestUrl } from "obsidian";
import type { DataAdapter } from "obsidian";
import { resourceAssetName, resourceFiles, resourceSource, resourcePacks } from "./linguistic-files";
import type { ResourcePack } from "./linguistic-files";
import { grammarFiles } from "./linguistic-files";
import { dictionaryFile } from "./lexicon/shared";

interface ResourceManifest { version: 1 | 2; engine: ResourcePack; files: Array<{ path: string; bytes: number; sha256: string }> }
export const resourceHash = async (data: ArrayBuffer): Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(byte => byte.toString(16).padStart(2, "0")).join("");

export function parseResourceManifest(text: string, engine: ResourcePack): ResourceManifest {
	if (text.length > 32000) throw new Error("Catalogue de ressources trop volumineux.");
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object" || !("version" in value) || (value.version !== 1 && value.version !== 2) || !("engine" in value) || value.engine !== engine || !("files" in value) || !Array.isArray(value.files)) throw new Error("Catalogue de ressources invalide.");
	const legacy = value.version === 1;
	const expected = new Set(legacy && engine === "grammalecte" ? Object.values(grammarFiles) : resourceFiles[engine].filter(file => !(legacy && engine === "finition-corrector" && file === "MPL-2.0.txt")));
	const files: unknown[] = value.files;
	for (const file of files) {
		if (!file || typeof file !== "object" || !("path" in file) || typeof file.path !== "string" || !expected.delete(file.path) || !("bytes" in file) || typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 128 * 1024 * 1024 || !("sha256" in file) || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Fichier de ressources invalide.");
	}
	if (expected.size) throw new Error("Ressources incomplètes.");
	return value as ResourceManifest;
}

export class LinguisticResources {
	private installed = new Map<ResourcePack, string>();
	private downloading = new Map<ResourcePack, Promise<string>>();
	private dictionaries = new Map<ResourcePack, string>();
	private sharedDownloads = new Map<string, Promise<void>>();
	constructor(private adapter: DataAdapter, private directory: string, private version: string) {}
	available(engine: ResourcePack): boolean { return this.installed.has(engine); }
	private root(engine: ResourcePack, revision: string): string {
		if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Version de ressources invalide.");
		return `${this.directory}/data/resources/${engine}/${revision}`;
	}
	async refresh(revisions: Partial<Record<ResourcePack, string>>): Promise<void> {
		const installed = new Map<ResourcePack, string>();
		const dictionaries = new Map<ResourcePack, string>();
		let sharedSource: { root: string; dictionary: string } | undefined;
		for (const engine of resourcePacks) {
			const revision = revisions[engine];
			if (!revision) {
				const local = await Promise.all(resourceFiles[engine].map(async file => {
					try { return ((await this.adapter.stat(`${this.directory}/${resourceSource(engine, file)}`))?.size ?? 0) > 0; }
					catch { return false; }
				}));
				if (local.every(Boolean)) installed.set(engine, "local");
				continue;
			}
			for (const root of [this.root(engine, revision), `${this.directory}/resources/${engine}/${revision}`]) {
				try {
					const raw = await this.adapter.readBinary(`${root}/resources.json`);
					if (await resourceHash(raw) !== revision) continue;
					const manifest = parseResourceManifest(new TextDecoder().decode(raw), engine);
					const complete = await Promise.all(manifest.files.map(async file => {
						let path = `${root}/${file.path}`;
						if (file.path === dictionaryFile) {
							const shared = `${this.directory}/data/lexique/${file.sha256}.json`;
							if ((await this.adapter.stat(shared))?.size === file.bytes) path = shared;
							dictionaries.set(engine, path);
						}
						return (await this.adapter.stat(path))?.size === file.bytes;
					}));
					if (complete.every(Boolean)) {
						installed.set(engine, root);
						if (manifest.version === 2 && dictionaries.has(engine)) sharedSource = { root, dictionary: dictionaries.get(engine)! };
						break;
					}
				} catch { /* Une installation absente ou incomplète reste désactivée. */ }
			}
		}
		if (!installed.has("lexique") && sharedSource) {
			installed.set("lexique", sharedSource.root);
			dictionaries.set("lexique", sharedSource.dictionary);
		}
		this.installed = installed;
		this.dictionaries = dictionaries;
	}
	async read(engine: ResourcePack, file: string): Promise<ArrayBuffer> {
		const root = this.installed.get(engine);
		if (!root || (!resourceFiles[engine].includes(file) && !(engine === "grammalecte" && Object.values(grammarFiles).some(path => path === file)))) throw new Error("Ressources absentes. Téléchargez le moteur dans les paramètres de Finition.");
		if (root === "local") return this.adapter.readBinary(`${this.directory}/${resourceSource(engine, file)}`);
		if (file === dictionaryFile && this.dictionaries.has(engine)) return this.adapter.readBinary(this.dictionaries.get(engine)!);
		return this.adapter.readBinary(`${root}/${file}`);
	}
	install(engine: ResourcePack, progress: (text: string) => void, signal?: AbortSignal): Promise<string> {
		const running = this.downloading.get(engine);
		if (running) return running;
		const task = this.download(engine, progress, signal).finally(() => this.downloading.delete(engine));
		this.downloading.set(engine, task);
		return task;
	}
	private async download(engine: ResourcePack, progress: (text: string) => void, signal?: AbortSignal): Promise<string> {
		signal?.throwIfAborted();
		if (!/^\d+\.\d+\.\d+$/.test(this.version)) throw new Error("Version du plugin invalide.");
		const base = `https://github.com/tcrouzet/finition/releases/download/resources-${this.version}/`;
		const get = async (name: string) => {
			signal?.throwIfAborted();
			let abort = () => {};
			const aborted = new Promise<never>((_resolve, reject) => {
				abort = () => reject(new DOMException("Téléchargement annulé.", "AbortError"));
				signal?.addEventListener("abort", abort, { once: true });
			});
			try {
				const response = await Promise.race([requestUrl({ url: base + name, method: "GET", throw: false }), aborted]);
				signal?.throwIfAborted();
				if (response.status !== 200) throw new Error(`Téléchargement indisponible (HTTP ${response.status}). Vérifiez les ressources de la version ${this.version} sur GitHub.`);
				return response.arrayBuffer;
			} finally { signal?.removeEventListener("abort", abort); }
		};
		const raw = await get(`${engine}-resources.json`);
		const manifest = parseResourceManifest(new TextDecoder().decode(raw), engine);
		const revision = await resourceHash(raw);
		const root = this.root(engine, revision);
		const mkdir = async (path: string) => {
			const parts = path.split("/");
			for (let i = 1; i <= parts.length; i++) {
				const parent = parts.slice(0, i).join("/");
				if (!await this.adapter.exists(parent)) await this.adapter.mkdir(parent);
			}
		};
		for (const [index, file] of manifest.files.entries()) {
			signal?.throwIfAborted();
			progress(`${index + 1}/${manifest.files.length} — ${file.path}`);
			const destination = file.path === dictionaryFile ? `${this.directory}/data/lexique/${file.sha256}.json` : `${root}/${file.path}`;
			const pending = this.sharedDownloads.get(destination);
			if (pending) { await pending; continue; }
			const download = (async () => {
				if (await this.adapter.exists(destination)) {
					const existing = await this.adapter.readBinary(destination);
					if (existing.byteLength === file.bytes && await resourceHash(existing) === file.sha256) return;
				}
				const name = manifest.version === 1 && file.path === dictionaryFile ? `${engine}-${file.path}` : resourceAssetName(engine, file.path);
				const bytes = await get(name);
				if (bytes.byteLength !== file.bytes || await resourceHash(bytes) !== file.sha256) throw new Error(`Fichier incomplet ou altéré : ${file.path}`);
				await mkdir(destination.slice(0, destination.lastIndexOf("/")));
				signal?.throwIfAborted();
				await this.adapter.writeBinary(destination, bytes);
			})();
			if (file.path === dictionaryFile) this.sharedDownloads.set(destination, download);
			try { await download; }
			finally { this.sharedDownloads.delete(destination); }
		}
		signal?.throwIfAborted();
		const catalogue = `${root}/resources.json`;
		if (!await this.adapter.exists(catalogue) || await resourceHash(await this.adapter.readBinary(catalogue)) !== revision) await this.adapter.writeBinary(catalogue, raw);
		return revision;
	}
}
