/**
 * Grammalecte — orthographe et grammaire, moteur tiers (GPL 3) tournant
 * dans un Web Worker pour ne pas bloquer le thread principal.
 *
 * Le Worker est construit au runtime : ses scripts et dictionnaires sont
 * intégrés à main.js à la compilation, puis concaténés dans l'ordre
 * attendu (même ordre que les importScripts() du worker officiel de
 * l'extension Firefox), on ajoute notre propre code de pilotage
 * (data/grammalecte/driver.js), et on transforme le tout en un Worker via
 * un Blob URL — aucun chemin relatif, aucun import ES, donc aucun souci de
 * CORS/sandboxing dans Electron.
 */

import { engineScripts, grammarData } from "./grammalecte-resources";

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
	private worker: Worker | null = null;
	private initPromise: Promise<void> | null = null;
	private pendingResolvers = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private requestSeq = 0;

	/** Construit le Worker et initialise le moteur, une seule fois. */
	async ensureReady(dictionary: "fr-classic" | "fr-reform"): Promise<void> {
		if (this.initPromise) return this.initPromise;
		this.initPromise = this.buildAndInit(dictionary);
		return this.initPromise;
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
		const dictionaryData: unknown = JSON.parse(dictionary === "fr-reform" ? grammarData.reform : grammarData.classic);
		await this.send("init", {
			oDictionary: dictionaryData,
			sConjData: grammarData.conjugations,
			sPhonetData: grammarData.phonetics,
			sMfspData: grammarData.plurals,
			sThes1Data: grammarData.thesaurus1,
			sThes2Data: grammarData.thesaurus2,
		});
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
