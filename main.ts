/**
 * Finition — plugin Obsidian de surlignage stylistique en direct.
 *
 * Ce fichier n'est que l'orchestrateur : chargement des données et des
 * réglages, point d'entrée dans la barre d'état (menu de choix du mode,
 * exclusif), et câblage vers les modules spécialisés :
 * - types.ts              : types partagés, réglages par défaut
 * - modes/repetition.ts   : algorithme "répétitions lexicales"
 * - modes/hedging.ts      : algorithme "hedging épistémique"
 * - editor-extension.ts   : intégration CodeMirror 6 (décorations en direct)
 * - settings-tab.ts       : onglet de réglages
 */

import { Menu, MarkdownView, Plugin, setIcon } from "obsidian";
import { EditorView } from "@codemirror/view";
import { DEFAULT_SETTINGS, FinitionMode, FinitionRuntime, FinitionSettings, parseStopWords } from "./types";
import { finitionEditorExtension } from "./editor-extension";
import { FinitionSettingTab } from "./settings-tab";

export default class FinitionPlugin extends Plugin implements FinitionRuntime {
	settings: FinitionSettings = DEFAULT_SETTINGS;
	lexicon: Map<string, string> = new Map();
	functionWords: Set<string> = new Set();
	hedgingPhrases: string[] = [];
	stereotypePatterns: string[][] = [];
	// Incrémenté à chaque saveSettings() ; lu par l'extension CM6 pour
	// savoir qu'elle doit recalculer ses décorations immédiatement.
	settingsVersion = 0;
	private statusBarItem: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.loadLexiconData();
		this.registerEditorExtension(finitionEditorExtension(this));
		this.addSettingTab(new FinitionSettingTab(this.app, this));
		this.setupStatusBarItem();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		this.settingsVersion++;
		await this.saveData(this.settings);
	}

	/** Charge le dictionnaire mot → lemme, les mots-outils et les locutions d'hedging. */
	async loadLexiconData(): Promise<void> {
		const base = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data`;
		try {
			const raw = await this.app.vault.adapter.read(`${base}/lexicon.json`);
			const parsed = JSON.parse(raw) as Record<string, string>;
			this.lexicon = new Map(Object.entries(parsed));
		} catch (error) {
			console.warn(
				"Finition : data/lexicon.json introuvable — comparaison par mot exact uniquement (pas de lemmatisation).",
				error
			);
		}
		try {
			const raw = await this.app.vault.adapter.read(`${base}/function-words.json`);
			const parsed = JSON.parse(raw) as string[];
			this.functionWords = new Set(parsed);
		} catch (error) {
			console.warn(
				"Finition : data/function-words.json introuvable — aucun mot-outil filtré.",
				error
			);
		}
		// Une liste éditée manuellement dans les réglages prend le pas sur
		// celle chargée depuis le fichier bundlé.
		if (this.settings.customStopWords !== null) {
			this.functionWords = parseStopWords(this.settings.customStopWords);
		}
		try {
			const raw = await this.app.vault.adapter.read(`${base}/epistemic-hedging.json`);
			this.hedgingPhrases = JSON.parse(raw) as string[];
		} catch (error) {
			console.warn(
				"Finition : data/epistemic-hedging.json introuvable — mode prudence épistémique désactivé.",
				error
			);
		}
		try {
			const raw = await this.app.vault.adapter.read(`${base}/stereotypes.json`);
			this.stereotypePatterns = JSON.parse(raw) as string[][];
		} catch (error) {
			console.warn(
				"Finition : data/stereotypes.json introuvable — mode stéréotypes désactivé.",
				error
			);
		}
	}

	/** Liste actuelle des mots-outils, triée, pour pré-remplir le champ d'édition. */
	stopWordsAsText(): string {
		return Array.from(this.functionWords).sort().join(", ");
	}

	/**
	 * Icône "note de musique" dans la barre d'état, point d'entrée unique du
	 * plugin. Clic = menu de choix du mode d'analyse actif. Ajouter un mode
	 * revient à ajouter une entrée de menu + son propre module modes/xxx.ts,
	 * branché sur setMode("xxx") et sur editor-extension.ts.
	 */
	private setupStatusBarItem(): void {
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass("finition-status-bar-item");
		this.statusBarItem.setAttribute("aria-label", "Finition");
		setIcon(this.statusBarItem, "music");
		this.updateStatusBarIcon();
		this.statusBarItem.addEventListener("click", (evt) => this.showModeMenu(evt));
	}

	updateStatusBarIcon(): void {
		this.statusBarItem?.toggleClass("finition-status-bar-active", this.settings.mode !== "none");
	}

	/** Change de mode, en désactivant systématiquement les autres (exclusif). */
	async setMode(mode: FinitionMode): Promise<void> {
		// Recliquer sur le mode déjà actif l'éteint (retour à "none").
		this.settings.mode = this.settings.mode === mode ? "none" : mode;
		await this.saveSettings();
		this.updateStatusBarIcon();
		this.refreshAllEditors();
	}

	private showModeMenu(evt: MouseEvent): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Répétitions")
				.setIcon("repeat")
				.setChecked(this.settings.mode === "repetition")
				.onClick(() => this.setMode("repetition"))
		);

		menu.addItem((item) =>
			item
				.setTitle("Prudence épistémique")
				.setIcon("shield-question")
				.setChecked(this.settings.mode === "hedging")
				.onClick(() => this.setMode("hedging"))
		);

		menu.addItem((item) =>
			item
				.setTitle("Stéréotypes")
				.setIcon("sparkles")
				.setChecked(this.settings.mode === "stereotype")
				.onClick(() => this.setMode("stereotype"))
		);

		menu.addItem((item) =>
			item
				.setTitle("Burstiness")
				.setIcon("activity")
				.setChecked(this.settings.mode === "burstiness")
				.onClick(() => this.setMode("burstiness"))
		);

		menu.addSeparator();

		// Les ternaires ne sont pas portables en JS sans un vrai parseur
		// syntaxique (ils dépendent de l'analyse de dépendances spaCy côté
		// Python). Laissés ici en rappel, pas prévus à court terme.
		menu.addItem((item) => item.setTitle("Ternaires (non portable en JS)").setIcon("git-branch").setDisabled(true));

		menu.showAtMouseEvent(evt);
	}

	/** Force CodeMirror à relire les décorations sur tous les éditeurs ouverts. */
	refreshAllEditors(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				const cm = (view.editor as unknown as { cm?: EditorView }).cm;
				cm?.dispatch({});
			}
		});
	}
}
