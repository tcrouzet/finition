import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import type { EventRef, Plugin } from "obsidian";
import type { TFile } from "obsidian";
import { EditorState, StateField } from "@codemirror/state";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { FinitionRuntime } from "../plugin/types";
import type FinitionPlugin from "../plugin/main";

export async function checkNoteReset(): Promise<void> {
	const compiled = await build({ stdin: { contents: 'export * from "./plugin/ui/note-reset"; export * from "./plugin/note-analysis"; export * from "./plugin/editor-extension"; export * from "./plugin/ai/ai-extension"; export * from "./plugin/grammalecte-extension"; export { DEFAULT_SETTINGS } from "./plugin/types";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", loader: { ".md": "text" }, write: false, external: ["obsidian"] });
	const notices: string[] = [], module = { exports: {} };
	const editorInfoField = StateField.define<{ file: Pick<TFile, "path"> | null }>({ create: () => ({ file: null }), update: value => value });
	runInNewContext(compiled.outputFiles[0].text, { module, require: (name: string) => {
		assert.equal(name, "obsidian");
		return { editorInfoField, Notice: class { constructor(message: string) { notices.push(message); } } };
	}, window: { setTimeout, clearTimeout } });
	const api = module.exports as typeof import("../plugin/ui/note-reset") & typeof import("../plugin/note-analysis") & typeof import("../plugin/editor-extension") & typeof import("../plugin/ai/ai-extension") & typeof import("../plugin/grammalecte-extension") & Pick<typeof import("../plugin/types"), "DEFAULT_SETTINGS">;
	const { registerNoteReset, NoteAnalyses } = api;
	const first = { path: "premiere.md" }, second = { path: "seconde.md" };
	let active: typeof first | null = first;
	const events = new Map<string, () => void>();
	const refs: EventRef[] = [];
	const plugin = {
		app: { workspace: { getActiveFile: () => active, on: (event: string, callback: () => void) => { events.set(event, callback); return { event } as unknown as EventRef; } } },
		registerEvent: (ref: EventRef) => refs.push(ref),
	} as unknown as Pick<Plugin, "app" | "registerEvent">;
	let resets = 0, rejectReset = false;
	const destinations: Array<TFile | null> = [];
	registerNoteReset(plugin, async file => { resets++; destinations.push(file); if (rejectReset) throw new Error("Stockage indisponible"); });
	assert.equal(resets, 0, "L’inscription ne doit pas réinitialiser la note déjà active");
	assert.equal(refs.length, 2, "Les événements doivent être nettoyés par le cycle de vie du plugin");
	const fire = (event: string) => { const callback = events.get(event); assert.ok(callback, event); callback(); };
	fire("active-leaf-change"); fire("file-open");
	assert.equal(resets, 0, "Un changement de volet ou une réouverture de la même note ne doit pas effacer l’analyse");
	active = second;
	fire("file-open");
	assert.equal(resets, 1, "Une nouvelle note dans le même onglet doit déclencher le reset");
	assert.equal(destinations.at(-1), second);
	fire("active-leaf-change"); fire("file-open");
	assert.equal(resets, 1, "Une même navigation ne doit pas déclencher plusieurs resets");
	active = first;
	fire("active-leaf-change"); fire("file-open");
	assert.equal(resets, 2, "Changer d’onglet doit déclencher le reset");
	first.path = "renommee.md";
	fire("file-open");
	assert.equal(resets, 2, "Renommer la note ne doit pas effacer son analyse");
	active = null;
	fire("file-open"); fire("active-leaf-change");
	assert.equal(resets, 3, "Fermer la dernière note doit réinitialiser l’analyse");
	rejectReset = true; active = second;
	fire("file-open");
	await new Promise(resolve => setImmediate(resolve));
	assert.ok(notices.at(-1)?.includes("Stockage indisponible"), "Un échec de sauvegarde ne doit pas devenir un rejet non géré");
	const analyses = new NoteAnalyses();
	const firstFile = first, secondFile = second;
	const view = (file: Pick<TFile, "path">, text: string) => ({ state: EditorState.create({ doc: text, extensions: [editorInfoField.init(() => ({ file }))] }) }) as EditorView;
	const firstView = view(firstFile, "Une fote ici."), secondView = view(secondFile, "Une autre fote.");
	const firstAnalysis = analyses.activate(firstFile);
	firstAnalysis.mode = "hinges";
	firstAnalysis.aiSourcePath = firstFile.path;
	firstAnalysis.aiGroups = [{ id: 1, delFrom: 4, delTo: 8, delText: "fote", insText: "faute" }];
	firstAnalysis.grammalecteErrors = [{ nStart: 4, nEnd: 8, sRuleId: "test", sType: "orthographe", sMessage: "Faute", aSuggestions: ["faute"] }];
	analyses.forView(firstView);
	const otherPane = view(firstFile, "Une fote ici.");
	analyses.forView(otherPane);
	const secondAnalysis = analyses.activate(secondFile);
	assert.equal(secondAnalysis.mode, "none", "Une nouvelle note hérite du surlignage précédent");
	assert.equal(secondAnalysis.aiGroups.length + secondAnalysis.grammalecteErrors.length, 0);
	secondAnalysis.mode = "formes";
	assert.equal(analyses.forView(firstView), firstAnalysis, "Un éditeur en arrière-plan lit l’analyse de la note active");
	assert.equal(analyses.forView(secondView), secondAnalysis);
	assert.equal(analyses.activate(firstFile), firstAnalysis);
	assert.equal(firstAnalysis.mode, "hinges");
	assert.equal(firstAnalysis.aiGroups.length, 1, "Les corrections IA disparaissent au retour");
	assert.equal(firstAnalysis.grammalecteErrors.length, 1, "Les corrections orthographiques disparaissent au retour");
	// Obsidian peut changer le fichier de l’éditeur avant d’y charger son texte.
	const reused = view(firstFile, "Une fote ici.");
	analyses.forView(reused);
	Object.assign(reused.state.field(editorInfoField), { file: secondFile });
	analyses.forView(reused);
	Object.assign(reused, { state: EditorState.create({ doc: "Une autre fote.", extensions: [editorInfoField.init(() => ({ file: secondFile }))] }) });
	analyses.forView(reused);
	Object.assign(reused.state.field(editorInfoField), { file: firstFile });
	assert.equal(analyses.forView(reused).aiGroups.length, 0, "Le texte de la note quittée affiche les corrections de la note d’arrivée");
	assert.equal(firstAnalysis.aiGroups.length, 1, "Le chargement transitoire de la note efface les corrections sauvegardées");
	Object.assign(reused, { state: firstView.state });
	assert.equal(analyses.forView(reused).aiGroups.length, 1, "Le retour dans l’éditeur réutilisé ne restaure pas les corrections");
	const transaction = firstView.state.update({ changes: { from: 0, insert: "Hier, " } });
	const editedView = { state: transaction.state } as EditorView;
	const update = { docChanged: true, startState: transaction.startState, changes: transaction.changes } as ViewUpdate;
	analyses.forView(editedView, update);
	assert.equal(firstAnalysis.aiGroups[0].delFrom, 10);
	assert.equal(firstAnalysis.grammalecteErrors[0].nStart, 10);
	analyses.forView(otherPane);
	assert.equal(firstAnalysis.aiGroups.length, 1, "La lecture du volet encore désynchronisé efface les corrections");
	Object.assign(otherPane, { state: transaction.state });
	analyses.forView(otherPane, update);
	assert.equal(firstAnalysis.aiGroups[0].delFrom, 10, "Le second volet décale une seconde fois les corrections");
	analyses.forView(editedView, update);
	assert.equal(firstAnalysis.aiGroups[0].delFrom, 10, "Deux extensions ou volets décalent deux fois la même correction");
	assert.equal(analyses.forView(view(firstFile, transaction.state.doc.toString())).aiGroups.length, 1, "Un onglet recréé avec le même texte perd ses corrections");
	firstFile.path = "nouveau-nom.md";
	assert.equal(analyses.forView(editedView).aiSourcePath, firstFile.path);
	analyses.activate(secondFile);
	const changed = analyses.forView(view(firstFile, "Un nouveau texte entièrement différent."));
	assert.equal(changed.aiGroups.length + changed.grammalecteErrors.length, 0, "Une modification extérieure conserve des positions périmées");
	assert.equal(changed.mode, "hinges", "Une modification extérieure désactive le surlignage");
	assert.equal(analyses.current.mode, "formes", "La vérification d’une note modifie l’analyse d’une autre");
	const renderings = new NoteAnalyses();
	const firstRendering = renderings.activate(firstFile);
	firstRendering.mode = "hinges";
	firstRendering.aiSourcePath = firstFile.path;
	firstRendering.aiGroups = [{ id: 1, delFrom: 0, delTo: 4, delText: "Mais", insText: "Pourtant" }];
	firstRendering.grammalecteErrors = [{ nStart: 0, nEnd: 4, sRuleId: "test", sType: "orthographe", sMessage: "Faute", aSuggestions: [] }];
	const otherRendering = renderings.activate(secondFile);
	otherRendering.mode = "formes";
	const runtime: FinitionRuntime = {
		settings: { ...api.DEFAULT_SETTINGS, mode: "none", debounceMs: 0 }, settingsVersion: 0,
		getNoteAnalysis: (view, update) => renderings.forView(view, update),
		lexicon: new Map(), copuleLexicon: { forms: new Map(), participles: new Set(), adverbs: new Set() }, functionWords: new Set(), hedgingPhrases: [], stereotypePatterns: [], syntaxHinges: ["mais"],
		wordCategoryCache: new Map(), wordCategoryCacheVersion: 0, ensureWordCategories() {}, updateAnalysisHighlights() {}, updateTicIAStats() {},
	};
	const host = { ...runtime, aiGroups: [], aiGroupsVersion: 0, aiSourcePath: null, grammalecteErrors: [], grammalecteErrorsVersion: 0, updateGrammalecteHighlights() {} };
	const factories = [api.finitionEditorExtension(runtime), api.finitionAIExtension(host), api.finitionGrammalecteExtension(host as unknown as FinitionPlugin)];
	const renderedView = (file: Pick<TFile, "path">, text: string) => Object.assign(view(file, text), { dom: { addEventListener() {}, removeEventListener() {} }, dispatch() {} });
	const renderA = renderedView(firstFile, "Mais, je ne parle pas."), renderB = renderedView(secondFile, "Pourquoi ?");
	for (const [index, factory] of factories.entries()) {
		const create = factory as unknown as { create: (view: EditorView) => { decorations: DecorationSet; update: (update: ViewUpdate) => void; destroy?: () => void } };
		const a = create.create(renderA), b = create.create(renderB);
		try {
			assert.ok(a.decorations.size > 0, `L’extension ${index} efface une note en arrière-plan`);
			assert.equal(b.decorations.size > 0, index === 0, `L’extension ${index} mélange les analyses des notes`);
			runtime.settingsVersion++;
			a.update({ view: renderA, docChanged: false } as unknown as ViewUpdate);
			await new Promise(resolve => setTimeout(resolve, 0));
			assert.ok(a.decorations.size > 0, `Le rafraîchissement de l’extension ${index} efface la note quittée`);
		} finally { a.destroy?.(); b.destroy?.(); }
	}
	process.stdout.write("Analyses par note : états, modes, corrections, volets simultanés, positions et texte modifié vérifiés\n");
	process.stdout.write("Reset automatique : même onglet, changement d’onglet, événements répétés, renommage, fermeture et erreurs vérifiés\n");
}

if (process.argv[1]?.endsWith("check-note-reset.ts")) void checkNoteReset();
