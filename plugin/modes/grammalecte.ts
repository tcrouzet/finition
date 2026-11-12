/**
 * Grammalecte — orthographe et grammaire, moteur tiers (GPL 3) tournant
 * dans un Web Worker pour ne pas bloquer le thread principal.
 *
 * Le Worker utilise les scripts livrés avec le plugin. Ses dictionnaires
 * et données linguistiques sont lus dans les ressources installées.
 */

import { engineScripts } from "./grammalecte-resources";
import { grammarFiles } from "../linguistic-files";
import graphData from "../vendor/grammalecte/gc_rules_graph.js?gzip";
import { unpackData } from "../ui/compressed-data";
import { dictionaryFile, isSharedDictionary } from "../lexicon/shared";

export interface GrammalecteError {
	nStart: number;
	nEnd: number;
	sType: "orthographe" | "grammaire";
	sRuleId: string;
	sMessage: string;
	aSuggestions: string[];
	// Mot exact signalé, UNIQUEMENT pour les erreurs d'orthographe (mot
	// absent du dictionnaire) : c'est ce qu'on ajoute au dictionnaire
	// personnel via le bouton "Ajouter au dictionnaire" du popup. Absent
	// (undefined) pour les erreurs de grammaire, où la notion ne s'applique
	// pas (l'erreur porte sur un groupe de mots, pas un mot isolé).
	sValue?: string;
}

export class GrammalecteEngine {
	constructor(private readAsset: (file: string) => Promise<ArrayBuffer>, private readPersonal?: () => Promise<ArrayBuffer>) {}
	private worker: Worker | null = null;
	private initPromise: Promise<void> | null = null;
	private dictionary: "fr-classic" | "fr-reform" | null = null;
	private pendingResolvers = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private requestSeq = 0;
	private initializationSeq = 0;
	private sharedReady = false;

	/** Construit le Worker et le réinitialise si le dictionnaire change. */
	async ensureReady(dictionary: "fr-classic" | "fr-reform"): Promise<void> {
		if (this.dictionary === dictionary && this.initPromise) return this.initPromise;
		const switching = this.worker && this.sharedReady;
		if (!switching) this.destroy();
		else {
			for (const pending of this.pendingResolvers.values()) pending.reject(new Error("Grammalecte : initialisation remplacée."));
			this.pendingResolvers.clear();
		}
		this.dictionary = dictionary;
		const generation = ++this.initializationSeq;
		const operation = switching ? this.send("dictionary", { dictionary }).then(() => {}) : this.buildAndInit(dictionary);
		const init = operation.then(() => {
			if (generation !== this.initializationSeq) throw new Error("Grammalecte : initialisation remplacée.");
		}).catch((error: unknown) => {
			if (this.initPromise === init) this.destroy();
			throw error;
		});
		this.initPromise = init;
		return init;
	}

	private async buildAndInit(dictionary: "fr-classic" | "fr-reform"): Promise<void> {
		// 1. Concaténation du moteur + driver
		// Les fichiers Grammalecte testent `typeof(process) !== 'undefined'`
		// pour choisir entre un require() Node.js (chemins relatifs, qui
		// n'existent pas dans un Worker construit depuis un Blob) ou la
		// branche navigateur (variables globales déjà chargées par les
		// fichiers précédents dans ce même scope). Dans Electron/Obsidian,
		// `process` existe même dans un Worker — on le neutralise ici pour
		// forcer la branche navigateur, seule compatible avec notre
		// concaténation manuelle.
		const parts = ["var process = undefined;", ...engineScripts];
		const bigScript = parts.join("\n;\n");

		const blob = new Blob([bigScript], { type: "application/javascript" });
		const url = URL.createObjectURL(blob);
		try { this.worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
		const worker = this.worker;
		this.worker.onmessage = (e) => this.handleMessage(e);
		this.worker.onerror = (e) => {
			console.error("Finition — Grammalecte worker error:", e);
			// Sans ça, une erreur de script dans le Worker (ex. erreur de
			// syntaxe/évaluation lors du chargement du moteur) ne fait jamais
			// échouer les promesses en attente : l'appelant resterait bloqué
			// indéfiniment sur "chargement en cours" sans jamais voir d'erreur.
			const message = e.message || "Erreur inconnue dans le Worker Grammalecte (voir la console).";
			for (const pending of this.pendingResolvers.values()) {
				pending.reject(new Error(message));
			}
			this.pendingResolvers.clear();
		};

		// 2. Chargement des données nécessaires à l'init (dictionnaire + données linguistiques)
		const entries = await Promise.all(Object.entries(grammarFiles).filter(([, file]) => !file.startsWith("_dictionaries/")).map(async ([key, file]) => [key, new TextDecoder().decode(await this.readAsset(file))]));
		const grammarData = Object.fromEntries(entries) as Record<keyof typeof grammarFiles, string>;
		let dictionaryBytes: ArrayBuffer;
		try { dictionaryBytes = await this.readAsset(dictionaryFile); }
		catch { dictionaryBytes = await this.readAsset(dictionary === "fr-reform" ? grammarFiles.reform : grammarFiles.classic); }
		const dictionaryData: unknown = JSON.parse(new TextDecoder().decode(dictionaryBytes));
		const personal = this.readPersonal ? new TextDecoder().decode(await this.readPersonal()) : undefined;
		const oGraphData = await unpackData(graphData);
		if (this.worker !== worker) throw new Error("Grammalecte : initialisation remplacée.");
		await this.send("init", {
			oDictionary: dictionaryData,
			oOrthography: dictionary,
			sPersonalData: personal,
			oGraphData,
			sConjData: grammarData.conjugations,
			sPhonetData: grammarData.phonetics,
			sMfspData: grammarData.plurals,
			sThes1Data: grammarData.thesaurus1,
			sThes2Data: grammarData.thesaurus2,
		});
		this.sharedReady = isSharedDictionary(dictionaryData);
	}

	async parse(text: string): Promise<GrammalecteError[]> {
		if (!this.worker) throw new Error("Grammalecte : moteur non initialisé.");
		const result = await this.send("parse", { sText: text });
		return result as GrammalecteError[];
	}

	/**
	 * Résout la catégorie grammaticale (nom/verbe/adjectif/adverbe/pronom/
	 * préposition/déterminant/conjonction, ou "" si inconnue) d'une liste de
	 * mots. Utilisé par Cadence (mode "grammalecte") pour construire des
	 * signatures syntaxiques de phrases — voir modes/structure-signature.ts.
	 */
	async getCategories(words: string[]): Promise<Record<string, string>> {
		if (!this.worker) throw new Error("Grammalecte : moteur non initialisé.");
		const result = await this.send("lexicalCategories", { words });
		return result as Record<string, string>;
	}

	private send(sCommand: string, oParam: unknown): Promise<unknown> {
		if (!this.worker) return Promise.reject(new Error("Worker absent."));
		const id = String(this.requestSeq++);
		return new Promise((resolve, reject) => {
			this.pendingResolvers.set(id, { resolve, reject });
			this.worker!.postMessage({ id, sCommand, oParam });
		});
	}

	private handleMessage(e: MessageEvent): void {
		const { id, result, bError } = e.data as { id: string; result: unknown; bError: boolean };
		const pending = this.pendingResolvers.get(id);
		if (!pending) return;
		this.pendingResolvers.delete(id);
		if (bError) {
			pending.reject(new Error(typeof result === "string" ? result : "Erreur Grammalecte inconnue."));
		} else {
			pending.resolve(result);
		}
	}

	destroy(): void {
		this.initializationSeq++;
		this.sharedReady = false;
		this.worker?.terminate();
		this.worker = null;
		this.initPromise = null;
		this.dictionary = null;
		for (const pending of this.pendingResolvers.values()) pending.reject(new Error("Grammalecte : moteur arrêté."));
		this.pendingResolvers.clear();
	}
}
