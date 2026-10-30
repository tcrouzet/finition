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
import type { MenuItem, TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import { lockAINote } from "./ai/note-lock";
import {
	addWordToDictionaryText,
	BUILTIN_PROMPTS,
	DEFAULT_PALETTE,
	DEFAULT_SETTINGS,
	FORM_TYPES,
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
import { resetCorrectionHistory } from "./ai/correction-history";
import { diffToGroups } from "./ai/diff";
import { splitIntoChunks } from "./ai/chunk";
import { protectLinks } from "./ai/protected-links";
import { hasResponseText } from "./ai/clean";
import { markdownLinks } from "./markdown-links";
import { reviseChunkWithRetryAnthropic } from "./ai/anthropic";
import { reviseChunkWithRetryOpenAI } from "./ai/openai";
import { cancelCodex, reviseChunkWithCodex } from "./ai/codex";
import { aiModelName, getAIConnection } from "./ai/provider";
import { cancelSynonyms, runSynonyms } from "./ai/synonyms";
import { fixPunctuationSpacing, fixBlankLinesProtected, fixApostrophesProtected } from "./modes/punctuation";
import { GrammalecteEngine, GrammalecteError } from "./modes/grammalecte";
import { FinitionCorrectorEngine } from "./modes/finition-corrector";
import type { LexicalData } from "./modes/finition-corrector";
import { emptyCopuleLexicon } from "./modes/copules";
import { analyzeCorrections } from "./modes/corrections";
import { closeGrammalectePopup, finitionGrammalecteExtension } from "./grammalecte-extension";
import { buildStructureReport } from "./modes/structure-report";
import { buildStatisticsReport, statisticsWords } from "./modes/statistics";
import { dictionaryFile, personalDictionaryFile, personalDictionaryPath } from "./lexicon/shared";
import { structureCategoryWords } from "./modes/structure-signature";
import { LoadingNotice } from "./ui/loading-message";
import { AnalysisNavigation, navigationFocus, setNavigationFocus } from "./ui/analysis-navigation";
import { countDocument, formatDocumentCount } from "./ui/document-count";
import { registerSingleNote } from "./ui/single-note";
import { registerNoteReset } from "./ui/note-reset";
import { NoteAnalyses, type NoteAnalysis } from "./note-analysis";
import { correctionGutter } from "./ui/correction-gutter";
import { addLeftSidebarToggle } from "./ui/left-sidebar-toggle";
import { LinguisticResources, resourceHash } from "./linguistic-resources";
import type { ResourceEngine, ResourcePack } from "./linguistic-files";
import { resourceEngines, resourceLabels, resourcePacks } from "./linguistic-files";
import { finitionSynonymMetadata, isSynonymDocumentation, parseSynonymDictionary, personalSynonymPath, synonymFileLimit, SynonymsDictionary, type DictionaryLemmas, type SynonymMetadata } from "./synonyms";
import { runLocalSynonyms, runLocalWordLookup } from "./ui/local-synonyms";
import { lookupFamily } from "./ui/family";
import { NeuralModels, neuralFileLimit } from "./neural-models";
import { dictionaryCommands, dictionaryLabels, WordDictionaries, type DictionaryKind } from "./dictionaries";
import { LexiconDictionaries } from "./lexicon/dictionaries";

// Les petites ressources stylistiques restent intégrées au plugin.
// Dictionnaires et modèles de correction se téléchargent séparément.
import functionWordsData from "./data/function-words.json";
import hedgingData from "./data/epistemic-hedging.json";
import stereotypesData from "./data/stereotypes.json";
import syntaxHingesData from "./data/syntax-hinges.json";

const analysisModes: Array<{ mode: FinitionMode; name: string; icon: string }> = [
	{ mode: "repetition", name: "Répétitions", icon: "repeat" },
	{ mode: "hedging", name: "Atténuations", icon: "shield-question" },
	{ mode: "stereotype", name: "Stéréotypes", icon: "sparkles" },
	{ mode: "burstiness", name: "Monotonies", icon: "activity" },
	{ mode: "ternary", name: "Tricolons", icon: "git-branch" },
	{ mode: "cadence", name: "Cadences", icon: "waves" },
	{ mode: "hinges", name: "Charnières", icon: "link" },
	{ mode: "formes", name: "Formes", icon: "message-circle-question" },
	{ mode: "copules", name: "Copules", icon: "highlighter" },
];

export default class FinitionPlugin extends Plugin implements FinitionRuntime {
	settings: FinitionSettings = DEFAULT_SETTINGS;
	lexicon: Map<string, string> = new Map();
	private dictionaryLemmaVariants = new Map<string, string[]>();
	copuleLexicon = emptyCopuleLexicon();
	private lexiconEngine: FinitionCorrectorEngine | null = null;
	private lexiconLoad: Promise<LexicalData> | undefined;
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
	updateSingleNote: () => void = () => {};
	private analysisNavigation: AnalysisNavigation | null = null;
	private settingsTab: FinitionSettingTab | null = null;
	private updateLeftSidebarToggle: () => void = () => {};
	private ticIAPercentage: HTMLElement | null = null;
	private ticIAStats = new WeakMap<EditorView, { doc: EditorView["state"]["doc"]; tagged: number; total: number; pending: boolean }>();

	// Suggestions "Corrections IA" en attente de validation (clic). Vivent
	// uniquement en mémoire, jamais persistées : elles ne modifient le
	// document que lorsque l'utilisateur clique dessus (voir ai-extension.ts).
	private noteAnalyses = new NoteAnalyses();
	private get correctionSource(): NoteAnalysis["correctionSource"] { return this.noteAnalyses.current.correctionSource; }
	private set correctionSource(value: NoteAnalysis["correctionSource"]) { this.noteAnalyses.current.correctionSource = value; }
	get aiGroups(): AIGroup[] { return this.noteAnalyses.current.aiGroups; }
	set aiGroups(value: AIGroup[]) { this.noteAnalyses.current.aiGroups = value; }
	get aiGroupsVersion(): number { return this.noteAnalyses.current.aiGroupsVersion; }
	set aiGroupsVersion(value: number) { this.noteAnalyses.current.aiGroupsVersion = value; }
	get aiSourcePath(): string | null { return this.noteAnalyses.current.aiSourcePath; }
	set aiSourcePath(value: string | null) { this.noteAnalyses.current.aiSourcePath = value; }
	private nextAiGroupId = 0;

	// Erreurs Grammalecte de la dernière analyse (toute la note). Comme pour
	// Corrections IA, vit uniquement en mémoire : la correction n'est
	// appliquée qu'au clic sur une suggestion (voir grammalecte-extension.ts).
	get grammalecteErrors(): GrammalecteError[] { return this.noteAnalyses.current.grammalecteErrors; }
	set grammalecteErrors(value: GrammalecteError[]) { this.noteAnalyses.current.grammalecteErrors = value; }
	get grammalecteErrorsVersion(): number { return this.noteAnalyses.current.grammalecteErrorsVersion; }
	set grammalecteErrorsVersion(value: number) { this.noteAnalyses.current.grammalecteErrorsVersion = value; }
	private grammalecteEngine: GrammalecteEngine | null = null;
	private finitionCorrectorEngine: FinitionCorrectorEngine | null = null;
	private spellingRequest = 0;
	private pendingCorrectionRequest: number | null = null;
	private unlockAINote: (() => void) | null = null;
	private analysisProgress: { notice: Notice; view: MarkdownView | null; mode?: FinitionMode } | null = null;
	private linguisticResources: LinguisticResources | null = null;
	private neuralModels: NeuralModels | null = null;
	wordDictionaries: WordDictionaries | null = null;
	lexiconDictionaries: LexiconDictionaries | null = null;
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
		this.updateSingleNote = registerSingleNote(this, () => this.settings.singleNoteOpen);
		await this.loadLinguisticResources();
		if (!this.isModeAvailable(this.settings.mode)) this.settings.mode = "none";
		await this.loadLexiconData(["repetition", "stereotype", "copules"].includes(this.settings.mode));
		this.applyPalette();
		this.setupStatusBarItem();
		this.noteAnalyses.activate(this.app.workspace.getActiveFile()).mode = this.settings.mode;
		this.registerEditorExtension(finitionEditorExtension(this));
		this.registerEditorExtension(navigationFocus);
		this.registerEditorExtension(finitionAIExtension(this));
		this.registerEditorExtension(finitionGrammalecteExtension(this));
		this.registerEditorExtension(correctionGutter(this));
		this.settingsTab = new FinitionSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);
		registerNoteReset(this, file => this.changeAnalysisNote(file));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			if (this.analysisProgress?.view !== this.app.workspace.getActiveViewOfType(MarkdownView)) this.finishAnalysisProgress();
			this.updateStatusBarIcon();
		}));
		this.registerEvent(this.app.workspace.on("editor-change", () => this.updateDocumentCounts()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.updateDocumentCounts()));

		for (const { mode, name } of analysisModes) this.addCommand({
			id: mode, name,
			checkCallback: checking => {
				if (!this.isModeAvailable(mode)) return false;
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
		this.addCommand({ id: "reset", name: "Reset", checkCallback: checking => {
			if (!this.hasActiveAnalysis) return false;
			if (!checking) void this.resetAnalysis();
			return true;
		} });

		this.addCommand({
			id: "synonymes-ia",
			name: "Synonymes IA",
			callback: () => runSynonyms(this.app, this.settings),
		});
		this.addCommand({ id: "synonyme", name: "Synonymes", callback: () => this.runSynonymsLocal() });
		this.addCommand({ id: "famille", name: "Flexions", callback: () => this.runFamily() });
		for (const kind of dictionaryCommands) this.addCommand({ id: kind, name: dictionaryLabels[kind], callback: () => this.runWordDictionary(kind) });

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
		this.addCommand({ id: "statistics-report", name: "Statistiques", checkCallback: checking => {
			if (!this.settings.debugMode || !this.hasLexicon || !this.isLinguisticEngineInstalled("grammalecte")) return false;
			if (!checking) void this.runStatisticsReport();
			return true;
		} });
	}

	onunload(): void {
		this.spellingRequest++;
		this.unlockAINote?.();
		this.unlockAINote = null;
		closeGrammalectePopup();
		cancelSynonyms();
		cancelCodex();
		this.finishAnalysisProgress();
		this.lexiconEngine?.destroy();
		this.lexiconLoad = undefined;
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
		this.settings.codexModel = typeof this.settings.codexModel === "string" ? this.settings.codexModel.trim() : "";
		this.settings.localAIServer = typeof this.settings.localAIServer === "string" ? this.settings.localAIServer.trim() : "";
		this.settings.localAIModel = typeof this.settings.localAIModel === "string" ? this.settings.localAIModel.trim() : "";
		if (!["none", "words", "characters", "both"].includes(this.settings.documentCountDisplay)) this.settings.documentCountDisplay = "none";
		if (this.settings.repetitionCountDisplay !== "percent") this.settings.repetitionCountDisplay = "count";
		this.settings.punctuationAutoApply = this.settings.punctuationAutoApply === true;
		this.settings.apostrophesAutoApply = this.settings.apostrophesAutoApply === true;
		this.settings.hideBacklinksCount = this.settings.hideBacklinksCount === true;
		this.settings.singleNoteOpen = this.settings.singleNoteOpen === true;
		this.settings.showLeftSidebarToggle = this.settings.showLeftSidebarToggle !== false;
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
		const validColor = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < this.settings.palette.length;
		const newColorFunctions = [...FORM_TYPES, { key: "copuleColorIndex" }] as const;
		const assignedColors = new Set([this.settings.hedgingColorIndex, this.settings.stereotypeColorIndex, this.settings.hingeColorIndex, this.settings.grammalecteColorIndex,
			...newColorFunctions.map(({ key }) => saved?.[key]).filter(validColor)]);
		for (const { key } of newColorFunctions) {
			if (validColor(saved?.[key])) continue;
			const preferred = DEFAULT_SETTINGS[key];
			const color = assignedColors.has(preferred) ? this.settings.palette.findIndex((_, index) => !assignedColors.has(index)) : preferred;
			this.settings[key] = color;
			assignedColors.add(color);
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

	/** Le lexique commun reste sur disque ; seules les petites listes sont embarquées. */
	async loadLexiconData(loadLemmas = false): Promise<void> {
		if (!this.isLinguisticEngineInstalled("lexique")) {
			this.lexiconEngine?.destroy();
			this.lexiconLoad = undefined;
			this.lexicon = new Map();
			this.dictionaryLemmaVariants = new Map();
			this.copuleLexicon = emptyCopuleLexicon();
		}
		else if (!this.lexicon.size && loadLemmas) {
			let loading = this.lexiconLoad;
			try {
				if (!loading) {
					const engine = this.lexiconEngine = new FinitionCorrectorEngine(file => this.readLinguisticAsset("lexique", file));
					loading = this.lexiconLoad = engine.getLexicalData().finally(() => { engine.destroy(); if (this.lexiconEngine === engine) this.lexiconEngine = null; });
				}
				const data = await loading;
				if (this.lexiconLoad === loading) { this.lexicon = data.lemmas; this.dictionaryLemmaVariants = data.variants; this.copuleLexicon = data.copules; }
			} catch (error) {
				if (this.lexiconLoad === loading) {
					this.lexiconLoad = undefined;
					new Notice(`Lexique : ${error instanceof Error ? error.message : String(error)}`, 10000);
				}
			}
		}
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
		this.ticIAPercentage = this.statusBarItem.createSpan();
		this.analysisNavigation = new AnalysisNavigation(this, this.statusBarItem);
		this.statusBarItem.prepend(this.documentCountEl);
		this.updateLeftSidebarToggle = addLeftSidebarToggle(this, this.statusBarItem, () => this.settings.showLeftSidebarToggle);
		this.updateStatusBarIcon();
		this.registerDomEvent(this.statusBarItem, "click", (evt) => this.showModeMenu(evt));
	}

	updateStatusBarIcon(): void {
		this.updateLeftSidebarToggle();
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

	updateAnalysisHighlights(view: EditorView, highlights: Highlight[], pending: boolean, wordCount?: number): void {
		this.analysisNavigation?.update(view, highlights, pending, wordCount);
		const progress = this.analysisProgress;
		if (!pending && progress?.mode === this.settings.mode && (progress.view?.editor as { cm?: EditorView } | undefined)?.cm === view) this.finishAnalysisProgress(progress.notice);
	}

	updateGrammalecteHighlights(view: EditorView, highlights: Pick<Highlight, "from" | "to">[]): void {
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
		if (this.settings.mode !== mode && !this.isModeAvailable(mode)) {
			new Notice("Chargez le dictionnaire ou le moteur requis dans les paramètres de Finition.");
			return;
		}
		const deactivate = this.settings.mode === mode || mode === "none";
		const reset = this.resetAnalysis();
		const request = this.spellingRequest;
		if (deactivate) { await reset; return; }
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const notice = this.startAnalysisProgress(analysisModes.find(item => item.mode === mode)?.name ?? "Analyse", view, mode);
		let activated = false;
		try {
			await reset;
			// Laisser l’éditeur effacer l’ancien affichage et afficher la roue avant le calcul.
			await new Promise<void>(resolve => window.setTimeout(resolve, 0));
			if (request !== this.spellingRequest) return;
			if (["repetition", "stereotype", "copules"].includes(mode)) {
				await this.loadLexiconData(true);
				if (!this.lexicon.size) return;
			}
			if (request !== this.spellingRequest || view !== this.app.workspace.getActiveViewOfType(MarkdownView)) return;
			this.settings.mode = mode;
			await this.saveSettings();
			if (request !== this.spellingRequest) return;
			this.updateStatusBarIcon();
			this.refreshAllEditors();
			activated = Boolean((view?.editor as { cm?: EditorView } | undefined)?.cm);
		} finally {
			if (!activated) this.finishAnalysisProgress(notice);
		}
	}

	private startAnalysisProgress(label: string, view: MarkdownView | null, mode?: FinitionMode): LoadingNotice {
		this.finishAnalysisProgress();
		const notice: LoadingNotice = new LoadingNotice(`${label} : analyse en cours…`, () => {
			if (this.analysisProgress?.notice !== notice) return;
			void this.resetAnalysis().catch(error => new Notice(`Arrêt : ${error instanceof Error ? error.message : String(error)}`));
		});
		this.analysisProgress = { notice, view, mode };
		return notice;
	}

	private finishAnalysisProgress(notice = this.analysisProgress?.notice): void {
		notice?.hide();
		if (this.analysisProgress?.notice === notice) this.analysisProgress = null;
	}

	private async runSpellingEngine(engine: ResourceEngine): Promise<void> {
		if (!this.isLinguisticEngineInstalled(engine)) return;
		await this.runGrammalecte(engine);
	}

	private get hasActiveAnalysis(): boolean {
		return this.analysisProgress !== null || this.settings.mode !== "none" || this.pendingCorrectionRequest === this.spellingRequest || this.grammalecteErrors.length > 0 || this.aiGroups.length > 0;
	}

	getNoteAnalysis(view: EditorView, update?: import("@codemirror/view").ViewUpdate): NoteAnalysis {
		this.noteAnalyses.current.mode = this.settings.mode;
		return this.noteAnalyses.forView(view, update);
	}

	private cancelPendingAnalysis(): number {
		this.unlockAINote?.();
		this.unlockAINote = null;
		closeGrammalectePopup();
		cancelSynonyms();
		cancelCodex();
		const request = ++this.spellingRequest;
		this.finishAnalysisProgress();
		this.pendingCorrectionRequest = null;
		return request;
	}

	private async changeAnalysisNote(file: TFile | null): Promise<void> {
		this.noteAnalyses.current.mode = this.settings.mode;
		const request = this.cancelPendingAnalysis();
		this.settings.mode = this.noteAnalyses.activate(file).mode;
		await this.saveSettings();
		if (request !== this.spellingRequest) return;
		this.updateStatusBarIcon();
		this.refreshAllEditors(false);
	}

	private async resetAnalysis(): Promise<void> {
		const request = this.cancelPendingAnalysis();
		this.settings.mode = "none";
		this.grammalecteErrors = [];
		this.grammalecteErrorsVersion++;
		this.clearAISuggestions();
		await this.saveSettings();
		if (request !== this.spellingRequest) return;
		this.updateStatusBarIcon();
		this.refreshAllEditors();
	}

	private resourceMenuItem(item: MenuItem, title: string, available: boolean, section: string, action: () => unknown): MenuItem {
		const label = available ? title : createFragment();
		if (typeof label !== "string") label.append(createSpan({ cls: "finition-resource-required", text: title }));
		return item.setTitle(label).setDisabled(false).onClick(() => {
			if (available) return action();
			this.openSettingsTab(section);
			new Notice(`Chargez les ressources dans « ${section} » avec le bouton Charger.`);
		});
	}

	private showModeMenu(evt: MouseEvent): void {
		const menu = new Menu();

		menu.addItem(item => {
			item.setTitle("Surlignages").setIcon("highlighter");
			const submenu = (item as typeof item & { setSubmenu(): Menu }).setSubmenu();
			for (const { mode, name, icon } of analysisModes) submenu.addItem(item =>
				this.resourceMenuItem(item, name, this.isModeAvailable(mode), "Corrections", () => this.setMode(mode))
					.setIcon(icon).setChecked(this.settings.mode === mode));
		});

		menu.addItem(item => {
			item.setTitle("Dictionnaires").setIcon("book-open");
			const submenu = (item as typeof item & { setSubmenu(): Menu }).setSubmenu();
			submenu.addItem(item => this.resourceMenuItem(item, "Synonymes", this.hasSynonyms, "Synonymes", () => this.runSynonymsLocal()).setIcon("book-open"));
			submenu.addItem(item => item.setTitle("Synonymes IA").setIcon("book-open")
				.onClick(() => runSynonyms(this.app, this.settings)));
			submenu.addItem(item => this.resourceMenuItem(item, "Flexions", this.hasLexicon, "Corrections", () => this.runFamily()).setIcon("book-open"));
			for (const kind of dictionaryCommands) submenu.addItem(item =>
				this.resourceMenuItem(item, dictionaryLabels[kind], Boolean(this.wordDictionaries?.has(kind)), dictionaryLabels[kind], () => this.runWordDictionary(kind)).setIcon("book-open"));
		});

		menu.addSeparator();

		menu.addItem(item => item.setTitle("Ponctuations").setIcon("quote")
			.setChecked(this.aiGroups.length > 0 && this.correctionSource === "punctuation")
			.onClick(() => this.runPunctuationFix()));

		for (const engine of resourceEngines) {
			const installed = this.isLinguisticEngineInstalled(engine);
			menu.addItem(item => this.resourceMenuItem(item, resourceLabels[engine], installed, "Corrections", () => this.runSpellingEngine(engine))
				.setIcon(engine === "grammalecte" ? "book-open" : "brain")
				.setChecked(installed && this.settings.spellingEngine === engine && this.grammalecteErrors.length > 0));
		}

		menu.addItem((item) =>
			item
				.setTitle("Corrections IA")
				.setIcon("bot")
				.setChecked(this.aiGroups.length > 0 && this.correctionSource !== "punctuation")
				.onClick(() => this.toggleOrthoTypoIA())
		);

		if (this.settings.debugMode) menu.addItem(item =>
			this.resourceMenuItem(item, "Structure", this.hasAnalysisResources, "Corrections", () => this.runStructureReport()).setIcon("list-tree"));
		if (this.settings.debugMode) menu.addItem(item =>
			this.resourceMenuItem(item, "Statistiques", this.hasLexicon && this.isLinguisticEngineInstalled("grammalecte"), "Corrections", () => this.runStatisticsReport()).setIcon("chart-no-axes-column"));

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Paramètres")
				.setIcon("settings")
				.onClick(() => this.openSettingsTab())
		);

		if (this.hasActiveAnalysis) {
			menu.addSeparator();
			menu.addItem(item => item.setTitle("Reset").setIcon("rotate-ccw").onClick(() => this.resetAnalysis()));
		}

		menu.showAtMouseEvent(evt);
	}

	/** Ouvre directement l'onglet de réglages du plugin Finition. */
	private openSettingsTab(section?: string): void {
		// API non officiellement typée par obsidian.d.ts mais stable et
		// largement utilisée par l'écosystème des plugins tiers pour ouvrir
		// directement SA PROPRE page de réglages (évite de passer par
		// Réglages > Plugins communautaires > Finition manuellement).
		const appWithSettings = this.app as unknown as {
			setting: { open: () => void; openTabById: (id: string) => void };
		};
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(this.manifest.id);
		if (section) this.settingsTab?.revealSection(section);
	}

	/**
	 * Lance une révision IA de la sélection, ou de toute la note sans
	 * sélection. Ne modifie rien tout de suite : les
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
		if (this.aiGroups.length > 0 && this.correctionSource !== "punctuation") {
			await this.resetAnalysis();
			return;
		}
		await this.runOrthoTypoIA();
	}

	private revealCorrection(view: MarkdownView, offset: number): void {
		const position = view.editor.offsetToPos(offset);
		view.editor.setCursor(position);
		view.editor.scrollIntoView({ from: position, to: position }, true);
	}

	private async runOrthoTypoIA(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		const selected = editor.somethingSelected();
		let connection: ReturnType<typeof getAIConnection>;
		try { connection = getAIConnection(this.settings); }
		catch (error) {
			new Notice(`Corrections IA : ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const reset = this.resetAnalysis();
		const request = this.spellingRequest;
		this.pendingCorrectionRequest = request;
		const document = editor.getValue();

		this.aiSourcePath = view.file?.path ?? null;
		this.correctionSource = "ai";
		const selectionFrom = selected ? editor.posToOffset(editor.getCursor("from")) : 0;
		const original = selected ? editor.getSelection() : document;
		const chunks = splitIntoChunks(original, this.settings.aiChunkSize);
		const links = markdownLinks(document);
		const debugMode = this.settings.debugMode;
		const debugChunks: string[] = [];

		// Une seule notification, mise à jour à chaque tronçon (via
		// setMessage) plutôt qu'un message figé affiché une fois pour toutes
		// au début — sinon rien ne permet de suivre ce qui se passe pendant
		// l'attente des appels API, potentiellement longs.
		let modelName = aiModelName(connection);
		const progress = this.startAnalysisProgress(`Corrections IA · ${modelName}`, view);
		const errors: string[] = [];
		let revealed = false;
		let unlock: (() => void) | undefined;
		const isCurrent = () => {
			if (request !== this.spellingRequest || this.app.workspace.getActiveViewOfType(MarkdownView) !== view) return false;
			if (document === editor.getValue()) return true;
			new Notice("Corrections IA : le texte a changé, l’analyse a été interrompue. Relance-la pour traiter toute la note.", 8000);
			return false;
		};

		// try/finally : si quoi que ce soit plante de façon inattendue (pas
		// seulement les erreurs API déjà gérées une par une plus bas), la
		// notification de progression se ferme quand même et l'erreur
		// s'affiche, au lieu de laisser croire que le plugin est resté bloqué.
		try {
			await reset;
			if (request !== this.spellingRequest) return;
			const cm = (editor as { cm?: EditorView }).cm;
			unlock = cm ? lockAINote(cm) : undefined;
			this.unlockAINote = unlock ?? null;
			for (let i = 0; i < chunks.length; i++) {
				if (!isCurrent()) return;
				const chunk = chunks[i];
				const reportProgress = () => progress.setMessage(`Corrections IA · ${modelName} : tronçon ${i + 1}/${chunks.length}… Note verrouillée.`);
				reportProgress();
				if (chunk.text.trim().length === 0) continue;
				const reviseChunk = connection.provider === "codex" ? reviseChunkWithCodex : connection.provider === "openai" ? reviseChunkWithRetryOpenAI : reviseChunkWithRetryAnthropic;
				const start = selectionFrom + chunk.start;
				const protectedText = protectLinks(document, start, start + chunk.text.length, links);
				if (!protectedText.text.trim()) continue;
				const { text: revisedRaw, error } = await reviseChunk(protectedText.text, this.settings.aiPrompt, {
					...connection,
					maxTokens: this.settings.aiMaxTokens,
					isCancelled: () => request !== this.spellingRequest,
					onModel: model => { modelName = `Codex · ${model}`; if (request === this.spellingRequest) reportProgress(); },
				});
				if (!isCurrent()) return;
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
				if (!revealed && this.aiGroups.length) {
					this.revealCorrection(view, this.aiGroups[0].delFrom);
					revealed = true;
				}
			}
			if (debugMode && errors.length === 0 && debugChunks.length) await this.createDebugNote(view, debugChunks.join("\n\n"), "");
		} catch (e) {
			if (request !== this.spellingRequest) return;
			errors.push(`Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			if (this.unlockAINote === unlock) this.unlockAINote = null;
			unlock?.();
			if (this.pendingCorrectionRequest === request) this.pendingCorrectionRequest = null;
			this.finishAnalysisProgress(progress);
		}

		if (request !== this.spellingRequest) return;
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

	/** Calcule la ponctuation sur toute la note, avec validation selon le réglage. */
	private async runPunctuationFix(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;
		const automatically = this.settings.punctuationAutoApply;
		const apostrophesAutomatically = this.settings.apostrophesAutoApply;
		if (!(automatically && apostrophesAutomatically) && this.correctionSource === "punctuation" && this.aiGroups.length) {
			await this.resetAnalysis();
			return;
		}
		const original = editor.getValue();
		const reset = this.resetAnalysis(), request = this.spellingRequest;
		await reset;
		if (request !== this.spellingRequest || this.app.workspace.getActiveViewOfType(MarkdownView) !== view || editor.getValue() !== original) return;
		let applied = apostrophesAutomatically ? fixApostrophesProtected(original) : original;
		if (automatically) applied = fixBlankLinesProtected(fixPunctuationSpacing(applied, false));
		const fixed = fixBlankLinesProtected(fixPunctuationSpacing(applied));
		if (applied !== original) {
			const selections = editor.listSelections();
			const scroll = editor.getScrollInfo();
			editor.setValue(applied);
			editor.setSelections(selections);
			editor.scrollTo(scroll.left, scroll.top);
		}

		if (fixed !== applied) {
			this.aiSourcePath = view.file?.path ?? null;
			this.correctionSource = "punctuation";
			this.aiGroups = diffToGroups(applied, fixed).map(group => ({ ...group, id: this.nextAiGroupId++ }));
			this.aiGroupsVersion++;
			this.updateStatusBarIcon();
			this.refreshAllEditors();
			this.revealCorrection(view, this.aiGroups[0].delFrom);
			new Notice(`Ponctuation : ${this.aiGroups.length} correction(s) à valider.`);
		} else if (applied !== original) {
			new Notice("Ponctuation : corrections appliquées.");
		} else {
			new Notice("Ponctuation : rien à corriger.");
		}
	}

	/** Crée le Worker Grammalecte au premier besoin (Grammalecte OU Cadence "grammalecte"), une seule fois. */
	private async ensureGrammalecteEngine(): Promise<GrammalecteEngine> {
		if (!this.grammalecteEngine) {
			this.grammalecteEngine = new GrammalecteEngine(file => this.readLinguisticAsset("grammalecte", file), () => this.readLinguisticAsset("grammalecte", personalDictionaryFile));
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
		const generation = this.wordCategoryCacheVersion;
		try {
			const engine = await this.ensureSpellingEngine(this.settings.analysisEngine);
			const result = await engine.getCategories(toFetch);
			if (generation !== this.wordCategoryCacheVersion) return;
			for (const [word, category] of Object.entries(result)) {
				this.wordCategoryCache.set(word, category);
			}
			this.wordCategoryCacheVersion++;
			this.refreshAllEditors(false);
		} catch (e) {
			if (generation !== this.wordCategoryCacheVersion) return;
			if (this.analysisProgress?.mode && ["ternary", "cadence", "tic-ia"].includes(this.analysisProgress.mode)) {
				this.finishAnalysisProgress();
				new Notice("Analyse : impossible de résoudre les catégories grammaticales.");
			}
			console.error("Finition — Cadence (Grammalecte) : impossible de résoudre les catégories.", e);
		}
	}

	private configureSpellingEngine(engine: ResourceEngine): void {
		if (!resourceEngines.includes(engine)) throw new Error("Moteur orthographique inconnu.");
		this.settings.spellingEngine = engine;
		if (this.finitionCorrectorEngine) this.finitionCorrectorEngine.neuralEnabled = engine === "finition-corrector" && this.settings.spellingNeural;
		this.resetWordCategories();
	}

	async setSpellingEngine(engine: FinitionSettings["spellingEngine"]): Promise<void> {
		this.configureSpellingEngine(engine);
		this.spellingRequest++;
		this.grammalecteErrors = [];
		this.grammalecteErrorsVersion++;
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
	get hasLexicon(): boolean { return this.isLinguisticEngineInstalled("lexique"); }
	isModeAvailable(mode: FinitionMode): boolean {
		if (["repetition", "stereotype", "copules"].includes(mode)) return this.hasLexicon;
		if (mode === "ternary" || (mode === "cadence" && this.settings.cadenceEngine === "grammalecte")) return this.hasAnalysisResources;
		return true;
	}
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
		if (path.startsWith("/")) {
			const directory = path.endsWith("/pack.json") ? path.slice(0, -"pack.json".length) : `${path}/`;
			await this.importNeuralModel(async file => {
				const bytes = await FileSystemAdapter.readLocalFile(directory + file);
				if (!bytes.byteLength || bytes.byteLength > (file === "pack.json" ? 16384 : neuralFileLimit)) throw new Error("Fichier du modèle absent ou trop volumineux.");
				return bytes;
			});
			return;
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
			: this.readLinguisticAsset("synonymes", "synonymes.json"), () => this.dictionaryLemmas());
		await runLocalSynonyms(this.app, this.synonymsDictionary);
	}
	private async dictionaryLemmas(): Promise<DictionaryLemmas> {
		await this.loadLexiconData(true);
		return { lemmas: this.lexicon, variants: this.dictionaryLemmaVariants };
	}
	async runFamily(): Promise<void> {
		await runLocalWordLookup(this.app, "Flexions", async word => ({
			rows: await lookupFamily(() => this.readLinguisticAsset("lexique", dictionaryFile), word),
			description: "Toutes les flexions des lemmes du mot sélectionné, d’après le lexique actif.",
		}));
	}
	isLinguisticEngineInstalled(engine: ResourcePack): boolean { return engine === "lexique" ? (this.lexiconDictionaries?.available ?? false) : (this.linguisticResources?.available(engine) ?? false); }
	async runWordDictionary(kind: DictionaryKind): Promise<void> {
		await runLocalWordLookup(this.app, dictionaryLabels[kind], async word => {
			if (!this.wordDictionaries) throw new Error("Charge un dictionnaire dans les réglages de Finition.");
			const { rows } = await this.wordDictionaries.lookup(kind, word);
			return kind === "antonymes" || kind === "rimes"
				? { groups: rows.filter(row => row.words?.length).map(row => ({ category: "", label: row.label ?? "", words: row.words!, sources: [] })) }
				: { rows, citationLexicon: kind === "citations" ? await this.dictionaryLemmas() : undefined };
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
	private async lexiconChanged(): Promise<void> {
		this.lexiconEngine?.destroy();
		this.lexiconEngine = null;
		this.lexiconLoad = undefined;
		this.lexicon = new Map();
		this.dictionaryLemmaVariants = new Map();
		this.copuleLexicon = emptyCopuleLexicon();
		this.finitionCorrectorEngine?.destroy();
		this.finitionCorrectorEngine = null;
		this.grammalecteEngine?.destroy();
		this.grammalecteEngine = null;
		this.spellingRequest++;
		this.grammalecteErrors = [];
		this.grammalecteErrorsVersion++;
		this.resetWordCategories();
		this.settingsVersion++;
		await this.loadLexiconData(["repetition", "stereotype", "copules"].includes(this.settings.mode));
		this.refreshAllEditors();
	}
	async setLexicon(path: string): Promise<void> {
		if (!this.lexiconDictionaries) await this.loadLinguisticResources();
		if (!this.lexiconDictionaries) throw new Error("Dossier du plugin introuvable.");
		await this.lexiconDictionaries.select(path);
		await this.lexiconChanged();
	}
	async importLexicon(raw: ArrayBuffer): Promise<void> {
		if (!this.lexiconDictionaries) await this.loadLinguisticResources();
		if (!this.lexiconDictionaries) throw new Error("Dossier du plugin introuvable.");
		await this.lexiconDictionaries.import(raw);
		await this.lexiconChanged();
	}
	async setLexiconPath(path: string): Promise<void> {
		path = path.trim();
		let raw: ArrayBuffer;
		if (path.startsWith("/")) raw = await FileSystemAdapter.readLocalFile(path);
		else {
			path = personalSynonymPath(path);
			const stat = await this.app.vault.adapter.stat(path);
			if (stat?.type !== "file" || stat.size < 1 || stat.size > synonymFileLimit) throw new Error("Choisis un lexique JSON existant de 128 Mio maximum.");
			raw = await this.app.vault.adapter.readBinary(path);
		}
		await this.importLexicon(raw);
	}
	async removeLexicon(path: string): Promise<void> {
		if (!this.lexiconDictionaries) throw new Error("Dossier du plugin introuvable.");
		await this.lexiconDictionaries.remove(path);
		await this.lexiconChanged();
	}
	async loadLinguisticResources(): Promise<void> {
		if (!this.manifest.dir) return;
		this.linguisticResources ??= new LinguisticResources(this.app.vault.adapter, this.manifest.dir, this.manifest.version);
		await this.linguisticResources.refresh(this.settings.resourcePacks);
		this.lexiconDictionaries ??= new LexiconDictionaries(this.app.vault.adapter, this.manifest.dir, () => this.settings, () => this.saveSettings(), this.linguisticResources);
		await this.lexiconDictionaries.refresh();
		this.neuralModels ??= new NeuralModels(this.app.vault.adapter, this.manifest.dir);
		await this.neuralModels.refresh();
		const renamedModel = this.settings.neuralModel.replace(/^helper\/neural\/models\//u, "scripts/neural/models/");
		if (renamedModel !== this.settings.neuralModel && !this.neuralModels.options.some(model => model.id === this.settings.neuralModel) && this.neuralModels.options.some(model => model.id === renamedModel)) {
			this.settings.neuralModel = renamedModel;
			await this.saveSettings();
		}
		if (this.settings.synonymDictionaryPath && !this.settings.synonymDictionaries.some(entry => entry.path === this.settings.synonymDictionaryPath)) {
			try {
				await this.setSynonymDictionaryPath(this.settings.synonymDictionaryPath);
			} catch { /* Un ancien dictionnaire absent ou incompatible reste désactivé. */ }
		}
		await this.refreshSynonymDictionaries();
		this.wordDictionaries ??= new WordDictionaries(this.app.vault.adapter, this.manifest.dir, () => this.settings, () => this.saveSettings(), this.linguisticResources, () => this.dictionaryLemmas());
		await this.wordDictionaries.refresh();
		await this.loadLexiconData();
	}
	private async readLinguisticAsset(engine: ResourcePack, file: string): Promise<ArrayBuffer> {
		if (file === personalDictionaryFile && (engine === "grammalecte" || engine === "finition-corrector")) {
			if (!this.manifest.dir) throw new Error("Dossier du plugin introuvable.");
			const path = `${this.manifest.dir}/${personalDictionaryPath}`;
			return await this.app.vault.adapter.exists(path) ? this.app.vault.adapter.readBinary(path)
				: new TextEncoder().encode(JSON.stringify({ format: "finition-personal-forms", version: 1, forms: [] })).buffer;
		}
		if (file === dictionaryFile && this.lexiconDictionaries) return this.lexiconDictionaries.read();
		if (!this.linguisticResources?.available(engine)) await this.loadLinguisticResources();
		if (!this.linguisticResources) throw new Error("Dossier du plugin introuvable.");
		return this.linguisticResources.read(engine, file);
	}
	async downloadLinguisticResources(engine: ResourcePack, progress: (text: string) => void, signal?: AbortSignal): Promise<void> {
		await this.loadLinguisticResources();
		signal?.throwIfAborted();
		if (!this.linguisticResources) throw new Error("Dossier du plugin introuvable.");
		const revision = await this.linguisticResources.install(engine, progress, signal);
		signal?.throwIfAborted();
		const previous = this.settings.resourcePacks;
		this.settings.resourcePacks = { ...previous, [engine]: revision };
		try { await this.saveSettings(); }
		catch (error) { this.settings.resourcePacks = previous; throw error; }
		if (engine === "lexique" || engine === "grammalecte" || engine === "finition-corrector") {
			this.lexiconEngine?.destroy();
			this.lexiconLoad = undefined;
			this.lexicon = new Map();
			this.dictionaryLemmaVariants = new Map();
			this.copuleLexicon = emptyCopuleLexicon();
		}
		await this.loadLinguisticResources();
		if (!this.linguisticResources.available(engine)) throw new Error("Installation incomplète. Relancez le téléchargement.");
		await this.loadLexiconData(["repetition", "stereotype", "copules"].includes(this.settings.mode));
		this.settingsVersion++;
		this.refreshAllEditors();
		if (engine === "lexique") { await this.setLexicon(""); return; }
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
			this.finitionCorrectorEngine = new FinitionCorrectorEngine(file => file.startsWith("electra/") && specialized ? specialized(file) : this.readLinguisticAsset("finition-corrector", file), false, () => this.readLinguisticAsset("finition-corrector", personalDictionaryFile));
			this.finitionCorrectorEngine.specializedEnabled = Boolean(specialized);
		}
		this.finitionCorrectorEngine.neuralEnabled = this.settings.spellingNeural;
		return this.finitionCorrectorEngine;
	}

	private async runGrammalecte(engine?: ResourceEngine): Promise<void> {
		if ((!engine || engine === this.settings.spellingEngine) && this.grammalecteErrors.length > 0) {
			await this.resetAnalysis();
			return;
		}
		if (engine ? !this.isLinguisticEngineInstalled(engine) : !this.hasLinguisticResources) { new Notice("Téléchargez un moteur linguistique dans les paramètres de Finition."); return; }
		if (engine) {
			if (engine === "finition-corrector") this.settings.spellingNeural = true;
			this.configureSpellingEngine(engine);
		}
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) { if (engine) await this.saveSettings(); return; }
		const editor = view.editor;
		const document = editor.getValue();
		const from = editor.posToOffset(editor.getCursor("from"));
		const to = editor.posToOffset(editor.getCursor("to"));
		const reset = this.resetAnalysis();
		const request = this.spellingRequest;

		const label = this.settings.spellingEngine === "finition-corrector" && this.settings.spellingNeural ? "Correction neurale" : "Corrections";
		this.pendingCorrectionRequest = request;
		const notice = this.startAnalysisProgress(label, view);
		let revealed = false;
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
			this.refreshAllEditors(this.grammalecteErrors.length === 0);
			if (!revealed && this.grammalecteErrors.length) {
				this.revealCorrection(view, this.grammalecteErrors.reduce((first, error) => Math.min(first, error.nStart), document.length));
				revealed = true;
			}
			return true;
		};
		try {
			await reset;
			if (request !== this.spellingRequest) return;
			const engine = await this.ensureSpellingEngine();
			if (request !== this.spellingRequest) return;
			const rawErrors = await analyzeCorrections(engine, document, from, to, publish);
			if (!publish(rawErrors)) return;
			this.finishAnalysisProgress(notice);
			if (this.grammalecteErrors.length === 0) {
				new Notice(`${label} : aucune suggestion.`);
			} else {
				new Notice(`${label} : ${this.grammalecteErrors.length} suggestion(s).`);
			}
		} catch (e) {
			if (request !== this.spellingRequest) return;
			this.finishAnalysisProgress(notice);
			new Notice(`${label} : erreur — ${e instanceof Error ? e.message : String(e)}`, 10000);
			console.error(`Finition — ${label} :`, e);
		} finally {
			if (this.pendingCorrectionRequest === request) this.pendingCorrectionRequest = null;
			this.finishAnalysisProgress(notice);
		}
	}

	private async createDebugNote(view: Pick<MarkdownView, "file">, content: string, prefix: string | ((name: string, timestamp: string) => string)): Promise<TFile | null> {
		if (!this.settings.debugMode) return null;
		if (!hasResponseText(content)) throw new Error("Aucun texte à enregistrer : note horodatée non créée.");
		const source = view.file;
		const folder = source?.parent?.path && source.parent.path !== "/" ? `${source.parent.path}/` : "";
		const pad = (number: number) => String(number).padStart(2, "0");
		const now = new Date();
		const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
		const name = source?.basename ?? "sans titre";
		const base = folder + (typeof prefix === "string" ? `${prefix}${name} (${timestamp})` : prefix(name, timestamp));
		let path = `${base}.md`;
		for (let suffix = 2; this.app.vault.getAbstractFileByPath(path); suffix++) path = `${base} ${suffix}.md`;
		const file = await this.app.vault.create(path, content);
		if (await this.app.vault.read(file) !== content) {
			await this.app.vault.process(file, saved => hasResponseText(saved) ? saved : content);
			if (await this.app.vault.read(file) !== content) throw new Error(`Le contenu de la note horodatée n’a pas été conservé : ${path}`);
		}
		return file;
	}

	private async runStatisticsReport(): Promise<void> {
		if (!this.settings.debugMode) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) { new Notice("Statistiques : aucune note active."); return; }
		if (!this.isLinguisticEngineInstalled("grammalecte")) { new Notice("Installez Grammalecte dans les paramètres de Finition."); return; }
		if (!this.hasLexicon) { new Notice("Chargez le dictionnaire Finition dans les paramètres."); return; }
		const text = view.editor.getValue();
		const source = { file: view.file };
		const notice = new LoadingNotice("Statistiques");
		try {
			await this.loadLexiconData(true);
			if (notice.cancelled) return;
			if (!this.lexicon.size) throw new Error("Lexique indisponible.");
			const engine = await this.ensureGrammalecteEngine();
			if (notice.cancelled) return;
			const words = [...new Set([...structureCategoryWords(text), ...statisticsWords(text)])];
			const categories = await engine.getCategories(words);
			if (notice.cancelled) return;
			const content = await buildStatisticsReport(text, word => categories[word.toLowerCase()] ?? "", this.lexicon);
			if (notice.cancelled) return;
			const file = await this.createDebugNote(source, content, (name, timestamp) => `${name}_stats_${timestamp.replace(" ", "_")}`);
			if (file && !notice.cancelled) await this.app.workspace.getLeaf(true).openFile(file);
		} catch (error) {
			if (notice.cancelled) return;
			new Notice(`Statistiques : ${error instanceof Error ? error.message : String(error)}`, 10000);
			console.error("Finition — Statistiques :", error);
		} finally { notice.hide(); }
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

		const notice = new LoadingNotice("Structure : chargement du moteur linguistique…");
		try {
			const engine = await this.ensureSpellingEngine(this.settings.analysisEngine);
			if (notice.cancelled) return;
			notice.setMessage("Structure : analyse en cours…");

			const categories = await engine.getCategories(structureCategoryWords(text));
			if (notice.cancelled) return;
			const getCategory = (word: string) => categories[word.toLowerCase()] ?? "";

			const content = buildStructureReport(text, getCategory);

			const file = await this.createDebugNote(view, content, "Structure — ");
			notice.hide();
			if (file && !notice.cancelled) await this.app.workspace.getLeaf(true).openFile(file);
		} catch (e) {
			if (notice.cancelled) return;
			new Notice(`Structure : erreur — ${e instanceof Error ? e.message : String(e)}`, 10000);
			console.error("Finition — Structure :", e);
		} finally { notice.hide(); }
	}

	/**
	 * Ajoute un mot au dictionnaire personnel Grammalecte (bouton "Ajouter au
	 * dictionnaire" du popup — voir grammalecte-extension.ts) et retire
	 * IMMÉDIATEMENT toutes les occurrences déjà soulignées de ce mot dans la
	 * note courante (pas seulement celle sur laquelle on vient de cliquer) :
	 * un nom propre répété plusieurs fois serait sinon toujours souligné
	 * ailleurs dans le texte après l'avoir "accepté" une fois.
	 */
	async addWordToGrammalecteDictionary(word: string, view?: EditorView): Promise<void> {
		const normalized = word.trim();
		if (!normalized) return;
		this.settings.grammalecteCustomDictionary = addWordToDictionaryText(
			this.settings.grammalecteCustomDictionary,
			normalized
		);
		const lower = normalized.toLowerCase();
		const analysis = view ? this.getNoteAnalysis(view) : this.noteAnalyses.current;
		analysis.grammalecteErrors = analysis.grammalecteErrors.filter(
			(err) => !(err.sType === "orthographe" && err.sValue && err.sValue.toLowerCase() === lower)
		);
		analysis.grammalecteErrorsVersion++;
		await this.saveSettings();
		this.refreshAllEditors();
	}

	/** Efface toutes les suggestions IA en attente, sans rien modifier au document. */
	clearAISuggestions(): void {
		resetCorrectionHistory(this.noteAnalyses.current);
		this.aiGroups = [];
		this.aiSourcePath = null;
		this.correctionSource = null;
		this.aiGroupsVersion++;
		this.refreshAllEditors();
	}

	/** Force CodeMirror à relire les décorations sur tous les éditeurs ouverts. */
	refreshAllEditors(clearNavigationFocus = true): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				const cm = (view.editor as unknown as { cm?: EditorView }).cm;
				cm?.dispatch(clearNavigationFocus && view === this.app.workspace.getActiveViewOfType(MarkdownView) ? { effects: setNavigationFocus.of(null) } : {});
			}
		});
	}
}
