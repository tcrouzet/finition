import type { App } from "obsidian";
import type FinitionPlugin from "../main";
import { FinitionSettingTab } from "../plugin/settings-tab";
import { parseLexicon } from "../plugin/lexicon/dictionaries";
import { decodeDictionary, personalDictionaryPath } from "../plugin/lexicon/shared";
import { resourceFixture } from "./check-linguistic-resources";

export async function checkLexiconDictionaries(Plugin: typeof FinitionPlugin): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const fixture = await resourceFixture();
	const root = "lexicon-plugin";
	const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
	const encode = async (value: unknown) => {
		const compressed = new Uint8Array(await new Response(new Blob([bytes(value)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
		let binary = "";
		for (let offset = 0; offset < compressed.length; offset += 8192) binary += String.fromCharCode(...compressed.subarray(offset, offset + 8192));
		return btoa(binary);
	};
	const reference = JSON.parse(new TextDecoder().decode(await fixture.readSource("lexique-finition-dictionnaire.json"))) as { grammalectePayload: string };
	const compressed = Uint8Array.from(atob(reference.grammalectePayload), char => char.charCodeAt(0));
	const grammar = JSON.parse(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as { extras: Array<[string, string[]]> };
	grammar.extras.push(["zorglon", [">zorglon/:N:m:s"]], ["zorglons", [">zorglon/:N:m:p"]]);
	const sample = { format: "finition-dictionnaire", name: "Lexique personnel", version: 2, language: "fr", encoding: "gzip-base64",
		description: "Remarque <b>littérale</b>", documentation: "https://example.org/lexique",
		payload: await encode({ entries: [["zorglon", "zorglon", "nom", "m", "s", "", 1], ["zorglons", "zorglon", "nom", "m", "p", "", 1]], forms: [], variants: [] }),
		grammalectePayload: await encode(grammar) };
	check(await decodeDictionary(sample, "all", 1).then(() => false, () => true), "La limite de décompression n’est pas appliquée");
	for (const invalid of [null, { ...sample, format: "autre" }, { ...sample, name: "finition-dictionnaire", format: "autre" }, { ...sample, version: 1 }, { ...sample, name: "x\u0000" }, { ...sample, documentation: "javascript:alert(1)" }, { ...sample, payload: "invalide" }]) {
		check(await parseLexicon(bytes(invalid)).then(() => false, () => true), "Un lexique incompatible ou altéré est accepté");
	}
	const plugin = new Plugin({ vault: { adapter: fixture.adapter }, workspace: { iterateAllLeaves() {} } } as unknown as App,
		{ id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.14.0", description: "", author: "", dir: root });
	await plugin.loadSettings();
	plugin.settings.mode = "none";
	await plugin.saveSettings();
	await plugin.loadLinguisticResources();
	check(!plugin.hasLexicon && !plugin.lexiconDictionaries?.options.length, "Un lexique absent est sélectionnable");
	await fixture.adapter.writeBinary(`${root}/${personalDictionaryPath}`, bytes({ format: "finition-personal-forms", version: 1, forms: [] }));
	await fixture.adapter.writeBinary("imports/lexique.json", bytes(sample));
	await plugin.setLexiconPath("imports/lexique.json");
	const selected = plugin.settings.lexiconDictionaryPath;
	check(plugin.hasLexicon && selected.startsWith(`${root}/data/lexique/imports/`) && plugin.settings.lexiconDictionaries.length === 1 && !plugin.hasLinguisticResources, "L’import ne copie pas et n’active pas le lexique indépendamment des correcteurs");
	await plugin.loadLexiconData(true);
	check(plugin.lexicon.get("zorglons") === "zorglon", "Les répétitions ne lisent pas le lexique choisi");
	await plugin.importLexicon(bytes(sample));
	check(plugin.settings.lexiconDictionaries.length === 1 && plugin.lexicon.size === 0, "Réimporter crée un doublon ou conserve les anciens lemmes");
	await plugin.loadSettings();
	plugin.settings.resourcePacks = fixture.revisions;
	await plugin.loadLinguisticResources();
	check(plugin.settings.lexiconDictionaryPath === selected && plugin.lexiconDictionaries?.available, "La sélection du lexique ne survit pas au rechargement");
	const container = document.body.createDiv(), tab = new FinitionSettingTab(plugin.app, plugin);
	tab.containerEl = container; tab.update();
	const row = (name: string) => Array.from(container.querySelectorAll(".setting-item")).find(row => row.querySelector(".setting-item-name")?.textContent === name)!;
	const selector = row("Lexique").querySelector<HTMLSelectElement>("select")!;
	check(Array.from(selector.options).map(option => option.text).join("|") === "Finition|Lexique personnel" && selector.value === selected, "Le sélecteur de lexiques perd les noms ou le choix actif");
	check(row(sample.name).querySelector("a")?.textContent === sample.description && !row(sample.name).querySelector("b") && row(sample.name).querySelector("button")?.textContent === "Effacer", "Le lexique importé perd sa remarque, son lien ou Effacer");
	check(Array.from(row("Charger un lexique").querySelectorAll("button")).map(button => button.textContent).join("|") === "Charger|Parcourir…", "L’import lexical ne reprend pas les boutons des dictionnaires");
	check(row("Dictionnaire Finition").querySelectorAll("button").length === 1 && row("Dictionnaire Finition").querySelector("button")?.textContent === "Recharger", "Le lexique public n’est pas rechargeable ou devient effaçable");
	const internal = plugin as unknown as { ensureSpellingEngine(engine: string): Promise<{ getCategories(words: string[]): Promise<Record<string, string>>; parse(text: string): Promise<Array<{ aSuggestions: string[] }>> }> };
	plugin.settings.neuralModel = "";
	const neural = await internal.ensureSpellingEngine("finition-corrector");
	check((await neural.getCategories(["zorglons"])).zorglons === "nom" && (await neural.parse("un zorglons")).some(error => error.aSuggestions.includes("zorglon")), "Le correcteur neuronal n’utilise pas les flexions sélectionnées");
	const native = await internal.ensureSpellingEngine("grammalecte");
	check((await native.getCategories(["zorglons"])).zorglons === "nom", "Grammalecte ignore le lexique nommé sélectionné");
	const version = plugin.wordCategoryCacheVersion;
	plugin.wordCategoryCache.set("zorglons", "nom");
	await plugin.setLexicon("");
	check(plugin.settings.lexiconDictionaryPath === "" && plugin.wordCategoryCache.size === 0 && plugin.wordCategoryCacheVersion > version, "Changer de lexique conserve les catégories précédentes");
	await plugin.setLexicon(selected);
	const saved = plugin.saveSettings.bind(plugin);
	plugin.saveSettings = async () => { throw new Error("Écriture impossible"); };
	check(await plugin.setLexicon("").then(() => false, () => true) && plugin.settings.lexiconDictionaryPath === selected, "Une sauvegarde échouée change le lexique actif");
	plugin.saveSettings = saved;
	check(await plugin.removeLexicon("").then(() => false, () => true), "Le dictionnaire public est effaçable");
	const remove = fixture.adapter.remove.bind(fixture.adapter);
	fixture.adapter.remove = async () => { throw new Error("Suppression impossible"); };
	check(await plugin.removeLexicon(selected).then(() => false, () => true) && plugin.settings.lexiconDictionaryPath === selected, "Une suppression échouée perd le lexique actif");
	fixture.adapter.remove = remove;
	const copy = fixture.writes.get(selected)!;
	fixture.writes.delete(selected);
	await plugin.loadLinguisticResources();
	check(!plugin.hasLexicon && !plugin.lexiconDictionaries?.available, "Un lexique importé disparu reste actif");
	fixture.writes.set(selected, copy);
	await plugin.loadLinguisticResources();
	await plugin.removeLexicon(selected);
	check(plugin.settings.lexiconDictionaryPath === "" && plugin.hasLexicon && !await fixture.adapter.exists(selected) && await fixture.adapter.exists("imports/lexique.json"), "Effacer ne revient pas à Finition ou touche la source");
	plugin.onunload(); container.remove();
	console.error("finition-test-step", "lexiques : imports, noms, flexions, deux correcteurs, caches, persistance et échecs vérifiés");
}
