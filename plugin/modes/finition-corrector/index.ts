import workerSource from "./worker.ts?worker";
import type { GrammalecteError } from "../grammalecte";
import { resourceFiles } from "../../linguistic-files";
import type { ReadNeuralAsset } from "./neural-assets";
import { maskMarkdown } from "./markdown";
import { specializedFiles } from "./neural-assets";

export class FinitionCorrectorEngine {
	neuralEnabled = false;
	specializedEnabled = true;
	constructor(private readonly readNeuralAsset?: ReadNeuralAsset, private readonly lexicalOnly = false) {}
	private worker: Worker | null = null;
	private lexicalWorkers: FinitionCorrectorEngine[] = [];
	private alternatives: Promise<Record<string, string[]>> | undefined;
	private sequence = 0;
	private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; onPartial?: (errors: GrammalecteError[]) => void }>();

	async parse(text: string, onPartial?: (errors: GrammalecteError[]) => void): Promise<GrammalecteError[]> {
		if (!this.neuralEnabled || this.lexicalOnly) return this.request(text) as Promise<GrammalecteError[]>;
		this.alternatives ??= this.request("", undefined, true).then(result => result as Record<string, string[]>).catch((error: unknown) => { this.alternatives = undefined; throw error; });
		const alternatives = this.alternatives;
		const base = this.request(text, undefined, false, onPartial) as Promise<GrammalecteError[]>;
		const lexical = alternatives.then(vocabulary => {
			if (this.alternatives !== alternatives) throw new Error("finition-corrector : moteur arrêté.");
			const masked = maskMarkdown(text);
			const paragraphs = [...masked.matchAll(/[^\r\n]+/g)];
			const candidates = [...masked.matchAll(/\p{L}[\p{L}\p{M}]*(?:[-'’][\p{L}\p{M}]+)*/gu)].filter(word => vocabulary[word[0].toLocaleLowerCase("fr")]?.length > 1).length;
			const count = Math.min(4, navigator.hardwareConcurrency || 2, Math.ceil(candidates / 96), paragraphs.length);
			if (!count) return [];
			const phonetics = new TextEncoder().encode(JSON.stringify({ alternatives: vocabulary }));
			const groups = Array.from({ length: count }, () => [] as Array<{ text: string; original: number; local: number }>);
			for (const [index, paragraph] of paragraphs.entries()) {
				const group = groups[index % count], previous = group.at(-1);
				group.push({ text: paragraph[0], original: paragraph.index, local: previous ? previous.local + previous.text.length + 1 : 0 });
			}
			return Promise.all(groups.map(async (group, index) => {
				const engine = this.lexicalWorkers[index] ??= new FinitionCorrectorEngine(file => file === "phonet_data.json" ? Promise.resolve(phonetics.buffer.slice(0)) : this.readNeuralAsset?.(file) ?? Promise.reject(new Error("Ressources du correcteur absentes.")), true);
				const errors = await engine.parse(group.map(paragraph => paragraph.text).join("\n"));
				let paragraph = 0;
				return errors.map(error => {
					while (paragraph + 1 < group.length && error.nStart >= group[paragraph + 1].local) paragraph++;
					const offset = group[paragraph].original - group[paragraph].local;
					return { ...error, nStart: error.nStart + offset, nEnd: error.nEnd + offset };
				});
			})).then(groups => groups.flat());
		});
		const [first, second] = await Promise.all([base, lexical]);
		const contextual = second.filter(item => !first.some(error => error.sRuleId.startsWith("neural.") && item.nStart < error.nEnd && item.nEnd > error.nStart));
		return [...first.filter(item => !contextual.some(error => item.nStart < error.nEnd && item.nEnd > error.nStart)), ...contextual]
			.sort((a, b) => a.nStart - b.nStart);
	}
	getCategories(words: string[]): Promise<Record<string, string>> {
		return this.request("", words) as Promise<Record<string, string>>;
	}
	private request(text: string, words?: string[], phonetics = false, onPartial?: (errors: GrammalecteError[]) => void): Promise<unknown> {
		if (!this.worker) {
			const offline = 'var process = undefined; globalThis.fetch = () => Promise.reject(new Error("Le correcteur fonctionne exclusivement hors ligne."));\n';
			const url = URL.createObjectURL(new Blob([offline, workerSource], { type: "application/javascript" }));
			try { this.worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
			const worker = this.worker;
			this.worker.onmessage = (event: MessageEvent<{ id: number; result: GrammalecteError[]; partial?: boolean; error?: string; asset?: string; assetId?: number }>) => {
				if (event.data.asset !== undefined) {
					const { asset, assetId } = event.data;
					void Promise.resolve().then(() => {
						if ((!resourceFiles["finition-corrector"].includes(asset) && !specializedFiles.includes(asset as typeof specializedFiles[number])) || !this.readNeuralAsset) throw new Error("Fichiers du correcteur local indisponibles.");
						return this.readNeuralAsset(asset);
					}).then(buffer => {
						if (this.worker === worker) worker.postMessage({ assetId, buffer }, [buffer]);
					}).catch((error: unknown) => {
						if (this.worker === worker) worker.postMessage({ assetId, error: error instanceof Error ? error.message : String(error) });
					});
					return;
				}
				const { id, result, error } = event.data;
				const request = this.pending.get(id);
				if (!request) return;
				if (event.data.partial) {
					try { request.onPartial?.(result); }
					catch (error) { this.pending.delete(id); request.reject(error instanceof Error ? error : new Error(String(error))); }
					return;
				}
				this.pending.delete(id);
				if (error) request.reject(new Error(error));
				else request.resolve(result);
			};
			this.worker.onerror = (event) => this.destroy(new Error(event.message || "finition-corrector : erreur du Worker."));
			this.worker.onmessageerror = () => this.destroy(new Error("finition-corrector : réponse illisible."));
		}
		const id = this.sequence++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, onPartial });
			try { this.worker!.postMessage({ id, text, words, phonetics, neural: this.neuralEnabled, specialized: this.specializedEnabled, lexicalOnly: this.lexicalOnly }); }
			catch (error) { this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
		});
	}

	destroy(error = new Error("finition-corrector : moteur arrêté.")): void {
		for (const engine of this.lexicalWorkers) engine.destroy(error);
		this.lexicalWorkers = [];
		this.alternatives = undefined;
		this.worker?.terminate();
		this.worker = null;
		for (const request of this.pending.values()) request.reject(error);
		this.pending.clear();
	}
}
