import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import * as vm from "node:vm";
import * as process from "node:process";
import { build } from "esbuild";
import { rawAssets } from "../plugin/raw-assets.mjs";
import type { DiffGroup } from "../plugin/ai/diff";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { AIGroupHost } from "../plugin/ai/ai-extension";
import type { GetCategory } from "../plugin/modes/structure-signature";
import type { TicIAResult } from "../plugin/modes/tic-ia";
import type { FinitionSettings } from "../plugin/types";

async function main() {
	const dataSources = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "plugin/data"], { encoding: "utf8" }).split("\0").filter(file => file && existsSync(file));
	assert.ok(dataSources.every(file => file.endsWith(".json")), "Les sources de plugin/data doivent être uniquement des JSON d’analyse");
	const modules = await build({
		stdin: { contents: "export { default as gzipData } from \"./plugin/data/lexicon.json?gzip\"; export { EditorState } from \"@codemirror/state\"; export * from \"./plugin/ai/ai-extension\"; export * from \"./plugin/ai/protected-links\"; export * from \"./plugin/markdown-links\"; export * from \"./plugin/ai/clean\"; export * from \"./plugin/modes/punctuation\"; export * from \"./plugin/modes/clause-split\"; export * from \"./plugin/modes/structure-report\"; export * from \"./plugin/modes/statistics\"; export * from \"./plugin/modes/structure-signature\"; export * from \"./plugin/modes/ternary\"; export * from \"./plugin/modes/tic-ia\"; export { engineScripts } from \"./plugin/modes/grammalecte-resources\"; export { default as FinitionPlugin } from \"./main\";", resolveDir: process.cwd() },
		bundle: true, platform: "node", format: "cjs", write: false, loader: { ".md": "text" }, external: ["obsidian"], plugins: [rawAssets],
	});
	const notices: string[] = [];
	let requestHandler: (request: { url: string; body: string }) => unknown = () => { throw new Error("Appel API inattendu"); };
	class Notice {
		constructor(message: string) { notices.push(message); }
		setMessage(message: string) { notices.push(message); }
		hide() {}
	}
	const menuTitles: string[] = [];
	const menuDisabled = new Map<string, boolean>();
	const menuParents = new Map<string, string>();
	class Plugin {
		app = { workspace: { getActiveViewOfType: () => null } };
		saved: Partial<FinitionSettings> | null = null;
		async loadData() { return this.saved; }
		async saveData(settings: FinitionSettings) { this.saved = settings; }
	}
	class Menu {
		constructor(private parent = "") {}
		addItem(callback: (item: { setTitle: (title: string) => unknown }) => void) {
			const parent = this.parent;
			let title = "";
			const item = {
				setTitle(value: string) { title = value; menuTitles.push(value); menuParents.set(value, parent); return this; },
				setSubmenu() { return new Menu(title); },
				setIcon() { return this; }, setChecked() { return this; }, setDisabled(value: boolean) { menuDisabled.set(menuTitles[menuTitles.length - 1], value); return this; }, onClick() { return this; },
			};
			callback(item);
		}
		addSeparator() {}
		showAtMouseEvent() {}
	}
	const module = { exports: {} };
	const sandbox = vm.createContext({ module, exports: module.exports, Buffer, TextEncoder, TextDecoder, CompressionStream, Response, Blob, Date: class extends Date { constructor() { super("2026-10-19T12:34:56"); } }, require: (name: string) => {
		assert.equal(name, "obsidian");
		return { Plugin, PluginSettingTab: class {}, Modal: class {}, Component: class {}, Menu, Notice, setIcon() {}, requestUrl: (request: { url: string; body: string }) => requestHandler(request) };
	} });
	vm.runInContext(modules.outputFiles[0].text, sandbox);
	sandbox.document = { body: { classList: { toggle() {} } } };
	const api = module.exports as {
		gzipData: Uint8Array;
		buildStatisticsReport: typeof import("../plugin/modes/statistics").buildStatisticsReport;
		rawStatisticNames: typeof import("../plugin/modes/statistics").rawStatisticNames;
		statisticsWords: typeof import("../plugin/modes/statistics").statisticsWords;
		EditorState: typeof EditorState;
		finitionAIExtension: (host: AIGroupHost) => unknown;
		cleanTypography: (text: string) => string;
		fixPunctuationSpacing: (text: string) => string;
		fixBlankLinesProtected: (text: string) => string;
		linkRanges: (text: string) => Array<[number, number]>;
		protectLinks: (text: string, from?: number, to?: number) => { text: string; diff: (revised: string) => DiffGroup[] };
		engineScripts: string[];
		sentenceRanges: (text: string) => Array<[number, number]>;
		buildStructureReport: (text: string, getCategory: GetCategory) => string;
		structureCategoryWords: (text: string) => string[];
		structureGroupRanges: (text: string, from: number, to: number, category: GetCategory) => Array<[number, number]>;
		analyzeSentenceStructure: (text: string, from: number, to: number, category: GetCategory) => unknown;
		sentenceStructureSignatures: (texts: string[], getCategory: GetCategory) => string[];
		analyzeTicIA: (text: string, getCategory: GetCategory, lexicon?: Map<string, string>) => TicIAResult;
		tricolonRuns: (text: string, getCategory: GetCategory) => Array<{ from: number; to: number }>;
		tricolonMembership: (keys: Array<{ key: string; reduction: "none" }>) => Array<{ groupId: number; position: number } | null>;
		FinitionPlugin: new () => Plugin & {
			settings: FinitionSettings;
			aiGroups: DiffGroup[];
			loadSettings: () => Promise<void>;
			showModeMenu: (event: unknown) => void;
			runStructureReport: () => Promise<void>;
			runStatisticsReport: () => Promise<void>;
			runOrthoTypoIA: () => Promise<void>;
			createDebugNote: (view: unknown, content: string, prefix: string) => Promise<{ path: string }>;
		};
	};
	assert.equal(api.gzipData[9], 255, "Le gzip embarqué dépend du système de compilation");
	assert.ok(!/\brequire\s*\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/u.test(api.engineScripts.join("\n")), "Grammalecte embarque un accès direct au système de fichiers");
	const plugin = new api.FinitionPlugin();
	plugin.saved = { mode: "tic-ia" };
	await plugin.loadSettings();
	assert.equal(plugin.settings.mode, "ternary");
	assert.equal(plugin.saved.mode, "ternary");
	assert.equal(plugin.settings.debugMode, false);
	plugin.showModeMenu({});
	assert.ok(!menuTitles.some((title) => title.startsWith("Tic IA")));
	assert.ok(menuTitles.includes("Tricolons") && !menuTitles.includes("Structure"));
	assert.equal(menuDisabled.get("Tricolons"), true);
	assert.ok(menuTitles.includes("Synonymes IA"));
	assert.deepEqual(menuTitles.filter(title => !menuParents.get(title)), ["Surlignages", "Dictionnaires", "Grammalecte", "Neuronal", "Corrections IA", "Ponctuations", "Paramètres"]);
	assert.ok(!menuTitles.includes("Statistiques"));
	assert.deepEqual(menuTitles.filter(title => menuParents.get(title) === "Surlignages"), ["Répétitions", "Atténuations", "Stéréotypes", "Monotonie", "Tricolons", "Cadence", "Charnières"]);
	assert.deepEqual(menuTitles.filter(title => menuParents.get(title) === "Dictionnaires"), ["Synonyme", "Synonymes IA", "Définitions", "Antonymes", "Phonétique", "Rimes"]);
	plugin.settings.debugMode = true;
	await plugin.saveData(plugin.settings);
	await plugin.loadSettings();
	menuTitles.length = 0;
	plugin.showModeMenu({});
	assert.ok(menuTitles.includes("Structure"));
	assert.equal(menuTitles[menuTitles.indexOf("Structure") + 1], "Statistiques");
	assert.equal(menuDisabled.get("Statistiques"), true);
	assert.equal(menuDisabled.get("Structure"), true);
	plugin.settings.debugMode = false;
	menuTitles.length = 0;
	plugin.showModeMenu({});
	assert.ok(!menuTitles.includes("Structure"));
	assert.ok(!menuTitles.includes("Statistiques"));
	await plugin.runStructureReport();
	Object.defineProperty(plugin, "hasLinguisticResources", { value: true });
	Object.defineProperty(plugin, "hasAnalysisResources", { value: true });
	menuTitles.length = 0;
	plugin.showModeMenu({});
	assert.equal(menuDisabled.get("Tricolons"), false);
	assert.ok(!menuTitles.includes("Structure"));
	plugin.settings.debugMode = true;
	menuTitles.length = 0;
	plugin.showModeMenu({});
	assert.ok(menuTitles.includes("Structure"));
	assert.equal(menuDisabled.get("Structure"), false);
	process.stdout.write("Menu: Structure réservé au mode debug ; disponibilité liée aux ressources ; réglage persisté\n");
	const apply = (text: string, groups: DiffGroup[]) => [...groups].reverse().reduce((result, group) => result.slice(0, group.delFrom) + (group.insText ?? "") + result.slice(group.delTo), text);
	const sequence = "Suite à un collègue, je réponds.";
	const sequenceGroups = api.protectLinks(sequence).diff("A la suite d'un collègue, je réponds.");
	assert.equal(sequenceGroups.length, 1, "Un remplacement de plusieurs mots est morcelé");
	assert.equal(sequenceGroups[0].delText, "Suite à un");
	assert.equal(sequenceGroups[0].insText, "A la suite d’un");
	assert.equal(apply(sequence, sequenceGroups), "A la suite d’un collègue, je réponds.");
	for (const [source, revised, expected] of [
		[sequence, "À la suite d'un collègue, je réponds.", "À la suite d’un collègue, je réponds."],
		["Il dit bonjour.", "Il dit : bonjour.", "Il dit\u00a0: bonjour."],
		["Il dit bonjour. Une fote.", "Il dit : bonjour. Une faute.", "Il dit\u00a0: bonjour. Une faute."],
	] as const) {
		const host = { aiSourcePath: "source.md", aiGroups: api.protectLinks(source).diff(revised).map((group, id) => ({ ...group, id })), aiGroupsVersion: 0 };
		let state = api.EditorState.create({ doc: source }), filePath = "source.md";
		const listeners = new Map<string, (event: MouseEvent) => void>();
		const factory = api.finitionAIExtension(host) as { create: (view: EditorView) => { decorations: DecorationSet; update: (update: ViewUpdate) => void; destroy: () => void } };
		const view = { get state() { return { doc: state.doc, field: () => ({ file: { path: filePath } }) }; },
			dom: { addEventListener: (name: string, handler: (event: MouseEvent) => void) => listeners.set(name, handler), removeEventListener: (name: string) => listeners.delete(name) },
			dispatch(spec: TransactionSpec) { const transaction = state.update(spec); state = transaction.state; instance.update({ docChanged: transaction.docChanged, changes: transaction.changes } as ViewUpdate); },
		} as unknown as EditorView;
		const instance = factory.create(view);
		const before = JSON.stringify(host.aiGroups);
		filePath = "debug.md";
		view.dispatch({ changes: { from: 0, to: state.doc.length, insert: "Debug." } });
		assert.equal(instance.decorations.size, 0, "La note de debug reçoit les décorations de la note source");
		assert.equal(JSON.stringify(host.aiGroups), before, "Ouvrir une autre note déplace les suggestions source");
		filePath = "source.md";
		view.dispatch({ changes: { from: 0, to: state.doc.length, insert: source } });
		assert.equal(JSON.stringify(host.aiGroups), before, "Revenir à la note source déplace les suggestions");
		let removed = "", inserted = "";
		sandbox.createSpan = () => ({ dataset: {}, setAttribute() {}, textContent: "" });
		instance.decorations.between(0, source.length, (from, to, decoration) => {
			const spec = decoration.spec as { class?: string; widget?: { toDOM: () => { textContent: string } } };
			if (spec.class === "finition-ai-del") removed += source.slice(from, to);
			if (spec.widget) inserted += spec.widget.toDOM().textContent;
		});
		assert.equal(removed, host.aiGroups.map(group => group.delText).join(""), "La séquence n’est pas barrée en entier");
		assert.equal(inserted, host.aiGroups.map(group => group.insText ?? "").join(""), "Le widget altère le remplacement ou son insécable");
		for (const group of [...host.aiGroups]) listeners.get("click")!({ target: { closest: () => ({ dataset: { finitionAiGroup: String(group.id), finitionAiAction: "accept" } }) }, preventDefault() {} } as unknown as MouseEvent);
		assert.equal(state.doc.toString(), expected, "Le clic insère un remplacement incomplet ou une espace ordinaire");
		assert.equal(host.aiGroups.length, 0);
		instance.destroy();
	}
	process.stdout.write("Suggestions IA : séquences entières, insécable au clic et isolation de la note de debug vérifiées\n");
	for (const [source, revised, expected] of [
		["Il dit bonjour.", "Il dit : bonjour.", "Il dit\u00a0: bonjour."],
		["À propos de.", "À propos ?", "À propos\u00a0?"],
		["C'est bon?", "C'est bon?", "C’est bon\u00a0?"],
		["Il répond : oui!", "Il répond : oui !", "Il répond\u00a0: oui\u00a0!"],
		["«mot »; vraiment?", "«mot »; vraiment?", "«\u00a0mot\u00a0»\u00a0; vraiment\u00a0?"],
		["Et alors\u202f?", "Et alors\u202f?", "Et alors\u00a0?"],
		["– Salut!", "– Salut!", "—\u00a0Salut\u00a0!"],
		["Il vient – peut-être – demain.", "Il vient – peut-être – demain.", "Il vient –\u00a0peut-être\u00a0– demain."],
		["Premier.\n\n\nDernier.", "Premier.\n\n\nDernier.", "Premier.\n\nDernier."],
		["- Un\n\n- Deux", "- Un\n\n- Deux", "- Un\n- Deux"],
		["Voir [l’auteur](https://example.org/a?b=c) à propos de.", "Voir l’auteur à propos ?", "Voir [l’auteur](https://example.org/a?b=c) à propos\u00a0?"],
	] as const) {
		assert.equal(apply(source, api.protectLinks(source).diff(revised)), expected, "Une suggestion IA perd la typographie française");
		assert.equal(api.cleanTypography(revised), api.fixBlankLinesProtected(api.fixPunctuationSpacing(revised)), "Le retour IA ne suit pas les règles de Ponctuations");
	}
	for (const [source, revised] of [
		["Le modèle pèse 40\u00a0Mo.", "Le modèle pèse 40 Mo."],
		["Il avance –\u00a0à son rythme.", "Il avance – à son rythme."],
	] as const) assert.equal(api.protectLinks(source).diff(revised).length, 0, "L’IA propose de retirer une insécable correcte");
	for (const [source, expected] of [
		["40 Mo, 2 Ko, 3 Go, 1 To.", "40\u00a0Mo, 2\u00a0Ko, 3\u00a0Go, 1\u00a0To."],
		["40Mo, 3,5kg, 20 km/h, 10 m², 5 kWh, 2 µg, 25 °C.", "40\u00a0Mo, 3,5\u00a0kg, 20\u00a0km/h, 10\u00a0m², 5\u00a0kWh, 2\u00a0µg, 25\u00a0°C."],
		["Il avance – à son rythme.", "Il avance –\u00a0à son rythme."],
		["Il avance –à son rythme – puis s’arrête.", "Il avance –\u00a0à son rythme\u00a0– puis s’arrête."],
		["Il avance – doucement.\r\n\r\nIl recule – lentement.", "Il avance –\u00a0doucement.\r\n\r\nIl recule –\u00a0lentement."],
		["2019–2025, 10 – 20 km, 2 modèles, 3 minutes.", "2019–2025, 10 – 20\u00a0km, 2 modèles, 3 minutes."],
		["`40 Mo` [40 Mo](https://example.org/40Mo) ![10 kg](image.png)", "`40 Mo` [40 Mo](https://example.org/40Mo) ![10 kg](image.png)"],
	] as const) {
		assert.equal(api.fixPunctuationSpacing(source), expected, "Ponctuations perd une unité, un tiret ou une zone protégée");
		assert.equal(api.cleanTypography(source), expected, "La normalisation IA diffère de Ponctuations");
		assert.equal(api.fixPunctuationSpacing(expected), expected, "La normalisation des unités et incises n’est pas idempotente");
	}
	process.stdout.write("Typographie IA : insécables, apostrophes, guillemets, tirets, paragraphes et liens vérifiés\n");
	const tagged = "# Une fote.\nUne fote #bonjor une errer.";
	const withoutTags = api.protectLinks(tagged);
	assert.equal(withoutTags.text, "# Une fote.\nUne fote une errer.", "Un hashtag est soumis au correcteur IA ou un titre est masqué");
	assert.equal(apply(tagged, withoutTags.diff(withoutTags.text.replaceAll("fote", "faute").replace("errer", "erreur"))), tagged.replaceAll("fote", "faute").replace("errer", "erreur"), "Les corrections autour d’un hashtag perdent leurs positions");
	const tagOnly = "#école/test #40Mo #🌿";
	assert.equal(api.protectLinks(tagOnly).text.trim(), "", "Un tag Unicode, imbriqué ou contenant un nombre est envoyé à l’IA");
	assert.equal(api.fixPunctuationSpacing(tagOnly), tagOnly, "Ponctuations modifie un hashtag");
	const tagStart = tagged.indexOf("#bonjor");
	assert.equal(api.protectLinks(tagged, tagStart + 2, tagStart + 5).text, "", "Une sélection partielle expose le contenu d’un hashtag");
	assert.equal(api.protectLinks("[Un #bonjor](https://example.org/#section)").text.trim(), "Un", "Un hashtag dans un libellé de lien est envoyé à l’IA");
	assert.equal(api.protectLinks("# Titre\n## Titre\n#1984 et C#code").text, "# Titre\n## Titre\n#1984 et C#code", "Une syntaxe qui n’est pas un hashtag est masquée");
	const linkCases = [
		"[Finition](https://example.org/article?q=1&lang=fr)", "![Image](app://local/a(b).webp?123)",
		"[des [mots]](https://example.org/a_(b) \"titre (avec parenthèses)\")", "[titre](<https://example.org/a)b> \"titre\")",
		"[[Note|Libellé]]", "![[Image.png]]", "<https://example.org/a?b=c>", "https://example.org/l'auteur?q=oui!", "[https://example.org/bracket]",
		"<a href='https://example.org/a?b=c'>Texte</a>", "<img src=\"https://example.org/a?b=c\" alt=\"l'auteur > celui-ci\">", "<video src='https://example.org/v.mp4'></video>", "zotero://select/library/items/ABC", "<a@example.org>", "d'angelo@example.org", "[texte][r]\n[r]: https://example.org/a?b=c", "[r]\n[r]: https://example.org/a?b=c", "[texte] [r]\n[r]: https://example.org/a?b=c",
	];
	for (const link of linkCases) {
		const text = `Une fote ${link}\n\nune errer.`;
		const ranges = api.linkRanges(text);
		assert.ok(ranges.length, `Lien non reconnu : ${link}`);
		for (const transform of [api.cleanTypography, api.fixPunctuationSpacing, api.fixBlankLinesProtected]) {
			assert.equal(transform(link), link, `Un lien isolé est altéré : ${link}`);
			const transformed = transform(text);
			assert.ok(transformed.includes(link), `Ponctuations ou normalisation IA altère un lien : ${link}`);
			assert.equal(transform(transformed), transformed, "La ponctuation protégée n’est pas idempotente");
		}
		const guarded = api.protectLinks(text);
		assert.ok(!guarded.text.includes("https://") && !guarded.text.includes("app://"), `Adresse envoyée à l’IA : ${link}`);
		assert.equal(guarded.diff(guarded.text).length, 0, `Une réponse inchangée altère un lien : ${link}`);
		const groups = guarded.diff(guarded.text.replace("fote", "faute").replace("errer", "erreur"));
		assert.equal(apply(text, groups), text.replace("fote", "faute").replace("errer", "erreur"));
		assert.ok(groups.every(group => ranges.every(([from, to]) => group.delTo <= from || group.delFrom >= to)), "Une suggestion englobe un lien");
	}
	assert.equal(api.fixPunctuationSpacing("C'est bon! À 10:30. `a:b?`"), "C’est bon\u00a0! À 10:30. `a:b?`");
	assert.equal(api.fixBlankLinesProtected("Avant.\n\n\n```\nconst x = 'https://a.test?a:b';\n\n\n```\n\n\nAprès."), "Avant.\n\n```\nconst x = 'https://a.test?a:b';\n\n\n```\n\nAprès.");
	assert.ok(api.fixPunctuationSpacing("\uE0000\uE001 [mot](https://example.org?q=1)").includes("\uE0000\uE001 [mot](https://example.org?q=1)"));
	for (const [source, expected] of [
		["je développe [Unshiter](https://github.com/tcrouzet/unshiter), une app.", "je développe Unshiter, une app."],
		["[Antidote](https://antidote.info), le correcteur de [Druide](https://druide.com), intégré à [Obsidian](https://obsidian.md) avec [Finition](https://github.com/tcrouzet/finition).", "Antidote, le correcteur de Druide, intégré à Obsidian avec Finition."],
		["![Une image](app://local/image.webp)", "Une image"],
		["[[Note|Un libellé]][Autre](https://a.test)", "Un libelléAutre"],
		["Voir [r].\n\n[r]: https://a.test", "Voir r.\n\n"],
		["Avant\r\n[r]: https://a.test\r\nAprès.", "Avant\r\nAprès."],
		["<a href='https://a.test'><b>Mot visible</b></a>", "Mot visible"],
		["<img src='https://a.test/img' alt='Image visible'>", "Image visible"],
		["Voir [https://a.test](https://a.test)", "Voir "],
	] as const) assert.equal(api.protectLinks(source).text, expected, "Le libellé visible disparaît ou un marqueur/une adresse est envoyé");
	for (const text of ["Une fote [Mot](https://a.test), une errer.", "😀 Une fote [Mot](https://a.test)\r\nune errer.", "Une fote [Mot](https://a.test)[Mot](https://b.test) une errer."]) {
		const guarded = api.protectLinks(text);
		assert.equal(apply(text, guarded.diff(guarded.text.replace("fote", "faute").replace("errer", "erreur"))), text.replace("fote", "faute").replace("errer", "erreur"));
		const changed = guarded.diff(guarded.text.replace(/Mot/g, "Autre"));
		assert.equal(apply(text, changed), text, "Un libellé de lien a été modifié");
	}
	const punctuation = "Voir [Finition](https://a.test), vraiment.";
	assert.equal(apply(punctuation, api.protectLinks(punctuation).diff("Voir Finition ; vraiment.")), "Voir [Finition](https://a.test)\u00a0; vraiment.");
	const hidden = "Avant https://a.test après.";
	assert.equal(apply(hidden, api.protectLinks(hidden).diff("Texte changé.")), hidden, "Une suggestion traverse une adresse masquée");
	const collision = "⟦LIEN0⟧ [mot](https://example.org)";
	assert.equal(api.protectLinks(collision).diff(api.protectLinks(collision).text).length, 0);
	for (let depth = 1; depth <= 32; depth++) {
		const nested = `[${"[".repeat(depth)}mot${"]".repeat(depth)}](https://example.org/${"(".repeat(depth)}x${")".repeat(depth)})`;
		assert.equal(api.linkRanges(nested)[0][1], nested.length, "Les parenthèses ou crochets imbriqués tronquent un lien");
	}
	process.stdout.write("Liens IA : URL intactes, images, liens imbriqués, références, libellés visibles et positions vérifiés\n");
	const aiPlugin = new api.FinitionPlugin();
	await aiPlugin.loadSettings();
	aiPlugin.settings.aiModel = "gpt-test";
	aiPlugin.settings.openaiApiKey = "test";
	aiPlugin.settings.aiApiKey = "test";
	let sourceText = "J’ai des mots.";
	let aiFrom = 0, aiTo: number | undefined;
	let failWrite = false;
	let writeOverride: string | null = null;
	const notes = new Map<string, string>();
	const opened: string[] = [];
	const sourceView = { file: { path: "Dossier/Article.md", basename: "Article", parent: { path: "Dossier" } }, editor: {
		getValue: () => sourceText, getSelection: () => sourceText.slice(aiFrom, aiTo), somethingSelected: () => true,
		getCursor: () => ({ line: 0, ch: aiFrom }), posToOffset: (position: { ch: number }) => position.ch,
	} };
	Object.assign(aiPlugin.app, { vault: {
		getAbstractFileByPath: (path: string) => notes.has(path) ? { path } : null,
		async create(path: string, content: string) {
			if (failWrite) throw new Error("Disque plein");
			assert.ok(!notes.has(path), "Une note existante serait écrasée");
			notes.set(path, writeOverride ?? content);
			return { path };
		},
		async read(file: { path: string }) { return notes.get(file.path) ?? ""; },
		async process(file: { path: string }, transform: (content: string) => string) {
			const content = transform(notes.get(file.path) ?? "");
			notes.set(file.path, content);
			return content;
		},
	}, workspace: {
		getActiveViewOfType: () => sourceView, iterateAllLeaves() {},
		getLeaf: () => ({ async openFile(file: { path: string }) { opened.push(file.path); } }),
	} });
	const raw = `"J'ai des mots."`;
	requestHandler = request => {
		assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
		const body = JSON.parse(request.body) as { messages: Array<{ content: string }> };
		assert.equal(body.messages[1].content, sourceText);
		return { status: 200, json: { choices: [{ message: { content: raw } }] } };
	};
	await aiPlugin.runOrthoTypoIA();
	assert.equal(notes.size, 0, "Une note Debug est créée alors que Debug est désactivé");
	aiPlugin.settings.debugMode = true;
	await aiPlugin.runOrthoTypoIA();
	assert.equal(notes.get("Dossier/Article (2026-10-19 123456).md"), raw, "Le retour IA brut n’est pas conservé");
	assert.equal(sourceText, "J’ai des mots.", "La note source a changé");
	assert.equal(opened.length, 0, "La sauvegarde Debug détourne l’éditeur de la note source");
	aiPlugin.settings.aiModel = "claude-test";
	aiPlugin.settings.aiChunkSize = 10;
	sourceText = "Premier paragraphe.\n\nDeuxième paragraphe.";
	const replies: string[] = [];
	requestHandler = request => {
		assert.equal(request.url, "https://api.anthropic.com/v1/messages");
		const body = JSON.parse(request.body) as { messages: Array<{ content: string }> };
		const text = `[${body.messages[0].content}]`;
		replies.push(text);
		return { status: 200, json: { content: [{ type: "text", text }] } };
	};
	await aiPlugin.runOrthoTypoIA();
	assert.equal(replies.length, 2);
	assert.equal(notes.get("Dossier/Article (2026-10-19 123456) 2.md"), replies.join("\n\n"), "Les réponses des tronçons sont perdues ou la note précédente est écrasée");
	requestHandler = () => ({ status: 401, text: "Refus", json: { error: { message: "Refus" } } });
	await aiPlugin.runOrthoTypoIA();
	assert.equal(notes.size, 2, "Une erreur API crée une fausse réponse Debug");
	requestHandler = () => {
		sourceText += "!";
		return { status: 200, json: { content: [{ type: "text", text: sourceText }] } };
	};
	await aiPlugin.runOrthoTypoIA();
	assert.equal(notes.size, 2, "Une analyse périmée crée une note Debug");
	requestHandler = () => ({ status: 200, json: { content: [{ type: "text", text: sourceText }] } });
	failWrite = true;
	await aiPlugin.runOrthoTypoIA();
	assert.equal(notes.size, 2);
	assert.ok(notices.some(message => message.includes("Disque plein")), "L’échec d’écriture est masqué");
	failWrite = false;
	aiPlugin.settings.debugMode = false;
	aiPlugin.settings.aiModel = "gpt-test";
	aiPlugin.settings.aiChunkSize = 2000;
	sourceText = "Une fote [Finition](https://example.org/article?q=1&lang=fr) une errer.";
	requestHandler = request => {
		const body = JSON.parse(request.body) as { messages: Array<{ content: string }> };
		assert.equal(body.messages[0].content, aiPlugin.settings.aiPrompt);
		assert.equal(body.messages[1].content, "Une fote Finition une errer.");
		assert.ok(!body.messages[1].content.includes("https://") && !body.messages[1].content.includes("example.org"), "L’API reçoit encore les adresses");
		return { status: 200, json: { choices: [{ message: { content: body.messages[1].content.replace("fote", "faute").replace("errer", "erreur") } }] } };
	};
	await aiPlugin.runOrthoTypoIA();
	assert.equal(apply(sourceText, aiPlugin.aiGroups), sourceText.replace("fote", "faute").replace("errer", "erreur"), "Les corrections IA altèrent les liens ou leurs positions");
	const onlyTags = "#bonjor #école/été #🌿", taggedTitle = "# Une fote. #bonjor";
	for (const [document, from, to, expected] of [["Avant [mot](https://example.org/page?q=1) après.", 17, 27, ""], ["Voir [r].\n\n[r]: https://example.org/ref", 5, 8, "r"], ["Avant [libellé](https://example.org) après.", 8, 12, "ibel"], [onlyTags, 0, onlyTags.length, ""], [taggedTitle, 0, taggedTitle.length, "# Une fote."], [taggedTitle, taggedTitle.indexOf("#bonjor") + 2, taggedTitle.length - 1, ""]] as const) {
		sourceText = document;
		aiFrom = from; aiTo = to;
		let calls = 0;
		requestHandler = request => {
			calls++;
			const body = JSON.parse(request.body) as { messages: Array<{ content: string }> };
			assert.equal(body.messages[1].content, expected, "Une sélection partielle perd son libellé ou transmet une adresse");
			return { status: 200, json: { choices: [{ message: { content: body.messages[1].content } }] } };
		};
		await aiPlugin.runOrthoTypoIA();
		assert.equal(calls, expected ? 1 : 0, "Un contenu protégé sans prose est envoyé à l’IA");
		assert.equal(aiPlugin.aiGroups.length, 0, "Une sélection protégée est modifiée");
	}
	aiFrom = 0; aiTo = undefined;
	sourceText = "Depuis le mois d’août, je développe [Unshiter](https://github.com/tcrouzet/unshiter), une app.\n\n[Antidote](https://antidote.info), le correcteur de [Druide](https://druide.com), intégré à [Obsidian](https://obsidian.md). Je code [Finition](https://github.com/tcrouzet/finition).";
	aiPlugin.settings.debugMode = true;
	const plain = "Depuis le mois d’août, je développe Unshiter, une app.\n\nAntidote, le correcteur de Druide, intégré à Obsidian. Je code Finition.";
	requestHandler = request => {
		const body = JSON.parse(request.body) as { messages: Array<{ content: string }> };
		assert.equal(body.messages[1].content, plain, "Le scénario signalé perd des mots dans le texte envoyé");
		return { status: 200, json: { choices: [{ message: { content: plain } }] } };
	};
	await aiPlugin.runOrthoTypoIA();
	assert.equal(aiPlugin.aiGroups.length, 0);
	assert.equal(notes.get("Dossier/Article (2026-10-19 123456) 3.md"), plain, "La note Debug contient encore des marqueurs");
	aiPlugin.settings.debugMode = false;
	for (const model of ["gpt-test", "claude-test"]) {
		aiPlugin.settings.aiModel = model;
		sourceText = "Voir [Finition](https://example.org/a?b=c) à propos de.";
		requestHandler = () => ({ status: 200, json: { choices: [{ message: { content: "Voir Finition à propos ?" } }], content: [{ type: "text", text: "Voir Finition à propos ?" }] } });
		await aiPlugin.runOrthoTypoIA();
		assert.equal(apply(sourceText, aiPlugin.aiGroups), "Voir [Finition](https://example.org/a?b=c) à propos\u00a0?", `L’insécable est perdue dans les suggestions ${model}`);
	}
	aiPlugin.settings.debugMode = true;
	aiPlugin.settings.aiModel = "claude-test";
	sourceText = "J’ai des mots.";
	const blocks = [" \n".repeat(100), "J’ai des mots."];
	requestHandler = () => ({ status: 200, json: { content: [{ type: "thinking", thinking: "Interne" }, ...blocks.map(text => ({ type: "text", text }))] } });
	await aiPlugin.runOrthoTypoIA();
	assert.equal(notes.get("Dossier/Article (2026-10-19 123456) 4.md"), blocks.join(""), "Les blocs de texte Anthropic après un bloc vide sont perdus");
	for (const model of ["gpt-test", "claude-test"]) {
		aiPlugin.settings.aiModel = model;
		for (const blank of ["", " \n".repeat(100), "\u200b\u2060\ufeff".repeat(100)]) {
			const before: number = notes.size;
			const noticesBefore = notices.length;
			let calls = 0;
			requestHandler = () => {
				calls++;
				return { status: 200, json: { choices: [{ message: { content: blank } }], content: [{ type: "text", text: blank }] } };
			};
			await aiPlugin.runOrthoTypoIA();
			assert.equal(notes.size, before, `Une réponse vide ${model} crée une note horodatée`);
			assert.equal(aiPlugin.aiGroups.length, 0, "Une réponse vide propose de supprimer le texte");
			assert.equal(calls, 3, "Une réponse vide ne suit pas les tentatives prévues");
			assert.ok(notices.slice(noticesBefore).some(message => message.includes("erreur")), "Une réponse vide est annoncée comme réussie");
		}
	}
	await assert.rejects(aiPlugin.createDebugNote(sourceView, " \n\u200b\u2060", ""), /aucun texte/i, "Une note vide peut encore être créée directement");
	writeOverride = "";
	const recovered = await aiPlugin.createDebugNote(sourceView, "Réponse IA reçue.", "");
	assert.equal(notes.get(recovered.path), "Réponse IA reçue.", "Une réponse non vide aboutit à une note vide sans vérification");
	writeOverride = "Modification manuelle.";
	await assert.rejects(aiPlugin.createDebugNote(sourceView, "Réponse IA reçue.", ""), /contenu/i, "Une écriture différente est annoncée comme réussie");
	assert.ok([...notes.values()].includes("Modification manuelle."), "La vérification écrase une modification extérieure");
	writeOverride = null;
	process.stdout.write("Debug IA : réponses vides refusées, blocs de texte conservés, réponse brute, tronçons, collision, erreurs et annulation vérifiés\n");
	const lexiconData = JSON.parse(readFileSync(new URL("../plugin/data/lexicon.json", import.meta.url), "utf8")) as Record<string, string>;
	const lexicon = new Map(Object.entries(lexiconData));
	const analyze = (text: string, category: GetCategory) => api.analyzeTicIA(text, category, lexicon);
	const root = new URL("../plugin/vendor/grammalecte/", import.meta.url);
	const read = (name: string) => readFileSync(new URL(name, name.endsWith(".json") ? new URL("../resources/grammalecte/", import.meta.url) : root), "utf8");
	const files = ["helpers.js", "str_transform.js", "char_player.js", "lexgraph_fr.js", "ibdawg.js", "spellchecker.js", "text.js", "tokenizer.js", "conj.js", "mfsp.js", "phonet.js", "thesaurus.js", "cregex.js", "gc_options.js", "gc_functions.js", "gc_rules.js", "gc_rules_graph.js", "gc_engine.js"];
	const driver = await build({ entryPoints: ["plugin/modes/grammalecte-driver.ts"], bundle: true, platform: "browser", format: "iife", target: "es2020", write: false });
	let response: { bError: boolean; result: Record<string, string> } = { bError: false, result: {} };
	const context = vm.createContext({ console, TextEncoder, TextDecoder, onmessage: null, postMessage: (value: typeof response) => { response = value; } }) as vm.Context & {
		self: vm.Context;
		onmessage: (message: { data: { sCommand: string; oParam: unknown } }) => void;
	};
	context.self = context;
	vm.runInContext([...files.map(read), driver.outputFiles[0].text].join("\n;\n"), context);
	context.onmessage({ data: { sCommand: "init", oParam: {
		oDictionary: JSON.parse(read("_dictionaries/fr-classic.json")) as unknown, sConjData: read("conj_data.json"),
		sPhonetData: read("phonet_data.json"), sMfspData: read("mfsp_data.json"),
		sThes1Data: read("thesaurus1_data.json"), sThes2Data: read("thesaurus2_data.json"),
	} } });
	assert.equal(response.bError, false, JSON.stringify(response.result));

	function categoriesFor(text: string): GetCategory {
		context.onmessage({ data: { sCommand: "lexicalCategories", oParam: { words: api.structureCategoryWords(text) } } });
		assert.equal(response.bError, false, JSON.stringify(response.result));
		const categories = response.result;
		return (word: string) => categories[word.toLowerCase()] ?? "";
	}


	const readStats = (report: string): Record<string, number | string> => Object.fromEntries(report.split("---")[1].trim().split("\n").map(line => {
		const [name, value] = line.split(": ");
		return [name, JSON.parse(value) as number | string];
	}));
	const emptyStats = readStats(await api.buildStatisticsReport("", () => "", lexicon));
	assert.equal(Object.keys(emptyStats).length, 108);
	assert.equal(new Set(api.rawStatisticNames).size, 108);
	assert.deepEqual(Object.keys(emptyStats), Array.from(api.rawStatisticNames));
	for (const name of ["word_count", "sentence_count", "paragraph_count", "document_char_count", "utf8_byte_count", "gzip_byte_count", "ternary_count", "hapax_count", "bigram_count"]) assert.equal(emptyStats[name], 0, name);
	for (const name of ["relative_clause_count", "passive_sentence_count", "local_phonetic_repetition_count", "adjective_count"]) assert.equal(emptyStats[name], "-", name);
	const sample = "# Titre\r\n\r\nÉté 😀...\r\n\r\n— Oui ! Encore !\r\n\r\nIl dit : « Bonjour ! » (demain) – ici – ?;";
	const normalized = sample.replace(/\r\n/g, "\n").replace(/\.{3}/g, "…");
	const sampleReport = await api.buildStatisticsReport(sample, categoriesFor(sample), lexicon);
	const sampleStats = readStats(sampleReport);
	assert.equal(sampleStats.document_char_count, [...normalized].length);
	assert.equal(sampleStats.utf8_byte_count, new TextEncoder().encode(normalized).length);
	assert.equal(sampleStats.paragraph_count, 4);
	assert.equal(sampleStats.dialog_word_count, 2);
	assert.equal(sampleStats.exclamation_point_count, 1);
	assert.equal(sampleStats.dash_count, 2);
	assert.equal(sampleStats.suspention_point_count, 1);
	assert.equal(sampleStats.period_count, 0);
	assert.equal(sampleStats.parenthesis_count, 1);
	assert.equal(sampleStats.quote_mark_count, 2);
	assert.ok(Number(sampleStats.gzip_byte_count) > 0);
	assert.equal(await api.buildStatisticsReport(sample, categoriesFor(sample), lexicon), sampleReport, "Le rapport change entre deux analyses identiques");
	const repetitionSample = "chats chat chiens chien. ".repeat(251);
	const repeatStats = readStats(await api.buildStatisticsReport(repetitionSample, () => "nom", new Map([["chats", "chat"], ["chiens", "chien"]])));
	assert.equal(repeatStats.word_count, 1004);
	assert.equal(repeatStats.unique_lemma_count, 2);
	assert.equal(repeatStats.global_repetition_count, 1002);
	assert.equal(repeatStats.local_repetition_count, 1000, "Le dernier bloc incomplet est perdu");
	assert.equal(repeatStats.hapax_count, 0);
	assert.equal(repeatStats.bigram_count, 4);
	const ternaryText = "Je prends des pommes, des poires et des cerises.";
	assert.equal(readStats(await api.buildStatisticsReport(ternaryText, categoriesFor(ternaryText), lexicon)).ternary_count, 1);
	assert.equal(api.tricolonRuns(ternaryText, categoriesFor(ternaryText)).length, 1);
	const statsPlugin = new api.FinitionPlugin();
	statsPlugin.app = aiPlugin.app;
	statsPlugin.settings = { ...aiPlugin.settings, debugMode: false, analysisEngine: "finition-corrector" };
	let installed = false, engineCalls = 0;
	Object.assign(statsPlugin, { lexicon, isLinguisticEngineInstalled: (engine: string) => installed && engine === "grammalecte", ensureGrammalecteEngine: async () => {
		engineCalls++;
		return { getCategories: async (words: string[]) => {
			assert.ok(words.includes("cerises"), "Seule la sélection est analysée");
			context.onmessage({ data: { sCommand: "lexicalCategories", oParam: { words } } });
			return response.result;
		} };
	} });
	sourceText = ternaryText;
	aiFrom = 0; aiTo = 2;
	const previousNoteCount = notes.size;
	statsPlugin.settings.debugMode = true;
	await statsPlugin.runStatisticsReport();
	assert.equal(engineCalls, 0, "Le moteur est lancé sans dictionnaire installé");
	assert.equal(notes.size, previousNoteCount);
	installed = true;
	statsPlugin.settings.debugMode = false;
	await statsPlugin.runStatisticsReport();
	assert.equal(notes.size, previousNoteCount, "Statistiques crée une note hors mode debug");
	statsPlugin.settings.debugMode = true;
	statsPlugin.showModeMenu({});
	assert.equal(menuDisabled.get("Statistiques"), false);
	sandbox.createFragment = () => ({ append() {} });
	sandbox.createSpan = () => ({});
	await statsPlugin.runStatisticsReport();
	const statsPath = "Dossier/Article_stats_2026-10-19_123456.md";
	assert.ok(notes.has(statsPath), "La note Statistiques n’est pas créée");
	assert.equal(readStats(notes.get(statsPath) ?? "").word_count, api.statisticsWords(ternaryText).length);
	assert.equal(opened.at(-1), statsPath);
	await statsPlugin.runStatisticsReport();
	assert.ok(notes.has("Dossier/Article_stats_2026-10-19_123456 2.md"));
	assert.equal(sourceText, ternaryText);
	assert.equal(statsPlugin.settings.analysisEngine, "finition-corrector");
	assert.equal(statsPlugin.settings.debugMode, true);
	process.stdout.write("Statistiques : 108 variables YAML, Unicode, dialogues, gzip stable, lemmes, blocs de répétitions, tricolons, note complète et collisions vérifiés\n");

	let enumerationFailures = 0;
	let enumerationChecks = 0;
	const checkEnumeration = (text: string, expected: number) => {
		enumerationChecks++;
		const category = categoriesFor(text);
		const count = api.tricolonRuns(text, category).length;
		const report = api.buildStructureReport(text, category).trim().split("\n").at(-1) ?? "";
		if (count !== expected || (report.match(/\(1\)/g) ?? []).length !== expected) {
			enumerationFailures++;
			console.error(`${text}\n  tricolons: ${count}, expected: ${expected}\n  ${report}`);
			console.error(api.structureCategoryWords(text).map((word) => [word, category(word)]));
		}
	};
	const nouns = ["des chats", "des chiens", "des oiseaux", "des chevaux", "des lapins", "des poules", "des canards", "des moutons", "des chèvres"];
	for (let count = 2; count <= nouns.length; count++) {
		const items = nouns.slice(0, count);
		for (const prefix of ["", "Je vois "]) {
			for (const connector of [", ", " et ", " ou ", " ni "]) {
				checkEnumeration(`${prefix}${items.slice(0, -1).join(", ")}${connector}${items.at(-1)}.`, count === 3 ? 1 : 0);
			}
		}
		const qualified = items.map((item, index) => index % 2 === 0 ? item : `${item} sauvages`);
		checkEnumeration(`${qualified.join(", ")}.`, count === 3 ? 1 : 0);
		const membership = api.tricolonMembership(items.map(() => ({ key: "COMPLÉMENT", reduction: "none" })));
		if (membership.filter(Boolean).length !== (count === 3 ? 3 : 0)) {
			enumerationFailures++;
			console.error(`Une suite de ${count} clés identiques est découpée en tricolons`);
		}
	}
	checkEnumeration("Un rire sec, maigre et tordu.", 1);
	checkEnumeration("Un rire sec, maigre, tordu et nerveux.", 0);
	checkEnumeration("Des chats, des oiseaux, des chiens noirs et blancs.", 1);
	checkEnumeration("Des chats noirs, des chiens bruns et des oiseaux blancs.", 1);
	checkEnumeration("Des chats noirs, des chiens bruns, des oiseaux blancs et des chevaux gris.", 0);
	checkEnumeration("Un rire sec, maigre, tordu, nerveux, bref et froid.", 0);
	checkEnumeration("Il voit la mer, il regarde le ciel et il observe les nuages.", 1);
	checkEnumeration("Il voit la mer, il regarde le ciel, il observe les nuages et il écoute le vent.", 0);
	checkEnumeration("J’ai acheté du pain, du beurre et du lait.", 1);
	checkEnumeration("J’ai acheté du pain, du beurre, du lait et du sucre.", 0);
	checkEnumeration("Des chats, des chiens et des oiseaux et des chevaux.", 0);
	process.stdout.write(`Énumérations: ${enumerationChecks} phrases ; ${enumerationFailures} échecs\n`);
	assert.equal(enumerationFailures, 0);
	const detachedCases: Array<[string, string]> = [
		["Nous t’avons enterrée hier en pleine terre, dans le cimetière de Montagnac en Lot-et-Garonne, derrière l’église en surplomb de la vallée de la Lède, presque au-dessus de ta maison de famille.", "SUJET VERBE COMPLÉMENT, COMPLÉMENT, COMPLÉMENT, COMPLÉMENT."],
		["Pas de curé, bien sûr.", "NOM, COMPLÉMENT."],
		["C’était mon rôle, comme pour notre mariage, célébré à quelques pas, sur le perron de la mairie trop petite pour accueillir nos proches.", "SUJET VERBE COMPLÉMENT, COMPLÉMENT, COMPLÉMENT, COMPLÉMENT."],
		["Nous avons marché, dans le jardin, derrière la maison, près du mur.", "SUJET VERBE, COMPLÉMENT, COMPLÉMENT, COMPLÉMENT."],
		["Il y avait un blessé, bien sûr.", "SUJET VERBE COMPLÉMENT, COMPLÉMENT."],
	];
	let detachedFailures = 0;
	for (const [text, expected] of detachedCases) {
		const category = categoriesFor(text);
		const actual = api.buildStructureReport(text, category).trim().split("\n").at(-1) ?? "";
		const groups = api.structureGroupRanges(text, 0, text.length, category).map(([from, to]) => text.slice(from, to));
		assert.equal(groups.join(" | "), text.split(",").map((group) => group.trim()).join(" | "), "Les groupes détachés et leurs positions doivent être conservés");
		if (actual.replace(/ \([123]\)/g, "") !== expected) {
			detachedFailures++;
			console.error(`${text}\n  expected: ${expected}\n  actual: ${actual}`);
			console.error(api.structureCategoryWords(text).map((word) => [word, category(word)]));
		}
	}
	process.stdout.write(`Groupes détachés: ${detachedCases.length} phrases ; ${detachedFailures} échecs\n`);
	assert.equal(detachedFailures, 0);

	const cases: Array<[string, string]> = [
		["Le plus souvent, je restais dehors, mais en route vers le Lot-et-Garonne, nous avons allumé pour toi des cierges dans l’abbatiale de Moissac, comme nous l’avions fait ensemble alors que ta mère était souffrante.", "CADRATIF, SUJET VERBE COMPLÉMENT, mais COMPLÉMENT, SUJET VERBE COMPLÉMENT, comme SUBORDONNÉE."],
		["Si tu me rudoyais, me remettais en place ou te moquais de mes défauts, tu étais néanmoins ma vigie et ma boussole.", "si SUJET VERBE COMPLÉMENT (1), VERBE COMPLÉMENT (2), ou VERBE COMPLÉMENT (3), SUJET VERBE COMPLÉMENT."],
		["Si tu me rudoyais, me remettais en place, te moquais de mes défauts ou me donnais des ordres, tu étais ma vigie.", "si SUJET VERBE COMPLÉMENT, VERBE COMPLÉMENT, VERBE COMPLÉMENT, ou VERBE COMPLÉMENT, SUJET VERBE COMPLÉMENT."],
		["Si tu chantais, dansais et riais, je restais dehors.", "si SUJET VERBE (1), VERBE (2), et VERBE (3), SUJET VERBE COMPLÉMENT."],
		["Tu me rudoyais, me remettais en place et te moquais de mes défauts.", "SUJET VERBE COMPLÉMENT (1), VERBE COMPLÉMENT (2), et VERBE COMPLÉMENT (3)."],
		["Tu me rudoyais, me remettais en place, te moquais de mes défauts et me donnais des ordres.", "SUJET VERBE COMPLÉMENT, VERBE COMPLÉMENT, VERBE COMPLÉMENT, et VERBE COMPLÉMENT."],
		["Tu me rudoyais, elle me remettait en place et il se moquait de mes défauts.", "SUJET VERBE COMPLÉMENT (1), SUJET VERBE COMPLÉMENT (2), et SUJET VERBE COMPLÉMENT (3)."],
		["Les enfants près de moi, j’ai parlé, une main sur ton cercueil de sapin ordinaire, pour qu’il se décompose vite.", "CADRATIF, SUJET VERBE, COMPLÉMENT, pour SUBORDONNÉE."],
		["À 8:02, j’ai entendu le premier POW !", "CADRATIF, SUJET VERBE COMPLÉMENT."],
		["Pour toi, un symbole de fraternité écologique : les rameaux gardent leur tige, leurs feuilles, leur orientation, et composent une figure commune : à plusieurs, nous sommes plus forts.", "CADRATIF, NOM : SUJET VERBE COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3), et VERBE COMPLÉMENT : CADRATIF, SUJET VERBE COMPLÉMENT."],
		["En voyage, tu t’arrêtais dans les églises : tu y convoquais l’humanité plutôt qu’un Dieu hypothétique.", "CADRATIF, SUJET VERBE COMPLÉMENT : SUJET VERBE COMPLÉMENT."],
		["Je vois des chats, des chiens : des oiseaux.", "SUJET VERBE COMPLÉMENT, COMPLÉMENT : NOM."],
		["J’ai perdu le nord, mais j’honorerai la vie pour t’honorer.", "SUJET VERBE COMPLÉMENT, mais SUJET VERBE COMPLÉMENT."],
		["Nous attendions la pluie, la boue et le vent, mais une trouée de bleu nous a offert un avant-goût de printemps.", "SUJET VERBE COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3), mais SUJET VERBE COMPLÉMENT."],
		["Nous attendions la pluie, la boue et le vent et la neige, mais le ciel était bleu.", "SUJET VERBE COMPLÉMENT, COMPLÉMENT, COMPLÉMENT, COMPLÉMENT, mais SUJET VERBE COMPLÉMENT."],
		["Nous attendions la pluie, la boue et le vent, mais il voyait le soleil, les nuages et les oiseaux.", "SUJET VERBE COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3), mais SUJET VERBE COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3)."],
		["Le lundi, lors d’un de tes rares éclairs de conscience, je t’ai dit combien je t’aimais.", "CADRATIF, CADRATIF, SUJET VERBE COMPLÉMENT."],
		["Tu t’es battue sans relâche, sans crainte, avec un flegme de moine bouddhiste.", "SUJET VERBE COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3)."],
		["Tu t’es battue sans relâche, sans crainte, avec patience, avec courage.", "SUJET VERBE COMPLÉMENT, COMPLÉMENT, COMPLÉMENT, COMPLÉMENT."],
		["Le lundi, lors d’un éclair, pendant quelques minutes, je t’ai parlé.", "CADRATIF (1), CADRATIF (2), CADRATIF (3), SUJET VERBE COMPLÉMENT."],
		["Je me préparais à ton départ, mais, pas plus que toi, je ne voulais y croire, et nous avons continué à vivre avec l’éternité devant nous.", "SUJET VERBE COMPLÉMENT, mais, COMPLÉMENT, SUJET VERBE COMPLÉMENT, et SUJET VERBE COMPLÉMENT."],
		["Le feu a gagné ma rue vers 9 h 58.", "SUJET VERBE COMPLÉMENT."],
		["Sa cuisine a explosé.", "SUJET VERBE."],
		["Ton nom est une loterie.", "SUJET VERBE COMPLÉMENT."],
		["Il n’a pas pleuré.", "SUJET VERBE."],
		["Ce n’est pas une invention.", "SUJET VERBE COMPLÉMENT."],
		["Alors j’ai obéi.", "SUJET VERBE."],
		["Peut-être une bagarre.", "NOM."],
		["Le lendemain, elle m’a servi un café froid.", "CADRATIF, SUJET VERBE COMPLÉMENT."],
		["Des camions blancs, des bottes, des cris.", "NOM COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3)."],
		["À 8 heures, dans la rue, sous la pluie, j’ai entendu le premier POW !", "CADRATIF (1), CADRATIF (2), CADRATIF (3), SUJET VERBE COMPLÉMENT."],
		["J’étais professeur d’histoire-géographie dans un lycée public, avec un salaire qui suffisait à acheter du riz, du savon et trois cauchemars par semaine.", "SUJET VERBE COMPLÉMENT, COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3)."],
		["Un rire sec, maigre, tordu comme un arbre qui a grandi dans une ruelle sans soleil.", "NOM COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3)."],
		["C’était un cendrier géant, un cimetière sans tombes, un théâtre absurde où les rôles changeaient à chaque rafale.", "SUJET VERBE COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3)."],
		["J’ai écarté le rideau, j’ai vu courir deux enfants, puis une femme enceinte, puis un chien à trois pattes, et j’ai compris que ce jour ne serait pas un jour sérieux, ni même un jour tout court.", "SUJET VERBE COMPLÉMENT, SUJET VERBE COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3), et SUJET VERBE que SUBORDONNÉE, ni COMPLÉMENT."],
		["J’ai ri pendant que ma maison flambait, pendant que la voisine lançait des seaux d’eau dans le vide, pendant que les petits criaient.", "SUJET VERBE pendant SUBORDONNÉE (1), pendant SUBORDONNÉE (2), pendant SUBORDONNÉE (3)."],
		["Ma mère était morte depuis longtemps, mon père était parti depuis plus longtemps encore, et je vivais seul dans une petite pièce en tôle, avec un matelas plus maigre que moi, un ventilateur bancal et un portrait de Jean-Jacques Dessalines accroché au mur.", "SUJET VERBE COMPLÉMENT (1), SUJET VERBE COMPLÉMENT (2), et SUJET VERBE COMPLÉMENT (3), COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3)."],
		["Oui, moi, Jonas Dorléon, fils de Marthe la couturière et de Dieudonné le pêcheur fainéant, né à Carrefour-Feuilles, élevé au goût du sel, du rhum clair et de l'école publique, j'ai ri comme un idiot, un imbécile fini, un fou à l'élastique trop tendu.", "NOM (1), NOM (2), NOM (3), COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3), SUJET VERBE COMPLÉMENT (1), COMPLÉMENT (2), COMPLÉMENT (3)."],
	];
	let failed = 0;
	for (const [text, expected] of cases) {
		const actual = api.buildStructureReport(text, categoriesFor(text)).trim().split("\n").at(-1);
		try {
			assert.equal(actual, expected);
			const runs = api.tricolonRuns(text, categoriesFor(text));
			assert.equal(runs.length, (expected.match(/\(1\)/g) ?? []).length, "Tricolons et Structure doivent coïncider");
			assert.ok(runs.every(({ from, to }) => from >= 0 && to > from && to <= text.length));
		}
		catch {
			failed++; console.error(`${text}\n  expected: ${expected}\n  actual:   ${actual}`);
			console.error(api.analyzeSentenceStructure(text, 0, text.length, categoriesFor(text)));
		}
	}
	process.stdout.write(`Structure: ${cases.length - failed}/${cases.length}\n`);
	const quotedSentences = [
		["Tu m’as chuchoté : « J’espère que tu m’aimeras toujours quand je serai guérie. »", "La nuit tombait."],
		['Il a dit : “Je pars.”', "Elle attend."],
		['Il a dit : "Je pars."', "Elle attend."],
		['Il a dit : « Je pars.\u202f»', "Elle attend."],
		['« Je pars ! », dit-elle.', "Il attend."],
	];
	for (const sentences of quotedSentences) {
		const text = sentences.join(" ");
		const actual = api.sentenceRanges(text).map(([from, to]) => text.slice(from, to).trim()).filter(Boolean);
		const originals = api.buildStructureReport(text, categoriesFor(text)).split("\n").filter((line) => /^\d+\. /.test(line)).map((line) => line.replace(/^\d+\. /, ""));
		if (JSON.stringify(actual) !== JSON.stringify(sentences) || JSON.stringify(originals) !== JSON.stringify(sentences)) {
			failed++;
			console.error({ expected: sentences, actual, originals });
		}
	}
	process.stdout.write(`Citations: ${quotedSentences.length} cas vérifiés\n`);
	assert.doesNotThrow(() => api.buildStructureReport("[] : []", categoriesFor("[] : []")));
	assert.equal(failed, 0);
	const catalog = JSON.parse(readFileSync(new URL("../plugin/data/tic-ia.json", import.meta.url), "utf8")) as {
		rules: Array<{ id: string; detector: string; reason?: string; dictionary: Record<string, unknown> }>;
	};
	assert.equal(catalog.rules.length, 50);
	assert.equal(new Set(catalog.rules.map((rule) => rule.id)).size, 50);
	assert.equal(catalog.rules.filter((rule) => rule.detector === "manual").length, 11);
	assert.ok(catalog.rules.filter((rule) => rule.detector === "manual").every((rule) => rule.reason));
	assert.ok(catalog.rules.every((rule) => rule.dictionary && Object.keys(rule.dictionary).length > 0));

	const ticCases: Array<[string, string]> = [
		["01", "Ce n’est pas un échec. C’est un départ."],
		["02", "Non pas parce que je suis riche, mais parce que je suis libre."],
		["03", "Ce n’est ni un échec ni un départ. C’est autre chose."],
		["04", "Moins de paroles, plus de gestes."],
		["05", "La technique transforme notre société, mais notre société transforme la technique."],
		["06", "Il observe, il comprend, il agit."],
		["07", "Il faut penser. Il faut agir. Il faut changer."],
		["08", "Pourquoi ? Parce que tout a changé."],
		["09", "Certes il pleut, mais le bus arrive."],
		["10", "D’un côté la rue, de l’autre la mer."],
		["11", "Une rupture. Un vertige. Une évidence."],
		["12", "Autrement dit, le prix monte."],
		["13", "Derrière cette question se cache un enjeu plus profond."],
		["14", "Plus nous sommes connectés, plus nous sommes seuls."],
		["15", "Pas seulement la rue. Pas simplement la ville. Mais le monde."],
		["16", "À l’ère du numérique, le prix monte."],
		["17", "Dans un monde où tout change, il attend."],
		["18", "Il est essentiel de comprendre."],
		["19", "Il convient de souligner cette hausse."],
		["20", "Force est de constater cette hausse."],
		["21", "Il est au cœur de la ville."],
		["22", "Une véritable révolution."],
		["23", "Un point crucial."],
		["24", "Une situation multidimensionnelle."],
		["25", "Nous explorons la ville."],
		["26", "Cela redéfinit les règles."],
		["27", "Cet écosystème change."],
		["28", "Cela fait écho à notre histoire."],
		["29", "Il faut créer des ponts."],
		["30", "En définitive, il part."],
		["39", "Je comprends que cela puisse être frustrant."],
		["40", "Il est important de noter que le prix monte."],
		["41", "Et si la véritable question était ailleurs ?"],
		["42", "Une chose est certaine : le débat ne fait que commencer."],
		["43", "Un rire sec, maigre, tordu."],
		["46", "Mais ce n’est pas tout."],
		["47", "Prenons l’exemple d’une entreprise."],
		["50", "Car au fond, ce qui compte, c’est notre humanité."],
	];
	for (const [id, text] of ticCases) {
		const result = analyze(text, categoriesFor(text));
		assert.ok(result.sentences.some((sentence) => sentence.rules.includes(id)), `${id}: ${text}`);
		assert.equal(result.taggedSentences, result.highlights.length);
		assert.ok(result.percentage >= 0 && result.percentage <= 100);
	}
	const single = "Il est essentiel de comprendre cette véritable révolution. Il part.";
	const variants: Array<[string, string]> = [
		["10", "Tantôt la ville se tait, tantôt la foule se réveille."],
		["10", "Les uns veulent partir, les autres veulent rester."],
		["10", "Il voulait partir tandis qu’elle voulait rester."],
		["10", "Autant la façade paraît calme, autant la cour paraît agitée."],
		["10", "En théorie, la décision paraît simple. En pratique, son application reste difficile."],
		["10", "Elle voulait partir ; il voulait rester."],
		["01", "Ce ne sera pas une défaite, ce sera un départ."],
		["07", "Sans demander la permission. Sans attendre une réponse. Sans chercher une excuse."],
		["01", "Il ne s’agit pas de gagner, il s’agit de comprendre."],
		["02", "Pas faute de courage, mais par manque de moyens."],
		["04", "Davantage de liens, moins de frontières."],
		["09", "Quoique la tâche soit difficile, nous persistons néanmoins."],
		["12", "Pour le dire autrement, la solution reste fragile."],
		["16", "À l’heure des mutations numériques, le travail change."],
		["17", "Dans une société toujours plus connectée, le travail change."],
		["18", "Il apparaît indispensable de comprendre cette décision."],
		["19", "Il importe de rappeler cette histoire."],
		["20", "Tout porte à croire que le marché change."],
		["23", "Ce sont des avancées décisives."],
		["24", "Ces questions restent protéiformes."],
		["25", "Nous explorerions ces mécanismes."],
		["26", "Ces découvertes redéfiniront nos pratiques."],
		["28", "Ces éléments entraient en résonance."],
		["29", "Nous tisserions des liens entre les disciplines."],
		["30", "En dernière analyse, cette décision compte."],
		["39", "Votre inquiétude est parfaitement légitime."],
		["40", "Gardons à l’esprit que cette situation évolue."],
		["41", "Et si nous changions de perspective ?"],
		["42", "Une certitude demeure : tout reste à inventer."],
		["46", "Reste à comprendre ce qui se joue derrière ces chiffres."],
		["47", "Imaginons une association confrontée à cette situation."],
		["50", "Au bout du compte, l’essentiel réside dans notre capacité à faire société."],
	];
	for (const [id, text] of variants) {
		assert.ok(analyze(text, categoriesFor(text)).sentences.some((sentence) => sentence.rules.includes(id)), `Variante ${id}: ${text}`);
	}
	const counterexamples: Array<[string, string]> = [
		["10", "D’un côté du bâtiment, une fenêtre reste ouverte."],
		["10", "D’un côté la rue, de l’autre."],
		["10", "Il pleut mais le bus."],
		["10", "Tantôt la ville dort, tantôt la ville danse, tantôt la ville crie."],
		["14", "Il a plus de pain, sa sœur a plus de beurre."],
		["18", "Ces outils indispensables restent sur la table."],
		["23", "La crucialité est un mot abstrait."],
		["41", "Et si nous changions de perspective, nous verrions autre chose."],
		["15", "Il aime lire et surtout écrire."],
	];
	for (const [id, text] of counterexamples) {
		assert.ok(analyze(text, categoriesFor(text)).sentences.every((sentence) => !sentence.rules.includes(id)), `Contre-exemple ${id}: ${text}`);
	}
	const crosses = "Une histoire ordinaire. D’une part, les ouvriers réclament du repos. D’autre part, la direction refuse cette demande.";
	const crossing = analyze(crosses, categoriesFor(crosses));
	assert.ok(!crossing.sentences[0].rules.includes("10"));
	assert.ok(crossing.sentences[1].rules.includes("10") && crossing.sentences[2].rules.includes("10"));
	const silent = "Au-delà des apparences, une vérité profonde nous révèle une leçon universelle. L’avenir reste à écrire.";
	const manualIds = catalog.rules.filter((rule) => rule.detector === "manual").map((rule) => rule.id);
	assert.ok(analyze(silent, categoriesFor(silent)).sentences.every((sentence) => sentence.rules.every((id) => !manualIds.includes(id))));
	process.stdout.write(`Dictionnaires: ${variants.length} variantes, ${counterexamples.length} contre-exemples, fenêtres et règles manuelles vérifiés\n`);
	const result = analyze(single, categoriesFor(single));
	assert.equal(result.totalSentences, 2);
	assert.equal(result.taggedSentences, 1);
	assert.equal(result.percentage, 50);
	assert.ok(result.highlights[0].title?.includes("Injonction impersonnelle"));
	assert.equal(analyze("", categoriesFor("")).percentage, 0);
	const markdown = "# Véritable révolution\n\n```\nIl est essentiel de comprendre.\n```\n\nIl part.";
	const clean = analyze(markdown, categoriesFor(markdown));
	assert.equal(clean.totalSentences, 1);
	assert.equal(clean.taggedSentences, 0);
	const frontmatter = "---\ntitle: Véritable révolution\n---\n\nIl part.";
	assert.equal(analyze(frontmatter, categoriesFor(frontmatter)).totalSentences, 1);
	const repeated = "La mère préparait le repas dans la cuisine. Le père réparait la fenêtre dans la chambre. Leur enfant regardait la pluie dans le jardin.";
	const similar = analyze(repeated, categoriesFor(repeated));
	assert.equal(similar.sentences.filter((sentence) => sentence.rules.includes("structure-repetee")).length, 3);
	for (const list of ["Un rire sec, maigre, tordu, nerveux.", "Des camions, des bottes, des cris, des chiens, des cages."]) {
		assert.equal(api.tricolonRuns(list, categoriesFor(list)).length, 0, list);
	}
	const paragraph = "Le matin, la mère préparait un repas chaud dans la cuisine pendant que le père réparait les fenêtres de la chambre avant de partir travailler.";
	const uniform = [paragraph, paragraph, paragraph].join("\n\n");
	assert.ok(analyze(uniform, categoriesFor(uniform)).sentences.every((sentence) => sentence.rules.includes("44")));
	process.stdout.write(`Tic IA: ${ticCases.length + 1} règles vérifiées ; décompte unique, texte vide, Markdown et structures comparables vérifiés\n`);

	const reportPath = process.argv[2];
	if (reportPath) {
		const report = readFileSync(reportPath, "utf8");
		const originals = [...report.matchAll(/^\d+\. (.+)$/gm)].map((match) => match[1]);
		const text = originals.join("\n\n");
		const category = categoriesFor(text);
		const corpus = analyze(text, category);
		process.stdout.write(`Rapport: ${originals.length} entrées ; ${corpus.taggedSentences}/${corpus.totalSentences} phrases taguées (${corpus.percentage.toFixed(1)} %)\n`);
		for (const index of [26, 28, 90, 160, 271, 706, 1099]) {
			process.stdout.write(`${index + 1}: ${api.buildStructureReport(originals[index], category).trim().split("\n").at(-1)}\n`);
		}
	}
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
