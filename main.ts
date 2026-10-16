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

import { Menu, MarkdownView, Notice, Plugin, setIcon } from "obsidian";
import { EditorView } from "@codemirror/view";
import { DEFAULT_PALETTE, DEFAULT_SETTINGS, FinitionMode, FinitionRuntime, FinitionSettings, parseStopWords } from "./types";
import { finitionEditorExtension } from "./editor-extension";
import { FinitionSettingTab } from "./settings-tab";
import { finitionAIExtension, AIGroup } from "./ai/ai-extension";
import { splitIntoChunks } from "./ai/chunk";
import { diffToGroups } from "./ai/diff";
import { cleanTypography } from "./ai/clean";
import { reviseChunkWithRetry } from "./ai/anthropic";
import { fixPunctuationSpacing, fixBlankLinesProtected } from "./modes/punctuation";
import { GrammalecteEngine, GrammalecteError } from "./modes/grammalecte";
import { finitionGrammalecteExtension } from "./grammalecte-extension";

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

	// Suggestions "Ortho-typo IA" en attente de validation (clic). Vivent
	// uniquement en mémoire, jamais persistées : elles ne modifient le
	// document que lorsque l'utilisateur clique dessus (voir ai-extension.ts).
	aiGroups: AIGroup[] = [];
	aiGroupsVersion = 0;
	private nextAiGroupId = 0;

	// Erreurs Grammalecte de la dernière analyse (toute la note). Comme pour
	// Ortho-typo IA, vit uniquement en mémoire : la correction n'est
	// appliquée qu'au clic sur une suggestion (voir grammalecte-extension.ts).
	grammalecteErrors: GrammalecteError[] = [];
	grammalecteErrorsVersion = 0;
	private grammalecteEngine: GrammalecteEngine | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.loadLexiconData();
		this.applyPalette();
		this.registerEditorExtension(finitionEditorExtension(this));
		this.registerEditorExtension(finitionAIExtension(this));
		this.registerEditorExtension(finitionGrammalecteExtension(this));
		this.addSettingTab(new FinitionSettingTab(this.app, this));
		this.setupStatusBarItem();

		this.addCommand({
			id: "finition-punctuation-fix",
			name: "Ponctuation : corriger les espaces et tirets de la sélection",
			callback: () => this.runPunctuationFix(),
		});

		this.addCommand({
			id: "finition-grammalecte",
			name: "Grammalecte : analyser toute la note",
			callback: () => this.runGrammalecte(),
		});
	}

	onunload(): void {
		this.paletteStyleEl?.remove();
		this.grammalecteEngine?.destroy();
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

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Ortho-typo IA")
				.setIcon("bot")
				.setChecked(this.aiGroups.length > 0)
				.onClick(() => this.toggleOrthoTypoIA())
		);

		menu.addItem((item) =>
			item
				.setTitle("Ponctuation")
				.setIcon("quote")
				.onClick(() => this.runPunctuationFix())
		);

		menu.addItem((item) =>
			item
				.setTitle("Grammalecte")
				.setIcon("spell-check")
				.setChecked(this.grammalecteErrors.length > 0)
				.onClick(() => this.toggleGrammalecte())
		);

		menu.showAtMouseEvent(evt);
	}

	/**
	 * Lance une révision IA de la SÉLECTION actuelle (jamais du document
	 * entier automatiquement). Ne modifie rien tout de suite : les
	 * suggestions calculées sont stockées dans `aiGroups` et affichées en
	 * couleur par ai-extension.ts ; seul un clic sur une suggestion
	 * applique réellement un changement au document.
	 */
	/**
	 * Bascule Ortho-typo IA : si des suggestions sont déjà affichées, un
	 * reclic les efface simplement (décoché) sans relancer d'analyse ;
	 * sinon, lance une nouvelle analyse (coché).
	 */
	private async toggleOrthoTypoIA(): Promise<void> {
		if (this.aiGroups.length > 0) {
			this.clearAISuggestions();
			return;
		}
		await this.runOrthoTypoIA();
	}

	private async runOrthoTypoIA(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		if (!editor.somethingSelected()) {
			new Notice("Sélectionner d'abord un texte.");
			return;
		}
		if (!this.settings.aiApiKey) {
			new Notice("Ortho-typo IA : renseigne ta clé API Anthropic dans Réglages → Finition.");
			return;
		}

		// Efface implicitement les suggestions d'un lancement précédent —
		// pas besoin d'une commande "reset" séparée : relancer Ortho-typo IA
		// repart simplement à zéro.
		this.clearAISuggestions();

		const selectionFrom = editor.posToOffset(editor.getCursor("from"));
		const original = editor.getSelection();
		const chunks = splitIntoChunks(original, this.settings.aiChunkSize);

		// Une seule notification, mise à jour à chaque tronçon (via
		// setMessage) plutôt qu'un message figé affiché une fois pour toutes
		// au début — sinon rien ne permet de suivre ce qui se passe pendant
		// l'attente des appels API, potentiellement longs.
		const progress = new Notice(`Ortho-typo IA : tronçon 1/${chunks.length}...`, 0);
		const errors: string[] = [];

		// try/finally : si quoi que ce soit plante de façon inattendue (pas
		// seulement les erreurs API déjà gérées une par une plus bas), la
		// notification de progression se ferme quand même et l'erreur
		// s'affiche, au lieu de laisser croire que le plugin est resté bloqué.
		try {
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				progress.setMessage(`Ortho-typo IA : tronçon ${i + 1}/${chunks.length}...`);
				if (chunk.text.trim().length === 0) continue;
				const { text: revisedRaw, error } = await reviseChunkWithRetry(chunk.text, this.settings.aiPrompt, {
					apiKey: this.settings.aiApiKey,
					model: this.settings.aiModel,
					maxTokens: this.settings.aiMaxTokens,
				});
				if (error) {
					// Échec sur ce tronçon : on garde le texte d'origine (pas de
					// fausse correction), mais on prévient — plutôt que de laisser
					// croire silencieusement qu'"aucune correction" n'était nécessaire.
					errors.push(`Tronçon ${i + 1}/${chunks.length} : ${error}`);
					continue;
				}
				const revised = cleanTypography(revisedRaw);
				const groups = diffToGroups(chunk.text, revised);
				for (const g of groups) {
					this.aiGroups.push({
						id: this.nextAiGroupId++,
						delFrom: selectionFrom + chunk.start + g.delFrom,
						delTo: selectionFrom + chunk.start + g.delTo,
						delText: g.delText,
						insText: g.insText,
					});
				}
				this.aiGroupsVersion++;
				this.refreshAllEditors(); // les suggestions déjà calculées s'affichent au fil de l'eau, pas seulement à la toute fin
			}
		} catch (e) {
			errors.push(`Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			progress.hide();
		}

		if (errors.length > 0) {
			new Notice(`Ortho-typo IA : ${errors.length} erreur(s).\n${errors[0]}`, 12000);
			console.error("Ortho-typo IA : erreurs détaillées", errors);
		}
		if (this.aiGroups.length === 0 && errors.length === 0) {
			new Notice("Ortho-typo IA : aucune correction proposée.");
		} else if (this.aiGroups.length > 0) {
			new Notice(
				`Ortho-typo IA : ${this.aiGroups.length} suggestion(s). Clique sur le texte en couleur pour valider.`
			);
		}
	}

	/**
	 * Corrige instantanément les espaces insécables et tirets de la
	 * sélection (règles déterministes, voir punctuation.ts) : contrairement
	 * à Ortho-typo IA, pas de validation au cas par cas, le document est
	 * modifié directement.
	 */
	/**
	 * Applique toutes les règles de Ponctuation (espaces, tirets, apostrophes,
	 * sauts de ligne) à TOUTE la note, sans condition de sélection — limiter
	 * ces règles objectives à une sélection n'avait pas d'intérêt pratique.
	 */
	private runPunctuationFix(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		const original = editor.getValue();
		let fixed = fixPunctuationSpacing(original);
		fixed = fixBlankLinesProtected(fixed);

		if (fixed !== original) {
			const cursor = editor.getCursor();
			editor.setValue(fixed);
			editor.setCursor(cursor); // setValue ramène le curseur au début, on le restaure au mieux
			new Notice("Ponctuation : corrections appliquées.");
		} else {
			new Notice("Ponctuation : rien à corriger.");
		}
	}

	/**
	 * Analyse toute la note avec Grammalecte (orthographe + grammaire).
	 * Comme Ortho-typo IA, ne modifie jamais le document directement : les
	 * erreurs trouvées sont soulignées, la correction n'est appliquée qu'au
	 * clic sur une suggestion dans le popup (voir grammalecte-extension.ts).
	 */
	/**
	 * Bascule Grammalecte : si des erreurs sont déjà soulignées, un reclic
	 * les efface simplement (décoché), sans relancer d'analyse ; sinon,
	 * lance une nouvelle analyse (coché).
	 */
	private async toggleGrammalecte(): Promise<void> {
		if (this.grammalecteErrors.length > 0) {
			this.grammalecteErrors = [];
			this.grammalecteErrorsVersion++;
			this.refreshAllEditors();
			return;
		}
		await this.runGrammalecte();
	}

	private async runGrammalecte(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		// Grammalecte souligne lui-même le texte (rouge/bleu) : le cumul avec
		// un mode de surlignage continu (Répétition, Monotonie, Cadence,
		// Tricolon...) ou avec des suggestions Ortho-typo IA encore en attente
		// rendrait le texte illisible. On désactive donc tout le reste au
		// lancement, comme le changement de mode le fait déjà normalement.
		if (this.settings.mode !== "none") {
			this.settings.mode = "none";
			await this.saveSettings();
		}
		if (this.aiGroups.length > 0) {
			this.clearAISuggestions();
		}

		if (!this.grammalecteEngine) {
			this.grammalecteEngine = new GrammalecteEngine(this.app, this.manifest.dir ?? "");
		}

		const notice = new Notice("Grammalecte : chargement du moteur...", 0);
		try {
			await this.grammalecteEngine.ensureReady(this.settings.grammalecteDictionary);
			notice.setMessage("Grammalecte : analyse en cours...");
			const text = editor.getValue();
			this.grammalecteErrors = await this.grammalecteEngine.parse(text);
			this.grammalecteErrorsVersion++;
			this.refreshAllEditors();
			notice.hide();
			if (this.grammalecteErrors.length === 0) {
				new Notice("Grammalecte : aucune erreur détectée.");
			} else {
				new Notice(`Grammalecte : ${this.grammalecteErrors.length} erreur(s) trouvée(s). Clique sur un mot souligné.`);
			}
		} catch (e) {
			notice.hide();
			new Notice(`Grammalecte : erreur — ${e instanceof Error ? e.message : String(e)}`, 10000);
			console.error("Finition — Grammalecte :", e);
		}
	}

	/** Efface toutes les suggestions IA en attente, sans rien modifier au document. */
	clearAISuggestions(): void {
		this.aiGroups = [];
		this.aiGroupsVersion++;
		this.refreshAllEditors();
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
