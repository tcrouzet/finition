import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import * as vm from "node:vm";
import * as process from "node:process";
import { build } from "esbuild";
import { rawAssets } from "../plugin/raw-assets.mjs";
import type { GetCategory } from "../plugin/modes/structure-signature";
import type { TicIAResult } from "../plugin/modes/tic-ia";
import type { FinitionSettings } from "../plugin/types";

async function main() {
	const modules = await build({
		stdin: { contents: "export * from \"./plugin/modes/clause-split\"; export * from \"./plugin/modes/structure-report\"; export * from \"./plugin/modes/structure-signature\"; export * from \"./plugin/modes/ternary\"; export * from \"./plugin/modes/tic-ia\"; export { engineScripts } from \"./plugin/modes/grammalecte-resources\"; export { default as FinitionPlugin } from \"./main\";", resolveDir: process.cwd() },
		bundle: true, platform: "node", format: "cjs", write: false, loader: { ".md": "text" }, external: ["obsidian"], plugins: [rawAssets],
	});
	const menuTitles: string[] = [];
	const menuDisabled = new Map<string, boolean>();
	class Plugin {
		app = { workspace: { getActiveViewOfType: () => null } };
		saved: Partial<FinitionSettings> | null = null;
		async loadData() { return this.saved; }
		async saveData(settings: FinitionSettings) { this.saved = settings; }
	}
	class Menu {
		addItem(callback: (item: { setTitle: (title: string) => unknown }) => void) {
			const item = {
				setTitle(title: string) { menuTitles.push(title); return this; },
				setIcon() { return this; }, setChecked() { return this; }, setDisabled(value: boolean) { menuDisabled.set(menuTitles[menuTitles.length - 1], value); return this; }, onClick() { return this; },
			};
			callback(item);
		}
		addSeparator() {}
		showAtMouseEvent() {}
	}
	const module = { exports: {} };
	const sandbox = vm.createContext({ module, exports: module.exports, Buffer, TextEncoder, TextDecoder, require: (name: string) => {
		assert.equal(name, "obsidian");
		return { Plugin, PluginSettingTab: class {}, Modal: class {}, Component: class {}, Menu };
	} });
	vm.runInContext(modules.outputFiles[0].text, sandbox);
	sandbox.document = { body: { classList: { toggle() {} } } };
	const api = module.exports as {
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
			loadSettings: () => Promise<void>;
			showModeMenu: (event: unknown) => void;
			runStructureReport: () => Promise<void>;
		};
	};
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
	plugin.settings.debugMode = true;
	await plugin.saveData(plugin.settings);
	await plugin.loadSettings();
	menuTitles.length = 0;
	plugin.showModeMenu({});
	assert.ok(menuTitles.includes("Structure"));
	assert.equal(menuDisabled.get("Structure"), true);
	plugin.settings.debugMode = false;
	menuTitles.length = 0;
	plugin.showModeMenu({});
	assert.ok(!menuTitles.includes("Structure"));
	await plugin.runStructureReport();
	Object.defineProperty(plugin, "hasLinguisticResources", { value: true });
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
	const lexiconData = JSON.parse(readFileSync(new URL("../plugin/data/lexicon.json", import.meta.url), "utf8")) as Record<string, string>;
	const lexicon = new Map(Object.entries(lexiconData));
	const analyze = (text: string, category: GetCategory) => api.analyzeTicIA(text, category, lexicon);
	const root = new URL("../plugin/data/grammalecte/", import.meta.url);
	const read = (name: string) => readFileSync(new URL(name, name.endsWith(".json") ? new URL("../ressources/grammalecte/", import.meta.url) : root), "utf8");
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
