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
import {
	addWordToDictionaryText,
	BUILTIN_PROMPTS,
	DEFAULT_PALETTE,
	DEFAULT_SETTINGS,
	FinitionMode,
	FinitionRuntime,
	FinitionSettings,
	parseGrammalecteDictionary,
	parseStopWords,
} from "./types";
import { finitionEditorExtension } from "./editor-extension";
import { FinitionSettingTab } from "./settings-tab";
import { finitionAIExtension, AIGroup } from "./ai/ai-extension";
import { splitIntoChunks } from "./ai/chunk";
import { diffToGroups } from "./ai/diff";
import { cleanTypography } from "./ai/clean";
import { reviseChunkWithRetryAnthropic } from "./ai/anthropic";
import { reviseChunkWithRetryOpenAI } from "./ai/openai";
import { detectProvider } from "./ai/provider";
import { fixPunctuationSpacing, fixBlankLinesProtected } from "./modes/punctuation";
import { GrammalecteEngine, GrammalecteError } from "./modes/grammalecte";
import { finitionGrammalecteExtension } from "./grammalecte-extension";
import { buildStructureReport } from "./modes/structure-report";
import { structureCategoryWords } from "./modes/structure-signature";

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

	// Cache des catégories grammaticales pour Cadence (moteur "grammalecte") —
	// voir ensureWordCategories() et modes/structure-signature.ts. Partage la
	// même instance de GrammalecteEngine que la fonctionnalité Grammalecte :
	// pas de double chargement du dictionnaire en mémoire.
	wordCategoryCache: Map<string, string> = new Map();
	// Incrémenté dans ensureWordCategories() à chaque mise à jour du cache —
	// voir le commentaire sur FinitionRuntime.wordCategoryCacheVersion dans
	// types.ts pour le bug que ça corrige (affichage Tricolon/Cadence figé
	// sur un cache incomplet tant qu'on ne cliquait pas dans le document).
	wordCategoryCacheVersion = 0;
	private pendingCategoryWords = new Set<string>();
	private categoryFetchTimer: number | null = null;

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

		// En plus de l'entrée du menu de la barre de statut (parfois capricieux
		// à cliquer — plusieurs rapports utilisateur de clics sans effet) :
		// une commande fiable, accessible via la palette de commandes.
		this.addCommand({
			id: "finition-structure-report",
			name: "Structure : générer le rapport d'analyse syntaxique",
			callback: () => this.runStructureReport(),
		});
	}

	onunload(): void {
		for (let index = 0; index < this.settings.palette.length; index++) {
			document.body.style.removeProperty(`--finition-color-${index}`);
		}
		this.grammalecteEngine?.destroy();
		if (this.categoryFetchTimer !== null) window.clearTimeout(this.categoryFetchTimer);
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<FinitionSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
		// Object.assign() est superficiel : si data.json ne contenait pas
		// encore `savedPrompts` (installation antérieure à la bibliothèque de
		// prompts), this.settings.savedPrompts pointerait vers EXACTEMENT le
		// même tableau que DEFAULT_SETTINGS.savedPrompts — un push()/filter()
		// ultérieur (Enregistrer/Supprimer) modifierait alors les valeurs par
		// défaut elles-mêmes pour le reste de la session. On clone donc
		// systématiquement les entrées pour obtenir un tableau indépendant.
		this.settings.savedPrompts = (this.settings.savedPrompts ?? []).map((p) => ({ ...p }));
		let needsPersist = this.ensureBuiltinPrompts();
		if (this.reconcileActivePrompt()) {
			needsPersist = true;
		}
		if (this.migrateLegacyPaletteOrder()) {
			needsPersist = true;
		}
		if (needsPersist) {
			await this.saveData(this.settings); // persiste la migration, une seule fois
		}
	}

	/**
	 * Garantit que tous les prompts système (BUILTIN_PROMPTS, un par fichier
	 * ai/prompt-*.md) sont bien présents dans settings.savedPrompts — y
	 * compris s'ils ont été ajoutés après l'installation initiale du plugin
	 * (nouveau prompt système livré dans une mise à jour) ou si l'un d'eux a
	 * disparu de data.json pour une raison quelconque. Ne touche jamais un
	 * prompt système déjà présent (pas d'écrasement d'une éventuelle
	 * modification manuelle de data.json). Renvoie true si une entrée a été
	 * ajoutée (à persister).
	 */
	private ensureBuiltinPrompts(): boolean {
		let changed = false;
		for (const builtin of BUILTIN_PROMPTS) {
			const existing = this.settings.savedPrompts.find((p) => p.name === builtin.name);
			if (!existing) {
				this.settings.savedPrompts.push({ ...builtin });
				changed = true;
			} else if (!existing.builtin) {
				// Entrée créée par une version antérieure à l'ajout du champ
				// `builtin` (ou sauvegardée avant ce correctif) : son nom
				// correspond à un prompt système, on la marque donc non
				// supprimable sans toucher à son contenu ni à son modèle.
				existing.builtin = true;
				changed = true;
			}
		}
		return changed;
	}

	/**
	 * Garantit que settings.activePromptName (affiché dans le menu déroulant
	 * "Prompt enregistré") correspond réellement au contenu de
	 * settings.aiPrompt (affiché dans la zone de texte) — sinon le menu
	 * affiche un nom qui ne correspond pas au texte visible, ce qui est
	 * trompeur. Deux cas gérés :
	 * 1. Mise à jour depuis une version sans bibliothèque de prompts : aucun
	 *    `activePromptName` n'existait, mais le contenu sauvegardé peut
	 *    correspondre exactement à l'un des prompts fournis par défaut (ex.
	 *    l'ancien prompt unique, devenu "Révision stylistique") : on
	 *    retrouve alors son nom automatiquement.
	 * 2. `activePromptName` est défini mais ne correspond plus au contenu
	 *    réel (le texte a été modifié depuis, ou l'entrée a été supprimée de
	 *    la bibliothèque) : on détache le nom, pour que l'interface affiche
	 *    honnêtement "(non enregistré)" plutôt qu'un nom erroné.
	 * Renvoie true si une correction a été appliquée (à persister).
	 */
	private reconcileActivePrompt(): boolean {
		const { aiPrompt, activePromptName, savedPrompts } = this.settings;
		const matchByNameAndContent = savedPrompts.find((p) => p.name === activePromptName && p.prompt === aiPrompt);
		if (matchByNameAndContent) return false; // déjà cohérent
		const matchByContent = savedPrompts.find((p) => p.prompt === aiPrompt);
		this.settings.activePromptName = matchByContent ? matchByContent.name : null;
		return true;
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
	 * Actualise les variables CSS de la palette à partir des réglages.
	 */
	applyPalette(): void {
		this.settings.palette.forEach((hex, index) => {
			document.body.style.setProperty(`--finition-color-${index}`, hex);
		});
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
				.setTitle("Tricolons")
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

		menu.addItem((item) =>
			item
				.setTitle("Structure")
				.setIcon("list-tree")
				.onClick(() => this.runStructureReport())
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Paramètres")
				.setIcon("settings")
				.onClick(() => this.openSettingsTab())
		);

		menu.showAtMouseEvent(evt);
	}

	/** Ouvre directement l'onglet de réglages du plugin Finition. */
	private openSettingsTab(): void {
		// API non officiellement typée par obsidian.d.ts mais stable et
		// largement utilisée par l'écosystème des plugins tiers pour ouvrir
		// directement SA PROPRE page de réglages (évite de passer par
		// Réglages > Plugins communautaires > Finition manuellement).
		const appWithSettings = this.app as unknown as {
			setting: { open: () => void; openTabById: (id: string) => void };
		};
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(this.manifest.id);
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
		const provider = detectProvider(this.settings.aiModel);
		const apiKey = provider === "openai" ? this.settings.openaiApiKey : this.settings.aiApiKey;
		if (!apiKey) {
			const providerLabel = provider === "openai" ? "OpenAI" : "Anthropic";
			new Notice(`Ortho-typo IA : renseigne ta clé API ${providerLabel} dans Réglages → Finition.`);
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
				const reviseChunk = provider === "openai" ? reviseChunkWithRetryOpenAI : reviseChunkWithRetryAnthropic;
				const { text: revisedRaw, error } = await reviseChunk(chunk.text, this.settings.aiPrompt, {
					apiKey,
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

	/** Crée le Worker Grammalecte au premier besoin (Grammalecte OU Cadence "grammalecte"), une seule fois. */
	private async ensureGrammalecteEngine(): Promise<GrammalecteEngine> {
		if (!this.grammalecteEngine) {
			this.grammalecteEngine = new GrammalecteEngine(this.app, this.manifest.dir ?? "");
		}
		await this.grammalecteEngine.ensureReady(this.settings.grammalecteDictionary);
		return this.grammalecteEngine;
	}

	/**
	 * Demande la résolution des catégories grammaticales des mots fournis qui
	 * manquent encore au cache, sans bloquer l'appelant (editor-extension.ts
	 * continue d'afficher ce qu'il sait déjà). Les requêtes de plusieurs
	 * frappes rapprochées sont regroupées (debounce 400 ms) pour éviter de
	 * spammer le Worker à chaque caractère tapé.
	 */
	ensureWordCategories(words: string[]): void {
		let hasNew = false;
		for (const word of words) {
			if (!this.wordCategoryCache.has(word) && !this.pendingCategoryWords.has(word)) {
				this.pendingCategoryWords.add(word);
				hasNew = true;
			}
		}
		if (!hasNew) return;

		if (this.categoryFetchTimer !== null) window.clearTimeout(this.categoryFetchTimer);
		this.categoryFetchTimer = window.setTimeout(() => void this.resolvePendingWordCategories(), 400);
	}

	private async resolvePendingWordCategories(): Promise<void> {
		const toFetch = [...this.pendingCategoryWords];
		this.pendingCategoryWords.clear();
		try {
			const engine = await this.ensureGrammalecteEngine();
			const result = await engine.getCategories(toFetch);
			for (const [word, category] of Object.entries(result)) {
				this.wordCategoryCache.set(word, category);
			}
			this.wordCategoryCacheVersion++;
			this.refreshAllEditors();
		} catch (e) {
			console.error("Finition — Cadence (Grammalecte) : impossible de résoudre les catégories.", e);
		}
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

		const notice = new Notice("Grammalecte : chargement du moteur...", 0);
		try {
			const engine = await this.ensureGrammalecteEngine();
			notice.setMessage("Grammalecte : analyse en cours...");
			const text = editor.getValue();
			const rawErrors = await engine.parse(text);
			const dictionary = parseGrammalecteDictionary(this.settings.grammalecteCustomDictionary);
			// Les noms propres et mots inconnus ajoutés au dictionnaire
			// personnel ne doivent plus jamais être soulignés — uniquement
			// filtré côté orthographe : une erreur de grammaire portant sur un
			// groupe de mots n'a pas de sValue unique à comparer.
			this.grammalecteErrors = rawErrors.filter(
				(err) => !(err.sType === "orthographe" && err.sValue && dictionary.has(err.sValue.toLowerCase()))
			);
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

	/**
	 * Commande "Structure" : génère, dans une NOUVELLE note, l'encodage
	 * syntaxique coloré de chaque phrase du document actif (voir
	 * modes/structure-report.ts) — un outil de lecture seule pour comprendre
	 * comment Cadence et Tricolons analysent le texte, sans jamais toucher
	 * au document d'origine.
	 */
	private async runStructureReport(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			// Garde auparavant silencieuse : aucune erreur console, aucun
			// message — ressemblait exactement à "rien ne se passe" alors
			// qu'il n'y avait tout simplement pas de note Markdown active au
			// moment du clic/raccourci (focus ailleurs, palette de
			// commandes qui vient de se refermer sans avoir redonné le
			// focus à l'éditeur, etc.).
			new Notice("Structure : aucune note Markdown active. Clique d'abord dans le texte, puis relance.", 6000);
			return;
		}
		const text = view.editor.getValue();

		const notice = new Notice("Structure : chargement du moteur Grammalecte...", 0);
		try {
			const engine = await this.ensureGrammalecteEngine();
			notice.setMessage("Structure : analyse en cours...");

			const categories = await engine.getCategories(structureCategoryWords(text));
			const getCategory = (word: string) => categories[word.toLowerCase()] ?? "";

			const content = buildStructureReport(text, getCategory);

			// Nom unique pour ne jamais écraser un rapport précédent par
			// mégarde ; dans le même dossier que la note active, pour rester
			// facile à retrouver.
			const activeFile = view.file;
			const folder = activeFile?.parent?.path ? `${activeFile.parent.path}/` : "";
			const pad = (n: number) => String(n).padStart(2, "0");
			const now = new Date();
			const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
				now.getHours()
			)}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
			const path = `${folder}Structure — ${activeFile?.basename ?? "sans titre"} (${timestamp}).md`;

			const file = await this.app.vault.create(path, content);
			notice.hide();
			await this.app.workspace.getLeaf(true).openFile(file);
		} catch (e) {
			notice.hide();
			new Notice(`Structure : erreur — ${e instanceof Error ? e.message : String(e)}`, 10000);
			console.error("Finition — Structure :", e);
		}
	}

	/**
	 * Ajoute un mot au dictionnaire personnel Grammalecte (bouton "Ajouter au
	 * dictionnaire" du popup — voir grammalecte-extension.ts) et retire
	 * IMMÉDIATEMENT toutes les occurrences déjà soulignées de ce mot dans la
	 * note courante (pas seulement celle sur laquelle on vient de cliquer) :
	 * un nom propre répété plusieurs fois serait sinon toujours souligné
	 * ailleurs dans le texte après l'avoir "accepté" une fois.
	 */
	async addWordToGrammalecteDictionary(word: string): Promise<void> {
		const normalized = word.trim();
		if (!normalized) return;
		this.settings.grammalecteCustomDictionary = addWordToDictionaryText(
			this.settings.grammalecteCustomDictionary,
			normalized
		);
		const lower = normalized.toLowerCase();
		this.grammalecteErrors = this.grammalecteErrors.filter(
			(err) => !(err.sType === "orthographe" && err.sValue && err.sValue.toLowerCase() === lower)
		);
		this.grammalecteErrorsVersion++;
		await this.saveSettings();
		this.refreshAllEditors();
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
