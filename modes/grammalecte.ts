/**
 * Grammalecte — orthographe et grammaire, moteur tiers (GPL 3) tournant
 * dans un Web Worker pour ne pas bloquer le thread principal.
 *
 * Le Worker est construit au runtime : on lit tous les fichiers du moteur
 * (data/grammalecte/*.js) via l'API Obsidian, on les concatène dans l'ordre
 * attendu (même ordre que les importScripts() du worker officiel de
 * l'extension Firefox), on ajoute notre propre code de pilotage
 * (data/grammalecte/driver.js), et on transforme le tout en un Worker via
 * un Blob URL — aucun chemin relatif, aucun import ES, donc aucun souci de
 * CORS/sandboxing dans Electron.
 */

import { App, normalizePath } from "obsidian";

export interface GrammalecteError {
	nStart: number;
	nEnd: number;
	sType: "orthographe" | "grammaire";
	sRuleId: string;
	sMessage: string;
	aSuggestions: string[];
}

// Ordre important : chaque fichier s'appuie sur des variables globales
// définies par les précédents (pas de modules ES, code "à l'ancienne").
const ENGINE_FILES = [
	"helpers.js",
	"str_transform.js",
	"char_player.js",
	"lexgraph_fr.js",
	"ibdawg.js",
	"spellchecker.js",
	"text.js",
	"tokenizer.js",
	"conj.js",
	"mfsp.js",
	"phonet.js",
	"thesaurus.js",
	"cregex.js",
	"gc_options.js",
	"gc_functions.js",
	"gc_rules.js",
	"gc_rules_graph.js",
	"gc_engine.js",
];

export class GrammalecteEngine {
	private worker: Worker | null = null;
	private initPromise: Promise<void> | null = null;
	private pendingResolvers = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private requestSeq = 0;

	constructor(
		private app: App,
		private pluginDir: string // ex. ".obsidian/plugins/finition", voir manifest.dir
	) {}

	/** Construit le Worker et initialise le moteur, une seule fois. */
	async ensureReady(dictionary: "fr-classic" | "fr-reform"): Promise<void> {
		if (this.initPromise) return this.initPromise;
		this.initPromise = this.buildAndInit(dictionary);
		return this.initPromise;
	}

	private async readDataFile(name: string): Promise<string> {
		const path = normalizePath(`${this.pluginDir}/data/grammalecte/${name}`);
		return this.app.vault.adapter.read(path);
	}

	private async buildAndInit(dictionary: "fr-classic" | "fr-reform"): Promise<void> {
		// 1. Concaténation du moteur + driver
		const parts: string[] = [];
		// Les fichiers Grammalecte testent `typeof(process) !== 'undefined'`
		// pour choisir entre un require() Node.js (chemins relatifs, qui
		// n'existent pas dans un Worker construit depuis un Blob) ou la
		// branche navigateur (variables globales déjà chargées par les
		// fichiers précédents dans ce même scope). Dans Electron/Obsidian,
		// `process` existe même dans un Worker — on le neutralise ici pour
		// forcer la branche navigateur, seule compatible avec notre
		// concaténation manuelle.
		parts.push("var process = undefined;");
		for (const file of ENGINE_FILES) {
			parts.push(await this.readDataFile(file));
		}
		parts.push(await this.readDataFile("driver.js"));
		const bigScript = parts.join("\n;\n");

		const blob = new Blob([bigScript], { type: "application/javascript" });
		const url = URL.createObjectURL(blob);
		this.worker = new Worker(url);
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
		const dictFile = dictionary === "fr-reform" ? "fr-reform.json" : "fr-classic.json";
		const [dictRaw, conjData, phonetData, mfspData, thes1Data, thes2Data] = await Promise.all([
			this.readDataFile(`_dictionaries/${dictFile}`),
			this.readDataFile("conj_data.json"),
			this.readDataFile("phonet_data.json"),
			this.readDataFile("mfsp_data.json"),
			this.readDataFile("thesaurus1_data.json"),
			this.readDataFile("thesaurus2_data.json"),
		]);

		await this.send("init", {
			oDictionary: JSON.parse(dictRaw),
			sConjData: conjData,
			sPhonetData: phonetData,
			sMfspData: mfspData,
			sThes1Data: thes1Data,
			sThes2Data: thes2Data,
		});
	}

	async parse(text: string): Promise<GrammalecteError[]> {
		if (!this.worker) throw new Error("Grammalecte : moteur non initialisé.");
		const result = await this.send("parse", { sText: text });
		return result as GrammalecteError[];
	}

	private send(sCommand: string, oParam: unknown): Promise<unknown> {
		if (!this.worker) return Promise.reject(new Error("Worker absent."));
		const id = String(this.requestSeq++);
		return new Promise((resolve, reject) => {
			this.pendingResolvers.set(sCommand, { resolve, reject });
			this.worker!.postMessage({ sCommand, oParam });
		});
	}

	private handleMessage(e: MessageEvent): void {
		const { sAction, result, bError } = e.data as { sAction: string; result: unknown; bError: boolean };
		const pending = this.pendingResolvers.get(sAction);
		if (!pending) return;
		this.pendingResolvers.delete(sAction);
		if (bError) {
			pending.reject(new Error(typeof result === "string" ? result : "Erreur Grammalecte inconnue."));
		} else {
			pending.resolve(result);
		}
	}

	destroy(): void {
		this.worker?.terminate();
		this.worker = null;
		this.initPromise = null;
	}
}
