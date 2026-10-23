import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { MarkdownView, type App, type EditorPosition } from "obsidian";
import type FinitionPlugin from "../main";
import { dictionaryKinds, dictionaryLabels, parseWordDictionary, publicDictionaryKinds, type DictionaryKind } from "../plugin/dictionaries";
import { FinitionSettingTab } from "../plugin/settings-tab";
import { resourceFixture } from "./check-linguistic-resources";

export async function checkWordDictionaries(Plugin: typeof FinitionPlugin, getMenu: () => Array<{ title: string; disabled: boolean; click: () => Promise<void> }>, notices: string[], modals: Array<{ close: () => void }>, setHandler: (handler: (request: { url: string }) => Promise<{ status: number; arrayBuffer: ArrayBuffer }>) => void): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const fixture = await resourceFixture(false);
	const view = new EditorView({ parent: document.body.createDiv(), state: EditorState.create({ doc: "Un chat.", selection: { anchor: 3, head: 7 } }) });
	const position = (offset: number): EditorPosition => ({ line: 0, ch: offset });
	const editor = {
		getValue: () => view.state.doc.toString(), getSelection: () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
		listSelections: () => view.state.selection.ranges.map(range => ({ anchor: position(range.anchor), head: position(range.head) })),
		getCursor: (which: "from" | "to") => position(view.state.selection.main[which]), posToOffset: (pos: EditorPosition) => pos.ch, offsetToPos: position,
		replaceRange: (insert: string, from: EditorPosition, to: EditorPosition) => view.dispatch({ changes: { from: from.ch, to: to.ch, insert } }),
		setSelection: (anchor: EditorPosition, head: EditorPosition) => view.dispatch({ selection: { anchor: anchor.ch, head: head.ch } }), focus: () => view.focus(),
	};
	const markdown = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { editor, file: { path: "test.md" } });
	const plugin = new Plugin({ vault: { adapter: fixture.adapter }, workspace: { getActiveViewOfType: () => markdown, iterateAllLeaves() {} } } as unknown as App, { id: "finition", name: "Finition", version: "0.4.3", minAppVersion: "1.0.0", description: "", author: "", dir: "test-plugin" });
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	const store = plugin.wordDictionaries!;
	const menu = () => { (plugin as unknown as { showModeMenu: (event: MouseEvent) => void }).showModeMenu(new MouseEvent("click")); return getMenu(); };
	check(dictionaryKinds.every(kind => menu().find(item => item.title === dictionaryLabels[kind])?.disabled), "Un dictionnaire absent est actif dans le menu");
	const dictionary = (kind: DictionaryKind) => ({ format: "finition-dictionnaire", version: 1, language: "fr", kind, name: "Personnel", description: "<b>Lexique</b>", documentation: "https://example.org/doc", entries: {
		chat: kind === "definitions" ? [{ label: "Animal", text: "Un <b>félin</b>.", examples: ["Le chat dort."] }] : kind === "antonymes" ? [{ label: "Opposés", words: ["chien"] }] : kind === "champ-lexical" ? [{ words: ["voisin", "<b>lié</b>"] }] : kind === "citations" ? [{ text: "Le chat dort." }] : [{ text: "Sa" }],
		...(kind === "rimes" ? { rat: [{ text: "ra" }], achat: [{ text: "aSa" }], chien: [{ text: "Siâ" }], carte: [{ text: "kart" }], verte: [{ text: "vÈrt" }], tarte: [{ text: "tart" }] } : {}),
	} });
	const raw = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
	const valid = dictionary("definitions");
	const malformed: unknown[] = [null, [], {}, { ...valid, kind: "antonymes" }, { ...valid, version: 2 }, { ...valid, documentation: "javascript:alert(1)" }, { ...valid, encoding: "unknown" }, { ...valid, name: "" }, { ...valid, entries: { Chat: [{ text: "x" }] } }, { ...valid, entries: { chat: [{ words: ["chien"] }] } }, { ...valid, entries: { chat: [{ text: "x", examples: [42] }] } }];
	for (let code = 0; code < 32; code++) malformed.push({ ...valid, entries: { chat: [{ text: `x${String.fromCharCode(code)}` }] } });
	for (const value of malformed) {
		let rejected = false;
		try { parseWordDictionary(JSON.stringify(value), "definitions"); } catch { rejected = true; }
		check(rejected, "Le format accepte une donnée hostile ou incompatible");
	}
	const container = document.body.createDiv(), tab = new FinitionSettingTab(plugin.app, plugin);
	tab.containerEl = container;
	tab.update();
	const section = () => container.querySelector<HTMLDetailsElement>('details[data-section="Définitions"]')!;
	section().open = true;
	await new Promise(requestAnimationFrame);
	await fixture.adapter.writeBinary("source.json", raw(valid));
	const loader = Array.from(section().querySelectorAll<HTMLElement>(".setting-item")).find(row => row.querySelector(".setting-item-name")?.textContent === "Charger un dictionnaire")!;
	const input = loader.querySelector<HTMLInputElement>("input")!;
	input.value = "source.json";
	input.dispatchEvent(new Event("input"));
	loader.querySelector<HTMLButtonElement>("button")!.click();
	const deadline = performance.now() + 1000;
	while (!store.has("definitions") || section().querySelector<HTMLSelectElement>("select")!.disabled) {
		check(performance.now() < deadline, "L’import de dictionnaire ne se termine pas");
		await new Promise(requestAnimationFrame);
	}
	check(section().open && section().querySelector<HTMLSelectElement>("select")!.selectedOptions[0].text === "Personnel", "Import : section refermée ou nom du JSON absent");
	check(!section().querySelector("b") && section().querySelector<HTMLAnchorElement>('a[href="https://example.org/doc"]')?.textContent === "<b>Lexique</b>", "La description n’est pas liée ou interprète du HTML");
	for (const kind of dictionaryKinds.filter(kind => kind !== "definitions")) await store.import(kind, raw(dictionary(kind)));
	const chatRhymes = (await store.lookup("rimes", "chat")).rows.flatMap(row => row.words ?? []);
	const carteRhymes = (await store.lookup("rimes", "carte")).rows.flatMap(row => row.words ?? []);
	check(chatRhymes.includes("rat") && chatRhymes.includes("achat") && !chatRhymes.includes("chien") && carteRhymes.includes("tarte") && !carteRhymes.includes("verte"), "Les rimes ignorent une voyelle finale ou confondent deux voyelles différentes");
	check(plugin.settings.wordDictionaries.length === dictionaryKinds.length, "Les dictionnaires sont mélangés ou perdus");
	const sourcePath = plugin.settings.wordDictionaryPaths.definitions!;
	await store.import("definitions", raw(valid));
	check(plugin.settings.wordDictionaries.length === dictionaryKinds.length && plugin.settings.wordDictionaryPaths.definitions === sourcePath, "Le même fichier ajoute un doublon");
	await fixture.adapter.writeBinary("source.json", raw({}));
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check((await store.lookup("definitions", "chat")).rows[0].text === "Un <b>félin</b>." && !(await store.lookup("definitions", "constructor")).rows.length, "La copie dépend de la source ou lit le prototype");
	for (const kind of dictionaryKinds) {
		const item = menu().find(item => item.title === dictionaryLabels[kind])!;
		check(!item.disabled, "Dictionnaire installé encore grisé");
		await item.click();
		if (kind !== "antonymes" && kind !== "rimes") {
			check(document.querySelector(".finition-word-information") && !document.querySelector(".finition-word-information b") && !document.querySelector(".finition-word-information .finition-synonym-replace"), "Information de dictionnaire interprétée ou remplaçable");
			if (kind === "champ-lexical") check(document.querySelector(".finition-word-information")?.textContent?.includes("voisin, <b>lié</b>"), "Les mots associés ne sont pas affichés");
		} else check(document.querySelector(`[aria-label="Remplacer par ${kind === "antonymes" ? "chien" : "achat"}"]`), "Résultats locaux manquants");
		modals.at(-1)!.close();
		check(editor.getSelection() === "chat" && view.hasFocus, "La fermeture perd la sélection active");
	}
	for (const kind of dictionaryKinds.filter(kind => kind !== "antonymes" && kind !== "rimes")) {
		await plugin.runWordDictionary(kind);
		document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!.click();
		const expected = kind === "definitions" ? "chat\n\nAnimal\nUn <b>félin</b>.\nLe chat dort." : kind === "champ-lexical" ? "chat\n\nvoisin\n<b>lié</b>" : kind === "citations" ? "chat\n\nLe chat dort." : "chat\n\nSa";
		check(editor.getValue() === `Un chat.\n\n%%\n${expected}\n%%\n`, "Information de dictionnaire mal insérée en remarque");
		check(editor.getSelection() === "chat" && view.hasFocus && !document.querySelector(".finition-word-information"), "L’insertion du dictionnaire perd le focus ou ne ferme pas la fenêtre");
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Un chat." }, selection: { anchor: 3, head: 7 } });
	}
	view.dispatch({ selection: { anchor: 3, head: 3 } });
	check(!menu().find(item => item.title === "Définitions")?.disabled, "Absence de sélection grise un dictionnaire installé");
	await plugin.runWordDictionary("definitions");
	check(notices.at(-1) === "Définitions : sélectionne un seul mot.", "Sélection vide sans message explicite");
	const before = JSON.stringify(plugin.settings.wordDictionaries), paths = JSON.stringify(plugin.settings.wordDictionaryPaths);
	const save = plugin.saveSettings.bind(plugin);
	plugin.saveSettings = async () => { throw new Error("Échec de sauvegarde simulé"); };
	let failed = false;
	try { await store.import("definitions", raw({ ...valid, name: "Autre" })); } catch { failed = true; }
	check(failed && JSON.stringify(plugin.settings.wordDictionaries) === before && JSON.stringify(plugin.settings.wordDictionaryPaths) === paths, "Échec de sauvegarde : choix ou catalogue altéré");
	plugin.saveSettings = save;
	const remove = fixture.adapter.remove.bind(fixture.adapter);
	fixture.adapter.remove = async () => { throw new Error("Échec de suppression simulé"); };
	failed = false;
	try { await store.remove("definitions", sourcePath); } catch { failed = true; }
	check(failed && store.has("definitions") && JSON.stringify(plugin.settings.wordDictionaries) === before, "Échec de suppression : choix perdu");
	fixture.adapter.remove = remove;
	await store.remove("definitions", sourcePath);
	check(!store.has("definitions") && !(await fixture.adapter.exists(sourcePath)) && await fixture.adapter.exists("source.json") && store.has("antonymes"), "Suppression : source effacée ou autres dictionnaires altérés");
	failed = false;
	try { await store.remove("antonymes", "source.json"); } catch { failed = true; }
	check(failed && await fixture.adapter.exists("source.json"), "Suppression hors des copies du plugin acceptée");
	const spellingEngine = plugin.settings.spellingEngine;
	const privateDictionaries = JSON.stringify(plugin.settings.wordDictionaries);
	setHandler(async request => {
		const prefix = "https://github.com/tcrouzet/finition/releases/download/resources-0.4.3/";
		check(request.url.startsWith(prefix), "Téléchargement du dictionnaire hors de la release");
		return { status: 200, arrayBuffer: await fixture.readSource(request.url.slice(prefix.length)) };
	});
	const downloads: Promise<void>[] = [];
	const downloadResources = plugin.downloadLinguisticResources.bind(plugin);
	plugin.downloadLinguisticResources = (...args) => { const download = downloadResources(...args); downloads.push(download); return download; };
	for (const kind of publicDictionaryKinds) {
		tab.update();
		const section = container.querySelector<HTMLDetailsElement>(`details[data-section="${dictionaryLabels[kind]}"]`)!;
		section.open = true;
		check(!section.querySelector("summary button"), "Le téléchargement doit rester dans la ligne du dictionnaire par défaut");
		const rows = Array.from(section.querySelectorAll<HTMLElement>(".setting-item"));
		const finition = rows.find(row => row.querySelector(".setting-item-name")?.textContent === "Finition")!;
		const importer = rows.find(row => row.querySelector(".setting-item-name")?.textContent === "Charger un dictionnaire")!;
		const button = finition.querySelector<HTMLButtonElement>("button")!;
		check(button?.textContent === "Charger" && !button.disabled && !finition.querySelector("input"), "Le dictionnaire par défaut doit se télécharger sans fournir de fichier");
		check(importer && rows.indexOf(importer) > rows.indexOf(finition) && importer.querySelector("input"), "La zone d’import doit rester séparée sous le dictionnaire par défaut");
		check(getComputedStyle(section.parentElement!, "::before").display === "none", "Le séparateur natif double celui de la section");
		const before = downloads.length;
		button.click();
		check(downloads.length === before + 1, "Le bouton de chargement doit appeler un seul téléchargement");
		await downloads[before];
		await new Promise(requestAnimationFrame);
		check(store.has(kind) && plugin.settings.wordDictionaryPaths[kind] === "" && store.options.some(option => option.kind === kind && option.name === "Finition" && option.path === ""), "Le téléchargement ne sélectionne pas le dictionnaire public");
		tab.update();
		const current = container.querySelector<HTMLDetailsElement>(`details[data-section="${dictionaryLabels[kind]}"]`)!;
		const row = Array.from(current.querySelectorAll(".setting-item")).find(row => row.querySelector(".setting-item-name")?.textContent === "Finition")!;
		check(current.open && row.querySelector("button")?.textContent === "Recharger" && row.querySelectorAll("button").length === 1 && current.querySelector<HTMLSelectElement>("select")?.selectedOptions[0]?.text === "Finition", "Le dictionnaire public doit rester rechargeable sur sa propre ligne et la section ouverte");
		const result = await store.lookup(kind, kind === "antonymes" ? "chaud" : kind === "conjugaisons" ? "aimer" : "chat");
		check(result.dictionary.license?.name === "CC-BY-SA-4.0" && result.dictionary.license.source === "https://fr.wiktionary.org/" && result.rows.length > 0, "Licence, provenance ou résultat public absent");
		if (kind === "antonymes") check(result.rows.some(row => row.words?.includes("froid")), "L’antonyme public attendu est absent");
		if (kind === "phonetique") check(result.rows.some(row => row.text === "ʃa"), "La transcription API publique est absente");
		if (kind === "rimes") check(result.rows.some(row => row.words?.includes("rat")), "La rime phonétique publique est absente");
		check(await store.remove(kind, "").then(() => false, () => true), "Le dictionnaire public peut être effacé comme un import personnel");
	}
	plugin.downloadLinguisticResources = downloadResources;
	check(plugin.settings.spellingEngine === spellingEngine && JSON.stringify(plugin.settings.wordDictionaries) === privateDictionaries, "Le téléchargement d’un dictionnaire change le correcteur ou les imports personnels");
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check(publicDictionaryKinds.every(kind => store.has(kind) && plugin.settings.wordDictionaryPaths[kind] === ""), "Le choix public n’est pas conservé après rechargement");
	const sample = (await store.lookup("antonymes", "chaud")).dictionary;
	for (const license of [null, "CC-BY-SA-4.0", { ...sample.license, url: "javascript:alert(1)" }, { ...sample.license, source: "file:///tmp/source" }, { ...sample.license, attribution: "" }, { ...sample.license, sha256: "x" }, { ...sample.license, revision: "x\n" }]) {
		let rejected = false;
		try { parseWordDictionary(JSON.stringify({ ...sample, license }), "antonymes"); } catch { rejected = true; }
		check(rejected, "Une licence ou une provenance invalide est acceptée");
	}
	container.remove();
	view.destroy();
}
