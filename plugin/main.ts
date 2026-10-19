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

import { FileSystemAdapter, Menu, MarkdownView, Notice, Plugin, setIcon } from "obsidian";
import type { TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import {
	addWordToDictionaryText,
	BUILTIN_PROMPTS,
	DEFAULT_PALETTE,
	DEFAULT_SETTINGS,
	FinitionMode,
	FinitionRuntime,
	FinitionSettings,
	Highlight,
	parseGrammalecteDictionary,
	parseStopWords,
} from "./types";
import { finitionEditorExtension } from "./editor-extension";
import { FinitionSettingTab } from "./settings-tab";
import { finitionAIExtension, AIGroup } from "./ai/ai-extension";
import { splitIntoChunks } from "./ai/chunk";
import { protectLinks } from "./ai/protected-links";
import { hasResponseText } from "./ai/clean";
import { markdownLinks } from "./markdown-links";
import { reviseChunkWithRetryAnthropic } from "./ai/anthropic";
import { reviseChunkWithRetryOpenAI } from "./ai/openai";
import { detectProvider } from "./ai/provider";
import { runSynonyms } from "./ai/synonyms";
import { fixPunctuationSpacing, fixBlankLinesProtected } from "./modes/punctuation";
import { GrammalecteEngine, GrammalecteError } from "./modes/grammalecte";
import { FinitionCorrectorEngine } from "./modes/finition-corrector";
import { analyzeCorrections } from "./modes/corrections";
import { finitionGrammalecteExtension } from "./grammalecte-extension";
import { buildStructureReport } from "./modes/structure-report";
import { structureCategoryWords } from "./modes/structure-signature";
import { loadingMessage } from "./ui/loading-message";
import { AnalysisNavigation } from "./ui/analysis-navigation";
import { countDocument, formatDocumentCount } from "./ui/document-count";
import { LinguisticResources, resourceHash } from "./linguistic-resources";
import type { ResourceEngine, ResourcePack } from "./linguistic-files";
import { resourceEngines, resourceLabels, resourcePacks } from "./linguistic-files";
import { finitionSynonymMetadata, isSynonymDocumentation, parseSynonymDictionary, personalSynonymPath, synonymFileLimit, SynonymsDictionary, type SynonymMetadata } from "./synonyms";
import { runLocalSynonyms, runLocalWordLookup } from "./ui/local-synonyms";
import { NeuralModels, neuralFileLimit } from "./neural-models";
import { dictionaryKinds, dictionaryLabels, WordDictionaries, type DictionaryKind } from "./dictionaries";

// Les petites ressources stylistiques restent intégrées au plugin.
// Dictionnaires et modèles de correction se téléchargent séparément.
import lexiconData from "./data/lexicon.json?gzip";
import { unpackData } from "./ui/compressed-data";
import functionWordsData from "./data/function-words.json";
import hedgingData from "./data/epistemic-hedging.json";
import stereotypesData from "./data/stereotypes.json";
import syntaxHingesData from "./data/syntax-hinges.json";

const analysisModes: Array<{ mode: FinitionMode; name: string; icon: string }> = [
	{ mode: "repetition", name: "Répétitions", icon: "repeat" },
	{ mode: "hedging", name: "Atténuation", icon: "shield-question" },
	{ mode: "stereotype", name: "Stéréotypes", icon: "sparkles" },
	{ mode: "burstiness", name: "Monotonie", icon: "activity" },
	{ mode: "ternary", name: "Tricolons", icon: "git-branch" },
	{ mode: "cadence", name: "Cadence", icon: "waves" },
	{ mode: "hinges", name: "Charnières", icon: "link" },
];

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
	private documentCountEl: HTMLElement | null = null;
	private documentCountCache: { text: string; words: number; characters: number } | null = null;
	private analysisNavigation: AnalysisNavigation | null = null;
	private ticIAPercentage: HTMLElement | null = null;
	private ticIAStats = new WeakMap<EditorView, { doc: EditorView["state"]["doc"]; tagged: number; total: number; pending: boolean }>();

	// Suggestions "Corrections IA" en attente de validation (clic). Vivent
	// uniquement en mémoire, jamais persistées : elles ne modifient le
	// document que lorsque l'utilisateur clique dessus (voir ai-extension.ts).
	aiGroups: AIGroup[] = [];
	aiGroupsVersion = 0;
	aiSourcePath: string | null = null;
	private nextAiGroupId = 0;

	// Erreurs Grammalecte de la dernière analyse (toute la note). Comme pour
	// Corrections IA, vit uniquement en mémoire : la correction n'est
	// appliquée qu'au clic sur une suggestion (voir grammalecte-extension.ts).
	grammalecteErrors: GrammalecteError[] = [];
	grammalecteErrorsVersion = 0;
	private grammalecteEngine: GrammalecteEngine | null = null;
	private finitionCorrectorEngine: FinitionCorrectorEngine | null = null;
	private spellingRequest = 0;
	private linguisticResources: LinguisticResources | null = null;
	private neuralModels: NeuralModels | null = null;
	wordDictionaries: WordDictionaries | null = null;
	private synonymsDictionary: SynonymsDictionary | null = null;
	private personalSynonymsAvailable = false;
	private availableSynonymDictionaries: Array<SynonymMetadata & { id: string }> = [];

	// Les catégories syntaxiques partagent le moteur choisi pour Corrections.
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
		await this.loadLinguisticResources();
		if (!this.hasAnalysisResources && this.settings.mode === "ternary") this.settings.mode = "none";
		await this.loadLexiconData();
		this.applyPalette();
		this.setupStatusBarItem();
		this.registerEditorExtension(finitionEditorExtension(this));
		this.registerEditorExtension(finitionAIExtension(this));
		this.registerEditorExtension(finitionGrammalecteExtension(this));
		this.addSettingTab(new FinitionSettingTab(this.app, this));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateStatusBarIcon()));
		this.registerEvent(this.app.workspace.on("editor-change", () => this.updateDocumentCounts()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.updateDocumentCounts()));

		for (const { mode, name } of analysisModes) this.addCommand({
			id: mode, name,
			checkCallback: checking => {
				if (mode === "ternary" && !this.hasAnalysisResources) return false;
				if (!checking) void this.setMode(mode);
				return true;
			},
		});
		for (const engine of resourceEngines) this.addCommand({
			id: engine === "grammalecte" ? "grammalecte" : "neural", name: resourceLabels[engine],
			checkCallback: checking => {
				if (!this.isLinguisticEngineInstalled(engine)) return false;
				if (!checking) void this.runSpellingEngine(engine);
				return true;
			},
		});
		this.addCommand({ id: "corrections-ia", name: "Corrections IA", callback: () => this.toggleOrthoTypoIA() });
		this.addCommand({ id: "settings", name: "Paramètres", callback: () => this.openSettingsTab() });

		this.addCommand({
			id: "synonymes-ia",
			name: "Synonymes IA",
			callback: () => runSynonyms(this.app, this.settings),
		});
		this.addCommand({ id: "synonyme", name: "Synonyme", callback: () => this.runSynonymsLocal() });
		for (const kind of dictionaryKinds) this.addCommand({ id: kind, name: dictionaryLabels[kind], callback: () => this.runWordDictionary(kind) });

		this.addCommand({
			id: "punctuation-fix",
			name: "Ponctuations",
			callback: () => this.runPunctuationFix(),
		});

		this.addCommand({
			id: "corrections",
			name: "Corrections",
			callback: () => this.runGrammalecte(),
		});

		// En plus de l'entrée du menu de la barre de statut (parfois capricieux
		// à cliquer — plusieurs rapports utilisateur de clics sans effet) :
		// une commande fiable, accessible via la palette de commandes.
		this.addCommand({
			id: "structure-report",
			name: "Structure",
			checkCallback: (checking) => {
				if (!this.settings.debugMode || !this.hasAnalysisResources) return false;
				if (!checking) void this.runStructureReport();
				return true;
			},
		});
	}

	onunload(): void {
		document.body.classList.remove("finition-hide-backlinks-count");
		this.spellingRequest++;
		this.finitionCorrectorEngine?.destroy();
		this.analysisNavigation?.destroy();
		for (let index = 0; index < this.settings.palette.length; index++) {
			document.body.style.removeProperty(`--finition-color-${index}`);
		}
		this.grammalecteEngine?.destroy();
		if (this.categoryFetchTimer !== null) window.clearTimeout(this.categoryFetchTimer);
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<FinitionSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
		if (!["none", "words", "characters", "both"].includes(this.settings.documentCountDisplay)) this.settings.documentCountDisplay = "none";
		this.settings.hideBacklinksCount = this.settings.hideBacklinksCount === true;
		document.body.classList.toggle("finition-hide-backlinks-count", this.settings.hideBacklinksCount);
		const unknownEngine = !resourceEngines.includes(this.settings.spellingEngine);
		if (unknownEngine) this.settings.spellingEngine = "grammalecte";
		if (!saved?.analysisEngine || !resourceEngines.includes(saved.analysisEngine)) this.settings.analysisEngine = this.settings.spellingEngine;
		this.settings.spellingNeural = this.settings.spellingNeural === true;
		if (typeof this.settings.neuralModel !== "string") this.settings.neuralModel = "auto";
		const previousPacks = this.settings.resourcePacks && typeof this.settings.resourcePacks === "object" && !Array.isArray(this.settings.resourcePacks) ? this.settings.resourcePacks : {};
		this.settings.resourcePacks = Object.fromEntries(Object.entries(previousPacks).filter(([engine]) => resourcePacks.some(value => value === engine)));
		if (typeof this.settings.synonymDictionaryPath !== "string") this.settings.synonymDictionaryPath = "";
		this.settings.synonymDictionaries = Array.isArray(this.settings.synonymDictionaries)
			? this.settings.synonymDictionaries.filter((entry, index, entries) => entry && typeof entry.path === "string" && this.isSynonymCopy(entry.path)
				&& typeof entry.name === "string" && entry.name.trim().length > 0 && entry.name.length <= 100
				&& entries.findIndex(other => other?.path === entry.path) === index).map(entry => ({ path: entry.path, name: entry.name,
					...(typeof entry.description === "string" && entry.description.length <= 1000 ? { description: entry.description } : {}),
					...(isSynonymDocumentation(entry.documentation) ? { documentation: entry.documentation } : {}),
				})) : [];
		// Object.assign() est superficiel : si data.json ne contenait pas
		// encore `savedPrompts` (installation antérieure à la bibliothèque de
		// prompts), this.settings.savedPrompts pointerait vers EXACTEMENT le
		// même tableau que DEFAULT_SETTINGS.savedPrompts — un push()/filter()
		// ultérieur (Enregistrer/Supprimer) modifierait alors les valeurs par
		// défaut elles-mêmes pour le reste de la session. On clone donc
		// systématiquement les entrées pour obtenir un tableau indépendant.
		this.settings.savedPrompts = (this.settings.savedPrompts ?? []).map((p) => ({ ...p }));
		let needsPersist = this.ensureBuiltinPrompts() || unknownEngine || Object.keys(previousPacks).length !== Object.keys(this.settings.resourcePacks).length;
		if (this.settings.mode === "tic-ia") {
			this.settings.mode = "ternary";
			needsPersist = true;
		}
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
		document.body.classList.toggle("finition-hide-backlinks-count", this.settings.hideBacklinksCount);
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
	async loadLexiconData(): Promise<void> {
		if (!this.lexicon.size) this.lexicon = new Map(Object.entries(await unpackData<Record<string, string>>(lexiconData)));
		this.functionWords = new Set(functionWordsData);
		// Une liste éditée manuellement dans les réglages prend le pas sur
		// celle bundlée par défaut.
		if (this.settings.customStopWords !== null) {
			this.functionWords = parseStopWords(this.settings.customStopWords);
		}
		this.hedgingPhrases = hedgingData;
		this.stereotypePatterns = stereotypesData;
		this.syntaxHinges = syntaxHingesData;
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
		const icon = this.statusBarItem.createSpan({ cls: "finition-status-icon", attr: { "aria-label": "Finition" } });
		setIcon(icon, "music");
		this.documentCountEl = this.statusBarItem.createSpan({ cls: "finition-document-count" });
		this.statusBarItem.prepend(this.documentCountEl);
		this.ticIAPercentage = this.statusBarItem.createSpan();
		this.analysisNavigation = new AnalysisNavigation(this, this.statusBarItem);
		this.updateStatusBarIcon();
		this.registerDomEvent(this.statusBarItem, "click", (evt) => this.showModeMenu(evt));
	}

	updateStatusBarIcon(): void {
		this.updateDocumentCounts();
		const stats = this.activeTicIAStats();
		this.ticIAPercentage?.setText(this.settings.mode === "tic-ia" ? ` ${stats && !stats.pending ? `${(stats.total ? stats.tagged * 100 / stats.total : 0).toFixed(1)} %` : "…"}` : "");
		this.statusBarItem?.querySelector(".finition-status-icon")?.setAttribute("aria-label", this.settings.mode === "tic-ia" && stats
			? `Tic IA : ${stats.tagged}/${stats.total} phrases avec des procédés à relire. Ce score n'est pas une probabilité d'origine IA.` : "Finition");
		this.analysisNavigation?.refresh();
	}

	updateDocumentCounts(): void {
		if (!this.documentCountEl) return;
		const display = this.settings.documentCountDisplay;
		const markdown = display === "none" ? null : this.app.workspace.getActiveViewOfType(MarkdownView);
		this.documentCountEl.hidden = !markdown;
		if (!markdown) { this.documentCountCache = null; return; }
		const text = markdown.editor.getValue();
		const counts = this.documentCountCache?.text === text ? this.documentCountCache : this.documentCountCache = { text, ...countDocument(text) };
		this.documentCountEl.title = `${counts.words.toLocaleString("fr-FR")} mot${counts.words === 1 ? "" : "s"} · ${counts.characters.toLocaleString("fr-FR")} signe${counts.characters === 1 ? "" : "s"} (espaces compris)`;
		const values: string[] = [];
		if (display === "words" || display === "both") values.push(formatDocumentCount(counts.words, "mot"));
		if (display === "characters" || display === "both") values.push(formatDocumentCount(counts.characters, "signe"));
		this.documentCountEl.setText(values.join(" · "));
	}

	updateAnalysisHighlights(view: EditorView, highlights: Highlight[], pending: boolean): void {
		this.analysisNavigation?.update(view, highlights, pending);
	}

	updateGrammalecteHighlights(view: EditorView, highlights: Pick<Highlight, "from">[]): void {
		this.analysisNavigation?.updateGrammalecte(view, highlights);
	}

	updateTicIAStats(view: EditorView, tagged: number, total: number, pending: boolean): void {
		this.ticIAStats.set(view, { doc: view.state.doc, tagged, total, pending });
		this.updateStatusBarIcon();
	}

	private activeTicIAStats() {
		const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
		const view = (markdown?.editor as { cm?: EditorView } | undefined)?.cm;
		if (!view) return undefined;
		const stats = this.ticIAStats.get(view);
		return stats?.doc === view.state.doc ? stats : undefined;
	}

	/** Change de mode, en désactivant systématiquement les autres (exclusif). */
	async setMode(mode: FinitionMode): Promise<void> {
		if (mode === "ternary" && this.settings.mode !== mode && !this.hasAnalysisResources) {
			new Notice("Téléchargez un moteur linguistique dans les paramètres de Finition.");
			return;
		}
		// Recliquer sur le mode déjà actif l'éteint (retour à "none").
		this.settings.mode = this.settings.mode === mode ? "none" : mode;
		this.analysisNavigation?.requestFirst();
		await this.saveSettings();
		this.updateStatusBarIcon();
		this.refreshAllEditors();
	}

	private async runSpellingEngine(engine: ResourceEngine): Promise<void> {
		if (!this.isLinguisticEngineInstalled(engine)) return;
		if (this.settings.spellingEngine === engine && this.grammalecteErrors.length > 0) { await this.runGrammalecte(); return; }
		if (engine === "finition-corrector") this.settings.spellingNeural = true;
		await this.setSpellingEngine(engine);
		await this.runGrammalecte();
	}

	private showModeMenu(evt: MouseEvent): void {
		const menu = new Menu();

		for (const { mode, name, icon } of analysisModes) menu.addItem(item => item
			.setTitle(name).setIcon(icon)
			.setDisabled(mode === "ternary" && !this.hasAnalysisResources)
			.setChecked(this.settings.mode === mode)
			.onClick(() => this.setMode(mode)));

		menu.addSeparator();

		for (const engine of resourceEngines) {
			const installed = this.isLinguisticEngineInstalled(engine);
			menu.addItem(item => item
				.setTitle(resourceLabels[engine])
				.setIcon(engine === "grammalecte" ? "book-open" : "brain")
				.setDisabled(!installed)
				.setChecked(installed && this.settings.spellingEngine === engine && this.grammalecteErrors.length > 0)
				.onClick(() => this.runSpellingEngine(engine)));
		}

		menu.addItem((item) =>
			item
				.setTitle("Corrections IA")
				.setIcon("bot")
				.setChecked(this.aiGroups.length > 0)
				.onClick(() => this.toggleOrthoTypoIA())
		);
		menu.addSeparator();

		menu.addItem(item => item.setTitle("Synonyme").setIcon("book-open")
			.setDisabled(!this.hasSynonyms)
			.onClick(() => this.runSynonymsLocal()));
		menu.addItem((item) =>
			item.setTitle("Synonymes IA").setIcon("book-open").onClick(() => runSynonyms(this.app, this.settings))
		);
		for (const kind of dictionaryKinds) menu.addItem(item => item.setTitle(dictionaryLabels[kind]).setIcon("book-open")
			.setDisabled(!this.wordDictionaries?.has(kind)).onClick(() => this.runWordDictionary(kind)));

		menu.addItem((item) =>
			item
				.setTitle("Ponctuations")
				.setIcon("quote")
				.onClick(() => this.runPunctuationFix())
		);

		if (this.settings.debugMode) menu.addItem((item) =>
			item
				.setTitle("Structure")
				.setIcon("list-tree")
				.setDisabled(!this.hasAnalysisResources)
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
	 * Bascule Corrections IA : si des suggestions sont déjà affichées, un
	 * reclic les efface simplement (décoché) sans relancer d'analyse ;
	 * sinon, lance une nouvelle analyse (coché).
	 */
	private async toggleOrthoTypoIA(): Promise<void> {
		if (this.aiGroups.length > 0) {
			this.spellingRequest++;
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
			new Notice(`Corrections IA : renseigne ta clé API ${providerLabel} dans Réglages → Finition.`);
			return;
		}
		const request = ++this.spellingRequest;
		const document = editor.getValue();
		this.grammalecteErrors = [];
		this.grammalecteErrorsVersion++;

		// Efface implicitement les suggestions d'un lancement précédent —
		// pas besoin d'une commande "reset" séparée : relancer Corrections IA
		// repart simplement à zéro.
		this.clearAISuggestions();

		this.aiSourcePath = view.file?.path ?? null;
		const selectionFrom = editor.posToOffset(editor.getCursor("from"));
		const original = editor.getSelection();
		const chunks = splitIntoChunks(original, this.settings.aiChunkSize);
		const links = markdownLinks(document);
		const debugMode = this.settings.debugMode;
		const debugChunks: string[] = [];

		// Une seule notification, mise à jour à chaque tronçon (via
		// setMessage) plutôt qu'un message figé affiché une fois pour toutes
		// au début — sinon rien ne permet de suivre ce qui se passe pendant
		// l'attente des appels API, potentiellement longs.
		const progress = new Notice(`Corrections IA : tronçon 1/${chunks.length}...`, 0);
		const errors: string[] = [];

		// try/finally : si quoi que ce soit plante de façon inattendue (pas
		// seulement les erreurs API déjà gérées une par une plus bas), la
		// notification de progression se ferme quand même et l'erreur
		// s'affiche, au lieu de laisser croire que le plugin est resté bloqué.
		try {
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				progress.setMessage(`Corrections IA : tronçon ${i + 1}/${chunks.length}...`);
				if (chunk.text.trim().length === 0) continue;
				const reviseChunk = provider === "openai" ? reviseChunkWithRetryOpenAI : reviseChunkWithRetryAnthropic;
				const start = selectionFrom + chunk.start;
				const protectedText = protectLinks(document, start, start + chunk.text.length, links);
				if (!protectedText.text.trim()) continue;
				const { text: revisedRaw, error } = await reviseChunk(protectedText.text, this.settings.aiPrompt, {
					apiKey,
					model: this.settings.aiModel,
					maxTokens: this.settings.aiMaxTokens,
				});
				if (request !== this.spellingRequest || document !== editor.getValue() || this.app.workspace.getActiveViewOfType(MarkdownView) !== view) return;
				if (error) {
					// Échec sur ce tronçon : on garde le texte d'origine (pas de
					// fausse correction), mais on prévient — plutôt que de laisser
					// croire silencieusement qu'"aucune correction" n'était nécessaire.
					errors.push(`Tronçon ${i + 1}/${chunks.length} : ${error}`);
					continue;
				}
				if (debugMode) debugChunks.push(revisedRaw);
				const groups = protectedText.diff(revisedRaw);
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
			if (debugMode && errors.length === 0 && debugChunks.length) await this.createDebugNote(view, debugChunks.join("\n\n"), "");
		} catch (e) {
			errors.push(`Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			progress.hide();
		}

		if (errors.length > 0) {
			new Notice(`Corrections IA : ${errors.length} erreur(s).\n${errors[0]}`, 12000);
			console.error("Corrections IA : erreurs détaillées", errors);
		}
		if (this.aiGroups.length === 0 && errors.length === 0) {
			new Notice("Corrections IA : aucune correction proposée.");
		} else if (this.aiGroups.length > 0) {
			new Notice(
				`Corrections IA : ${this.aiGroups.length} suggestion(s). Clique sur le texte en couleur pour valider.`
			);
		}
	}

	/**
	 * Corrige instantanément les espaces insécables et tirets de la
	 * sélection (règles déterministes, voir punctuation.ts) : contrairement
	 * à Corrections IA, pas de validation au cas par cas, le document est
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

	/** Crée le Worker Grammalecte au premier besoin (Grammalecte OU Cadence "grammalecte"), une seule fois. */
	private async ensureGrammalecteEngine(): Promise<GrammalecteEngine> {
		if (!this.grammalecteEngine) {
			this.grammalecteEngine = new GrammalecteEngine(file => this.readLinguisticAsset("grammalecte", file));
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
		if (!this.hasAnalysisResources) return;
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
			const generation = this.wordCategoryCacheVersion;
			const engine = await this.ensureSpellingEngine(this.settings.analysisEngine);
			const result = await engine.getCategories(toFetch);
			if (generation !== this.wordCategoryCacheVersion) return;
			for (const [word, category] of Object.entries(result)) {
				this.wordCategoryCache.set(word, category);
			}
			this.wordCategoryCacheVersion++;
			this.refreshAllEditors();
		} catch (e) {
			console.error("Finition — Cadence (Grammalecte) : impossible de résoudre les catégories.", e);
		}
	}

	async setSpellingEngine(engine: FinitionSettings["spellingEngine"]): Promise<void> {
		if (!resourceEngines.includes(engine)) throw new Error("Moteur orthographique inconnu.");
		this.settings.spellingEngine = engine;
		if (this.finitionCorrectorEngine) this.finitionCorrectorEngine.neuralEnabled = engine === "finition-corrector" && this.settings.spellingNeural;
		this.spellingRequest++;
		this.grammalecteErrors = [];
		this.grammalecteErrorsVersion++;
		this.resetWordCategories();
		if (!this.hasAnalysisResources && this.settings.mode === "ternary") this.settings.mode = "none";
		this.refreshAllEditors();
		await this.saveSettings();
	}

	private resetWordCategories(): void {
		this.wordCategoryCache.clear();
		this.wordCategoryCacheVersion++;
		this.pendingCategoryWords.clear();
		if (this.categoryFetchTimer !== null) window.clearTimeout(this.categoryFetchTimer);
		this.categoryFetchTimer = null;
	}

	async setAnalysisEngine(engine: ResourceEngine): Promise<void> {
		if (!resourceEngines.includes(engine) || !this.isLinguisticEngineInstalled(engine)) throw new Error("Dictionnaire d’analyse indisponible.");
		const previous = this.settings.analysisEngine;
		this.settings.analysisEngine = engine;
		try { await this.saveSettings(); }
		catch (error) { this.settings.analysisEngine = previous; throw error; }
		this.resetWordCategories();
		this.refreshAllEditors();
	}

	get hasAnalysisResources(): boolean { return this.linguisticResources?.available(this.settings.analysisEngine) ?? false; }
	get hasLinguisticResources(): boolean { return this.linguisticResources?.available(this.settings.spellingEngine) ?? false; }
	get neuralModelOptions(): Array<SynonymMetadata & { id: string }> { return this.neuralModels?.options ?? []; }
	async setNeuralModel(id: string): Promise<void> {
		await this.loadLinguisticResources();
		if (!this.neuralModels) throw new Error("Dossier du plugin introuvable.");
		this.neuralModels.reader(id);
		const previous = this.settings.neuralModel;
		this.settings.neuralModel = id;
		try { await this.saveSettings(); }
		catch (error) { this.settings.neuralModel = previous; throw error; }
		this.finitionCorrectorEngine?.destroy();
		this.finitionCorrectorEngine = null;
		await this.setSpellingEngine(this.settings.spellingEngine);
	}
	async importNeuralModel(read: (file: string) => Promise<ArrayBuffer>): Promise<void> {
		await this.loadLinguisticResources();
		if (!this.neuralModels) throw new Error("Dossier du plugin introuvable.");
		const id = await this.neuralModels.import(read);
		await this.setNeuralModel(id);
		if (this.isLinguisticEngineInstalled("finition-corrector")) {
			this.settings.spellingNeural = true;
			await this.setSpellingEngine("finition-corrector");
		}
	}
	async setNeuralModelPath(path: string): Promise<void> {
		path = path.trim().replace(/\/$/u, "");
		const adapter = this.app.vault.adapter;
		if (path.startsWith("/") && adapter instanceof FileSystemAdapter) {
			const prefix = adapter.getBasePath().replace(/\/$/u, "") + "/";
			if (path.startsWith(prefix)) path = path.slice(prefix.length);
		}
		path = personalSynonymPath(path.endsWith("pack.json") ? path : `${path}/pack.json`);
		if (path.split("/").at(-1) !== "pack.json") throw new Error("Choisis le dossier contenant pack.json.");
		const directory = path.slice(0, -"pack.json".length);
		await this.importNeuralModel(async file => {
			const source = directory + file;
			const stat = await adapter.stat(source);
			if (stat?.type !== "file" || stat.size < 1 || stat.size > (file === "pack.json" ? 16384 : neuralFileLimit)) throw new Error("Fichier du modèle absent ou trop volumineux.");
			return adapter.readBinary(source);
		});
	}
	async removeNeuralModel(id: string): Promise<void> {
		await this.loadLinguisticResources();
		if (!this.neuralModels || !this.neuralModelOptions.some(model => model.id === id)) throw new Error("Sélectionne un modèle installé à effacer.");
		const previous = this.settings.neuralModel;
		const active = previous === id || (previous === "auto" && this.neuralModelOptions[0]?.id === id);
		if (active) await this.setNeuralModel("");
		try { await this.neuralModels.remove(id); }
		catch (error) { if (active) await this.setNeuralModel(previous); throw error; }
	}
	get hasSynonyms(): boolean { return this.settings.synonymDictionaryPath ? this.personalSynonymsAvailable : this.isLinguisticEngineInstalled("synonymes"); }
	get synonymDictionaryOptions(): Array<SynonymMetadata & { id: string }> {
		return [...(this.isLinguisticEngineInstalled("synonymes") ? [{ id: "", ...finitionSynonymMetadata }] : []), ...this.availableSynonymDictionaries];
	}
	private isSynonymCopy(path: string): boolean {
		if (!this.manifest?.dir) return false;
		const prefix = `${this.manifest?.dir}/data/synonymes-`;
		return path.startsWith(prefix) && /^[a-f0-9]{64}\/data\.json$/u.test(path.slice(prefix.length));
	}
	async setSynonymDictionary(id: string): Promise<void> {
		await this.refreshSynonymDictionaries();
		if (!this.synonymDictionaryOptions.some(option => option.id === id)) throw new Error("Dictionnaire indisponible.");
		await this.selectSynonymDictionary(id);
	}
	async removeSynonymDictionary(path: string): Promise<void> {
		if (!this.isSynonymCopy(path) || !this.settings.synonymDictionaries.some(entry => entry.path === path)) throw new Error("Sélectionne un dictionnaire personnel à effacer.");
		const previous = this.settings.synonymDictionaries;
		const selected = this.settings.synonymDictionaryPath;
		const remaining = previous.filter(entry => entry.path !== path);
		const fallback = this.isLinguisticEngineInstalled("synonymes") ? "" : this.availableSynonymDictionaries.find(entry => entry.id !== path)?.id ?? "";
		await this.selectSynonymDictionary(selected === path ? fallback : selected, remaining);
		try { await this.app.vault.adapter.remove(path); }
		catch (error) { await this.selectSynonymDictionary(selected, previous); throw error; }
		await this.refreshSynonymDictionaries();
	}
	async setSynonymDictionaryPath(path: string): Promise<void> {
		path = path.trim();
		if (!path) { await this.selectSynonymDictionary(""); return; }
		const adapter = this.app.vault.adapter;
		if (path.startsWith("/") && adapter instanceof FileSystemAdapter) {
			const prefix = adapter.getBasePath().replace(/\/$/u, "") + "/";
			if (path.startsWith(prefix)) path = path.slice(prefix.length);
		}
		path = personalSynonymPath(path);
		const stat = await adapter.stat(path);
		if (stat?.type !== "file" || stat.size < 1 || stat.size > synonymFileLimit) throw new Error("Choisis un dictionnaire JSON existant de 128 Mio maximum.");
		await this.importSynonymDictionary(await adapter.readBinary(path));
	}
	async importSynonymDictionary(raw: ArrayBuffer): Promise<void> {
		if (!this.manifest.dir) throw new Error("Dossier du plugin introuvable.");
		if (!raw.byteLength || raw.byteLength > synonymFileLimit) throw new Error("Choisis un dictionnaire JSON de 128 Mio maximum.");
		const dictionary = parseSynonymDictionary(new TextDecoder("utf-8", { fatal: true }).decode(raw));
		const hash = await resourceHash(raw);
		const root = `${this.manifest.dir}/data`;
		const directory = `${root}/synonymes-${hash}`;
		const destination = `${directory}/data.json`;
		const adapter = this.app.vault.adapter;
		if (!await adapter.exists(destination)) {
			for (const path of [root, directory]) if (!await adapter.exists(path)) await adapter.mkdir(path);
			await adapter.writeBinary(destination, raw);
		}
		if (await resourceHash(await adapter.readBinary(destination)) !== hash) throw new Error("Copie du dictionnaire incomplète ou altérée.");
		await this.selectSynonymDictionary(destination, [...this.settings.synonymDictionaries.filter(entry => entry.path !== destination), { path: destination, name: dictionary.name,
			...(dictionary.description !== undefined ? { description: dictionary.description } : {}),
			...(dictionary.documentation ? { documentation: dictionary.documentation } : {}),
		}]);
		await this.refreshSynonymDictionaries();
	}
	private async selectSynonymDictionary(path: string, dictionaries = this.settings.synonymDictionaries): Promise<void> {
		const previous = this.settings.synonymDictionaryPath;
		const previousDictionaries = this.settings.synonymDictionaries;
		this.settings.synonymDictionaryPath = path;
		this.settings.synonymDictionaries = dictionaries;
		try { await this.saveSettings(); }
		catch (error) { this.settings.synonymDictionaryPath = previous; this.settings.synonymDictionaries = previousDictionaries; throw error; }
		this.synonymsDictionary = null;
		this.personalSynonymsAvailable = Boolean(path);
	}
	private async refreshSynonymDictionaries(): Promise<void> {
		const available: Array<SynonymMetadata & { id: string }> = [];
		for (const entry of this.settings.synonymDictionaries) {
			try {
				const stat = await this.app.vault.adapter.stat(entry.path);
				if (stat?.type === "file" && stat.size > 0 && stat.size <= synonymFileLimit) available.push({ ...entry, id: entry.path });
			} catch { /* Un dictionnaire absent reste hors de la liste. */ }
		}
		this.availableSynonymDictionaries = available;
		this.personalSynonymsAvailable = available.some(entry => entry.id === this.settings.synonymDictionaryPath);
	}
	async runSynonymsLocal(): Promise<void> {
		if (!this.hasSynonyms) { new Notice("Synonyme : télécharge un dictionnaire dans les réglages de Finition."); return; }
		this.synonymsDictionary ??= new SynonymsDictionary(() => this.settings.synonymDictionaryPath
			? this.app.vault.adapter.readBinary(personalSynonymPath(this.settings.synonymDictionaryPath))
			: this.readLinguisticAsset("synonymes", "synonymes.json"));
		await runLocalSynonyms(this.app, this.synonymsDictionary);
	}
	isLinguisticEngineInstalled(engine: ResourcePack): boolean { return this.linguisticResources?.available(engine) ?? false; }
	async runWordDictionary(kind: DictionaryKind): Promise<void> {
		await runLocalWordLookup(this.app, dictionaryLabels[kind], async word => {
			if (!this.wordDictionaries) throw new Error("Charge un dictionnaire dans les réglages de Finition.");
			const { dictionary, rows } = await this.wordDictionaries.lookup(kind, word);
			return kind === "antonymes" || kind === "rimes"
				? { groups: rows.filter(row => row.words?.length).map(row => ({ category: "", label: row.label ?? "", words: row.words!, sources: [] })) }
				: { rows, description: dictionary.encoding === "phonetic-internal" ? "Notation phonétique interne du dictionnaire (non API)." : undefined };
		});
	}
	async setWordDictionaryPath(kind: DictionaryKind, path: string): Promise<void> {
		path = path.trim();
		const adapter = this.app.vault.adapter;
		if (path.startsWith("/") && adapter instanceof FileSystemAdapter) {
			const prefix = adapter.getBasePath().replace(/\/$/u, "") + "/";
			if (path.startsWith(prefix)) path = path.slice(prefix.length);
		}
		if (!this.wordDictionaries) throw new Error("Dossier du plugin introuvable.");
		await this.wordDictionaries.importPath(kind, path);
	}
	async loadLinguisticResources(): Promise<void> {
		if (!this.manifest.dir) return;
		this.linguisticResources ??= new LinguisticResources(this.app.vault.adapter, this.manifest.dir, this.manifest.version);
		await this.linguisticResources.refresh(this.settings.resourcePacks);
		this.neuralModels ??= new NeuralModels(this.app.vault.adapter, this.manifest.dir);
		await this.neuralModels.refresh();
		if (this.settings.synonymDictionaryPath && !this.settings.synonymDictionaries.some(entry => entry.path === this.settings.synonymDictionaryPath)) {
			try {
				await this.setSynonymDictionaryPath(this.settings.synonymDictionaryPath);
			} catch { /* Un ancien dictionnaire absent ou incompatible reste désactivé. */ }
		}
		await this.refreshSynonymDictionaries();
		this.wordDictionaries ??= new WordDictionaries(this.app.vault.adapter, this.manifest.dir, () => this.settings, () => this.saveSettings(), this.linguisticResources);
		await this.wordDictionaries.refresh();
	}
	private async readLinguisticAsset(engine: ResourcePack, file: string): Promise<ArrayBuffer> {
		if (!this.linguisticResources?.available(engine)) await this.loadLinguisticResources();
		if (!this.linguisticResources) throw new Error("Dossier du plugin introuvable.");
		return this.linguisticResources.read(engine, file);
	}
	async downloadLinguisticResources(engine: ResourcePack, progress: (text: string) => void): Promise<void> {
		await this.loadLinguisticResources();
		if (!this.linguisticResources) throw new Error("Dossier du plugin introuvable.");
		const revision = await this.linguisticResources.install(engine, progress);
		const previous = this.settings.resourcePacks;
		this.settings.resourcePacks = { ...previous, [engine]: revision };
		try { await this.saveSettings(); }
		catch (error) { this.settings.resourcePacks = previous; throw error; }
		await this.loadLinguisticResources();
		if (!this.linguisticResources.available(engine)) throw new Error("Installation incomplète. Relancez le téléchargement.");
		if (engine === "synonymes") { this.synonymsDictionary = null; return; }
		if (engine !== "grammalecte" && engine !== "finition-corrector") {
			if (!this.wordDictionaries) throw new Error("Dossier du plugin introuvable.");
			await this.wordDictionaries.select(engine, "");
			return;
		}
		this.finitionCorrectorEngine?.destroy();
		this.grammalecteEngine?.destroy();
		if (engine === "finition-corrector") this.settings.spellingNeural = true;
		await this.setSpellingEngine(engine);
	}
	private async ensureSpellingEngine(engine: ResourceEngine = this.settings.spellingEngine): Promise<Pick<GrammalecteEngine, "parse" | "getCategories">> {
		if (engine !== "finition-corrector") return this.ensureGrammalecteEngine();
		if (!this.finitionCorrectorEngine) {
			const specialized = this.neuralModels?.reader(this.settings.neuralModel);
			this.finitionCorrectorEngine = new FinitionCorrectorEngine(file => file.startsWith("electra/") && specialized ? specialized(file) : this.readLinguisticAsset("finition-corrector", file));
			this.finitionCorrectorEngine.specializedEnabled = Boolean(specialized);
		}
		this.finitionCorrectorEngine.neuralEnabled = this.settings.spellingNeural;
		return this.finitionCorrectorEngine;
	}

	private async runGrammalecte(): Promise<void> {
		if (this.grammalecteErrors.length > 0) {
			this.spellingRequest++;
			this.grammalecteErrors = [];
			this.grammalecteErrorsVersion++;
			this.refreshAllEditors();
			return;
		}
		if (!this.hasLinguisticResources) { new Notice("Téléchargez un moteur linguistique dans les paramètres de Finition."); return; }
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;
		const document = editor.getValue();
		const from = editor.posToOffset(editor.getCursor("from"));
		const to = editor.posToOffset(editor.getCursor("to"));
		const request = ++this.spellingRequest;

		// Grammalecte souligne lui-même le texte (rouge/bleu) : le cumul avec
		// un mode de surlignage continu (Répétition, Monotonie, Cadence,
		// Tricolon...) ou avec des suggestions Corrections IA encore en attente
		// rendrait le texte illisible. On désactive donc tout le reste au
		// lancement, comme le changement de mode le fait déjà normalement.
		if (this.settings.mode !== "none") {
			this.settings.mode = "none";
			await this.saveSettings();
		}
		if (this.aiGroups.length > 0) {
			this.clearAISuggestions();
		}

		const label = this.settings.spellingEngine === "finition-corrector" && this.settings.spellingNeural ? "Correction neurale" : "Corrections";
		const notice = new Notice(loadingMessage(label), 0);
		const publish = (rawErrors: GrammalecteError[]): boolean => {
			if (request !== this.spellingRequest || document !== editor.getValue() || this.app.workspace.getActiveViewOfType(MarkdownView) !== view) return false;
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
			return true;
		};
		try {
			const engine = await this.ensureSpellingEngine();
			const rawErrors = await analyzeCorrections(engine, document, from, to, publish);
			if (!publish(rawErrors)) { notice.hide(); return; }
			notice.hide();
			if (this.grammalecteErrors.length === 0) {
				new Notice(`${label} : aucune suggestion.`);
			} else {
				new Notice(`${label} : ${this.grammalecteErrors.length} suggestion(s).`);
			}
		} catch (e) {
			notice.hide();
			new Notice(`${label} : erreur — ${e instanceof Error ? e.message : String(e)}`, 10000);
			console.error(`Finition — ${label} :`, e);
		}
	}

	private async createDebugNote(view: MarkdownView, content: string, prefix: string): Promise<TFile> {
		if (!hasResponseText(content)) throw new Error("Aucun texte à enregistrer : note horodatée non créée.");
		const source = view.file;
		const folder = source?.parent?.path && source.parent.path !== "/" ? `${source.parent.path}/` : "";
		const pad = (number: number) => String(number).padStart(2, "0");
		const now = new Date();
		const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
		const base = `${folder}${prefix}${source?.basename ?? "sans titre"} (${timestamp})`;
		let path = `${base}.md`;
		for (let suffix = 2; this.app.vault.getAbstractFileByPath(path); suffix++) path = `${base} ${suffix}.md`;
		const file = await this.app.vault.create(path, content);
		if (await this.app.vault.read(file) !== content) {
			await this.app.vault.process(file, saved => hasResponseText(saved) ? saved : content);
			if (await this.app.vault.read(file) !== content) throw new Error(`Le contenu de la note horodatée n’a pas été conservé : ${path}`);
		}
		return file;
	}

	/**
	 * Commande "Structure" : génère, dans une NOUVELLE note, l'encodage
	 * syntaxique coloré de chaque phrase du document actif (voir
	 * modes/structure-report.ts) — un outil de lecture seule pour comprendre
	 * comment Cadence et Tricolons analysent le texte, sans jamais toucher
	 * au document d'origine.
	 */

	private async runStructureReport(): Promise<void> {
		if (!this.settings.debugMode) return;
		if (!this.hasAnalysisResources) { new Notice("Téléchargez un moteur linguistique dans les paramètres de Finition."); return; }
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			// Garde auparavant silencieuse : aucune erreur console, aucun
			// message — ressemblait exactement à "rien ne se passe" alors
			// qu'il n'y avait tout simplement pas de note Markdown active au
			// moment du clic/raccourci (focus ailleurs, palette de
			// commandes qui vient de se refermer sans avoir redonné le
			// focus à l'éditeur, etc.).
			new Notice("Structure : aucune note active. Clique d’abord dans le texte, puis relance.", 6000);
			return;
		}
		const text = view.editor.getValue();

		const notice = new Notice("Structure : chargement du moteur linguistique...", 0);
		try {
			const engine = await this.ensureSpellingEngine(this.settings.analysisEngine);
			notice.setMessage("Structure : analyse en cours...");

			const categories = await engine.getCategories(structureCategoryWords(text));
			const getCategory = (word: string) => categories[word.toLowerCase()] ?? "";

			const content = buildStructureReport(text, getCategory);

			const file = await this.createDebugNote(view, content, "Structure — ");
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
		this.aiSourcePath = null;
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
