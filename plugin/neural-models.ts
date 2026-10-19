import type { DataAdapter } from "obsidian";
import { resourceHash } from "./linguistic-resources";
import { specializedFiles } from "./modes/finition-corrector/neural-assets";
import { isSynonymDocumentation, type SynonymMetadata } from "./synonyms";

export const neuralDocumentation = "https://github.com/tcrouzet/finition/blob/main/doc/neural-model.md";
export const neuralFileLimit = 128 * 1024 * 1024;

export interface NeuralPack extends SynonymMetadata {
	version: 1;
	architecture: "finition-electra-v1";
	files: Array<{ path: string; bytes: number; sha256: string }>;
}

export function parseNeuralPack(text: string): NeuralPack {
	if (text.length > 16384) throw new Error("Catalogue neuronal trop volumineux.");
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("architecture" in value) || value.architecture !== "finition-electra-v1" || !("name" in value) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || !("files" in value) || !Array.isArray(value.files)) throw new Error("Format de modèle neuronal incompatible.");
	if (Array.from(value.name).some(char => char.charCodeAt(0) < 32)) throw new Error("Nom de modèle neuronal invalide.");
	if ("description" in value && (typeof value.description !== "string" || value.description.length > 1000 || Array.from(value.description).some(char => char.charCodeAt(0) < 32))) throw new Error("Description de modèle neuronal invalide.");
	if ("documentation" in value && value.documentation !== "" && !isSynonymDocumentation(value.documentation)) throw new Error("Lien de modèle neuronal invalide.");
	const expected = new Set<string>(specializedFiles);
	for (const file of value.files as unknown[]) {
		if (!file || typeof file !== "object" || !("path" in file) || typeof file.path !== "string" || !expected.delete(file.path) || !("bytes" in file) || typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > neuralFileLimit || !("sha256" in file) || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Fichier de modèle neuronal invalide.");
	}
	if (expected.size) throw new Error("Modèle neuronal incomplet.");
	return value as NeuralPack;
}

export class NeuralModels {
	private packs = new Map<string, NeuralPack>();
	constructor(private adapter: DataAdapter, private directory: string) {}
	get options(): Array<SynonymMetadata & { id: string }> { return [...this.packs].map(([id, pack]) => ({ id, name: pack.name, description: pack.description, documentation: pack.documentation })); }
	async refresh(): Promise<void> {
		const roots = ["Antidote/model"];
		for (const directory of ["scripts/neural/models", "helper/neural/models", "neural/models", "Antidote/models"]) {
			try {
				const root = `${this.directory}/${directory}`;
				const { folders } = await this.adapter.list(root);
				for (const folder of folders.sort()) {
					if (folder.startsWith(root + "/") && /^[a-zA-Z0-9_-]+$/.test(folder.slice(root.length + 1))) roots.push(folder.slice(this.directory.length + 1));
				}
			} catch { /* Aucun modèle ajouté localement. */ }
		}
		const packs = new Map<string, NeuralPack>();
		for (const id of roots) {
			try {
				const path = `${this.directory}/${id}`;
				if (((await this.adapter.stat(`${path}/pack.json`))?.size ?? Infinity) > 16384) continue;
				const pack = parseNeuralPack(await this.adapter.read(`${path}/pack.json`));
				if ((await Promise.all(pack.files.map(async file => (await this.adapter.stat(`${path}/${file.path}`))?.size === file.bytes))).every(Boolean)) packs.set(id, pack);
			} catch { /* Un pack absent ou invalide ne peut pas être sélectionné. */ }
		}
		this.packs = packs;
	}
	async import(read: (file: string) => Promise<ArrayBuffer>): Promise<string> {
		const raw = await read("pack.json");
		if (raw.byteLength > 16384) throw new Error("Catalogue neuronal trop volumineux.");
		const pack = parseNeuralPack(new TextDecoder("utf-8", { fatal: true }).decode(raw));
		const id = `Antidote/models/${await resourceHash(raw)}`;
		const destination = `${this.directory}/${id}`;
		const exists = await this.adapter.exists(`${destination}/pack.json`);
		if (!exists) for (const path of [`${this.directory}/Antidote`, `${this.directory}/Antidote/models`, destination, `${destination}/electra`]) {
			if (!await this.adapter.exists(path)) await this.adapter.mkdir(path);
		}
		for (const file of pack.files) {
			const bytes = await read(file.path);
			if (bytes.byteLength !== file.bytes || await resourceHash(bytes) !== file.sha256) throw new Error("Empreinte du modèle neuronal invalide.");
			const path = `${destination}/${file.path}`;
			if (!exists) await this.adapter.writeBinary(path, bytes);
			if (await resourceHash(await this.adapter.readBinary(path)) !== file.sha256) throw new Error("Copie du modèle neuronal altérée.");
		}
		if (!exists) await this.adapter.writeBinary(`${destination}/pack.json`, raw);
		await this.refresh();
		if (!this.packs.has(id)) throw new Error("Copie du modèle neuronal incomplète.");
		return id;
	}
	async remove(id: string): Promise<void> {
		if (!this.packs.has(id) || !(id === "Antidote/model" || /^(?:(?:scripts|helper)\/neural|neural|Antidote)\/models\/[a-zA-Z0-9_-]+$/u.test(id))) throw new Error("Sélectionne un modèle installé à effacer.");
		await this.adapter.rmdir(`${this.directory}/${id}`, true);
		await this.refresh();
	}
	reader(selection: string): ((file: string) => Promise<ArrayBuffer>) | undefined {
		const id = selection === "auto" ? this.packs.keys().next().value : selection;
		if (!id) return undefined;
		const pack = this.packs.get(id);
		if (!pack) throw new Error("Modèle neuronal sélectionné absent ou incompatible.");
		return async file => {
			const spec = pack.files.find(item => item.path === file);
			if (!spec) throw new Error("Fichier neuronal non autorisé.");
			const path = `${this.directory}/${id}/${file}`;
			if ((await this.adapter.stat(path))?.size !== spec.bytes) throw new Error("Fichier neuronal tronqué.");
			const bytes = await this.adapter.readBinary(path);
			if (bytes.byteLength !== spec.bytes || await resourceHash(bytes) !== spec.sha256) throw new Error("Empreinte du modèle neuronal invalide.");
			return bytes;
		};
	}
}
