import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { MarkdownView, type App, type EditorPosition } from "obsidian";
import type FinitionPlugin from "../main";
import { dictionaryKinds, dictionaryLabels, parseWordDictionary, type DictionaryKind } from "../plugin/dictionaries";
import { FinitionSettingTab } from "../plugin/settings-tab";
import { resourceFixture } from "./check-linguistic-resources";

export async function checkWordDictionaries(Plugin: typeof FinitionPlugin, getMenu: () => Array<{ title: string; disabled: boolean; click: () => Promise<void> }>, notices: string[], modals: Array<{ close: () => void }>): Promise<void> {
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
		chat: kind === "definitions" ? [{ label: "Animal", text: "Un <b>félin</b>.", examples: ["Le chat dort."] }] : kind === "antonymes" ? [{ label: "Opposés", words: ["chien"] }] : [{ text: "Sa" }],
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
	check(plugin.settings.wordDictionaries.length === 4, "Les dictionnaires sont mélangés ou perdus");
	const sourcePath = plugin.settings.wordDictionaryPaths.definitions!;
	await store.import("definitions", raw(valid));
	check(plugin.settings.wordDictionaries.length === 4 && plugin.settings.wordDictionaryPaths.definitions === sourcePath, "Le même fichier ajoute un doublon");
	await fixture.adapter.writeBinary("source.json", raw({}));
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check((await store.lookup("definitions", "chat")).rows[0].text === "Un <b>félin</b>." && !(await store.lookup("definitions", "constructor")).rows.length, "La copie dépend de la source ou lit le prototype");
	for (const kind of dictionaryKinds) {
		const item = menu().find(item => item.title === dictionaryLabels[kind])!;
		check(!item.disabled, "Dictionnaire installé encore grisé");
		await item.click();
		if (kind === "definitions" || kind === "phonetique") {
			check(document.querySelector(".finition-word-information") && !document.querySelector(".finition-word-information b") && !document.querySelector(".finition-word-information .finition-synonym-replace"), "Définition/phonétique interprétée ou remplaçable");
		} else check(document.querySelector(`[aria-label="Remplacer par ${kind === "antonymes" ? "chien" : "achat"}"]`), "Résultats locaux manquants");
		modals.at(-1)!.close();
		check(editor.getSelection() === "chat" && view.hasFocus, "La fermeture perd la sélection active");
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
	container.remove();
	view.destroy();
}
