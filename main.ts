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
import { DEFAULT_PALETTE, DEFAULT_SETTINGS, FinitionMode, FinitionRuntime, FinitionSettings, parseStopWords } from "./types";
import { finitionEditorExtension } from "./editor-extension";
import { FinitionSettingTab } from "./settings-tab";

// Les dictionnaires ne sont PAS lus depuis un dossier data/ à côté de
// main.js : ils sont importés comme n'importe quel module TypeScript et
// esbuild les inline directement dans le bundle (resolveJsonModule dans
// tsconfig.json). Résultat : un seul fichier à distribuer (main.js), comme
// n'importe quel plugin Obsidian standard — installable via BRAT ou le
// store officiel, sans dossier data/ à copier à la main.
import lexiconData from "./data/lexicon.json";
import functionWordsData from "./data/function-words.json";
import hedgingData from "./data/epistemic-hedging.json";
import stereotypesData from "./data/stereotypes.json";
import syntaxHingesData from "./data/syntax-hinges.json";

export default class FinitionPlugin extends Plugin implements FinitionRuntime {
	settings: FinitionSettings = DEFAULT_SETTINGS;
	lexicon: Map<string, string> = new Map();
	functionWords: Set<string> = new Set();
	hedgingPhrases: string[] = [];
	stereotypePatterns: string[][] = [];
	syntaxHinges: string[] = [];
	// Incrémenté à chaque saveSettings() ; lu par l'extension CM6 pour
	// savoir qu'elle doit recalculer ses décorations immédiatement.
	settingsVersion = 0;
	private statusBarItem: HTMLElement | null = null;

	private paletteStyleEl: HTMLStyleElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.loadLexiconData();
		this.applyPalette();
		this.registerEditorExtension(finitionEditorExtension(this));
		this.addSettingTab(new FinitionSettingTab(this.app, this));
		this.setupStatusBarItem();
	}

	onunload(): void {
		this.paletteStyleEl?.remove();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (this.migrateLegacyPaletteOrder()) {
			await this.saveData(this.settings); // persiste la migration, une seule fois
		}
	}

	/**
	 * Migration automatique, une seule fois : si la palette sauvegardée
	 * correspond exactement à l'ancien ordre par défaut (celui d'avant la
	 * mise en progression chromatique), on la remplace par le nouvel ordre.
	 * Si l'utilisateur a modifié ne serait-ce qu'une couleur, les tableaux
	 * ne correspondent plus et rien n'est touché — pas de risque d'écraser
	 * une personnalisation volontaire. Renvoie true si une migration a eu
	 * lieu (pour savoir s'il faut persister le résultat).
	 */
	private migrateLegacyPaletteOrder(): boolean {
		const legacyOrder = [
			"#d2edf7", "#ebecec", "#c6ecc3", "#e6c9f2", "#fefda8", "#f9e4bb",
			"#f6a9c9", "#b1c7f3", "#b6f3ed", "#f5e1a8", "#f5c3bb", "#c1adde",
			"#e8eec3", "#9ad8fb", "#c9daf2", "#a8e6cf",
		];
		const current = this.settings.palette.map((hex) => hex.toLowerCase());
		const matchesLegacy =
			current.length === legacyOrder.length && current.every((hex, i) => hex === legacyOrder[i]);
		if (matchesLegacy) {
			this.settings.palette = [...DEFAULT_PALETTE];
			return true;
		}
		return false;
	}

	async saveSettings(): Promise<void> {
		this.settingsVersion++;
		this.applyPalette();
		await this.saveData(this.settings);
	}

	/**
	 * Génère/actualise une feuille de style injectée dans le <head> à partir
	 * de settings.palette (plus besoin de toucher palette.css ni de
	 * relancer un build : un changement de couleur dans les réglages est
	 * visible immédiatement). Les sélecteurs `.finition-color-N` sont les
	 * mêmes que ceux historiquement définis dans palette.css ; cette feuille
	 * injectée, placée après, prend le dessus.
	 */
	applyPalette(): void {
		if (!this.paletteStyleEl) {
			this.paletteStyleEl = document.createElement("style");
			this.paletteStyleEl.id = "finition-palette-style";
			document.head.appendChild(this.paletteStyleEl);
		}
		const rules = this.settings.palette
			.map((hex, index) => `.finition-color-${index} { background: ${hex}; }`)
			.join("\n");
		this.paletteStyleEl.textContent = rules;
	}

	/**
	 * Charge le dictionnaire mot → lemme, les mots-outils, les locutions
	 * d'atténuation, les stéréotypes et les charnières — tous importés
	 * statiquement (inline dans main.js), jamais lus depuis le disque.
	 */
	loadLexiconData(): void {
		this.lexicon = new Map(Object.entries(lexiconData as Record<string, string>));
		this.functionWords = new Set(functionWordsData as string[]);
		// Une liste éditée manuellement dans les réglages prend le pas sur
		// celle bundlée par défaut.
		if (this.settings.customStopWords !== null) {
			this.functionWords = parseStopWords(this.settings.customStopWords);
		}
		this.hedgingPhrases = hedgingData as string[];
		this.stereotypePatterns = stereotypesData as string[][];
		this.syntaxHinges = syntaxHingesData as string[];
	}

	/**
	 * Liste actuelle des mots-outils, triée, pour pré-remplir le champ
	 * d'édition — sans les mots déjà exclus automatiquement par le seuil
	 * `repetitionMinLength` (pas la peine de les afficher comme "mots-outils"
	 * puisqu'ils ne seraient de toute façon jamais comptés comme répétition).
	 */
	stopWordsAsText(): string {
		return Array.from(this.functionWords)
			.filter((word) => word.length > this.settings.repetitionMinLength)
			.sort()
			.join(", ");
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
				.setTitle("Atténuation")
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
				.setTitle("Monotonie")
				.setIcon("activity")
				.setChecked(this.settings.mode === "burstiness")
				.onClick(() => this.setMode("burstiness"))
		);

		menu.addItem((item) =>
			item
				.setTitle("Tricolon")
				.setIcon("git-branch")
				.setChecked(this.settings.mode === "ternary")
				.onClick(() => this.setMode("ternary"))
		);

		menu.addItem((item) =>
			item
				.setTitle("Cadence")
				.setIcon("waves")
				.setChecked(this.settings.mode === "cadence")
				.onClick(() => this.setMode("cadence"))
		);

		menu.addItem((item) =>
			item
				.setTitle("Charnières")
				.setIcon("link")
				.setChecked(this.settings.mode === "hinges")
				.onClick(() => this.setMode("hinges"))
		);

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
