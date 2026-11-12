import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import type { DictionaryKind, DictionaryRow, DictionarySettings } from "../plugin/dictionaries";

export async function checkExtraDictionaryFormat(): Promise<void> {
	const focused: Element[] = [];
	let focusOptions: FocusOptions | undefined;
	class Element {
		children: Element[] = [];
		tabIndex = -1;
		classList = { add() {} };
		click: (() => void) | undefined;
		private text: string;
		constructor(readonly tag = "div", readonly options: { text?: string; cls?: string } = {}) { this.text = options.text ?? ""; }
		createEl(tag: string, options = {}) { const child = new Element(tag, options); this.children.push(child); return child; }
		createDiv(options = {}) { const child = new Element("div", options); this.children.push(child); return child; }
		appendText(text: string) { this.createEl("#text", { text }); }
		append(...parts: Array<Element | string>) { for (const part of parts) typeof part === "string" ? this.appendText(part) : this.children.push(part); }
		get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
		addEventListener(_event: string, callback: (event: MouseEvent) => void) { this.click = () => callback({ preventDefault() {}, stopPropagation() {} } as MouseEvent); }
		empty() { this.text = ""; this.children.length = 0; }
		querySelector() { return undefined; }
		focus(options?: FocusOptions) { focused.push(this); focusOptions = options; }
	}
	let opened: { contentEl: Element; modalEl: Element } | undefined;
	const downloads = new Map<string, ArrayBuffer>(), requests: string[] = [];
	let onDownload: (url: string) => void | Promise<void> = () => {};
	class Modal {
		contentEl = new Element(); modalEl = new Element();
		setTitle() {}
		onOpen() {}
		onClose() {}
		open() { opened = { contentEl: this.contentEl, modalEl: this.modalEl }; this.onOpen(); }
		close() { this.onClose(); }
	}
	const modules = await build({ stdin: { contents: 'export * from "./plugin/dictionaries"; export * from "./plugin/linguistic-files"; export { LinguisticResources, resourceHash } from "./plugin/linguistic-resources"; export { runLocalWordLookup } from "./plugin/ui/local-synonyms";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"], logLevel: "silent" });
	const module = { exports: {} }, notices: string[] = [];
	const progress: Array<{ message: string | Element; hidden: boolean }> = [];
	runInNewContext(modules.outputFiles[0].text, { module, require: (name: string) => {
		assert.equal(name, "obsidian");
		return { Modal, MarkdownView: class {}, Component: class {}, Notice: class {
			hidden = false;
			constructor(public message: string | Element, duration?: number) { this.setMessage(message); if (duration === 0) progress.push(this); }
			setMessage(message: string | Element) { this.message = message; notices.push(typeof message === "string" ? message : message.textContent); }
			hide() { this.hidden = true; }
		}, setIcon() {}, requestUrl({ url }: { url: string }) { const data = downloads.get(url); assert.ok(data, `Requête inattendue : ${url}`); requests.push(url); return Promise.resolve(onDownload(url)).then(() => ({ status: 200, arrayBuffer: data.slice(0) })); } };
	}, TextEncoder, TextDecoder, DOMException, crypto: webcrypto, URL, window: { setTimeout }, createFragment: () => new Element("#fragment"), createSpan: (options: { cls?: string }) => new Element("span", options), createEl: (tag: string, options = {}) => new Element(tag, options) });
	const api = module.exports as typeof import("../plugin/dictionaries") & typeof import("../plugin/ui/local-synonyms") & typeof import("../plugin/linguistic-files") & typeof import("../plugin/linguistic-resources");
	assert.deepEqual(Array.from(api.publicDictionaryKinds), ["definitions", "antonymes", "phonetique", "rimes", "conjugaisons", "historique", "citations", "champ-lexical"]);
	const extra = ["conjugaisons", "historique", "citations", "champ-lexical"] as const;
	assert.deepEqual(Array.from(api.dictionaryKinds), Array.from(api.publicDictionaryKinds), "Les commandes et réglages doivent exposer uniquement les dictionnaires disponibles");
	assert.deepEqual(Array.from(api.dictionaryCommands), ["definitions", "antonymes", "phonetique", "rimes", "conjugaisons", "historique", "citations"], "Champ lexical ne doit plus être proposé comme commande ou réglage");
	const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
	const sample = (kind: DictionaryKind, rows: DictionaryRow[]) => ({ format: "finition-dictionnaire", version: 1, language: "fr", kind, name: "Local", entries: { chat: rows } });
	for (const kind of extra) {
		for (const rows of [[{ text: "Information" }], [{ words: ["animal", "félin"] }], [{ examples: ["Le chat dort."] }]]) {
			assert.equal(api.parseWordDictionary(JSON.stringify(sample(kind, rows)), kind).kind, kind);
		}
		for (const rows of [[{}], [{ label: "Vide" }], [{ examples: [] }], [{ words: [] }], [{ text: "x\u0000" }], [{ words: [42] }]]) {
			assert.throws(() => api.parseWordDictionary(JSON.stringify({ ...sample(kind, []), entries: { chat: rows } }), kind));
		}
		assert.throws(() => api.parseWordDictionary(JSON.stringify(sample(kind, [{ text: "Sens" }])), "definitions"));
	}
	const files = new Map<string, ArrayBuffer>();
	const settings: DictionarySettings = { wordDictionaries: [], wordDictionaryPaths: {} };
	const resourceCalls: string[] = [];
	const adapter = {
		exists: async (path: string) => files.has(path), mkdir: async () => {},
		writeBinary: async (path: string, data: ArrayBuffer) => { files.set(path, data.slice(0)); },
		readBinary: async (path: string) => { const data = files.get(path); assert.ok(data, path); return data.slice(0); },
		stat: async (path: string) => files.has(path) ? { type: "file", size: files.get(path)!.byteLength } : null,
		remove: async (path: string) => { files.delete(path); },
	} as unknown as import("obsidian").DataAdapter;
	const store = new api.WordDictionaries(adapter, "plugin", () => settings, async () => {}, {
		available: (kind: DictionaryKind) => { assert.ok(api.isPublicDictionaryKind(kind)); resourceCalls.push(kind); return false; },
		read: () => { throw new Error("Aucun téléchargement pour un dictionnaire local."); },
	} as unknown as import("../plugin/linguistic-resources").LinguisticResources);
	await store.refresh();
	for (const kind of extra) {
		assert.equal(store.has(kind), false);
		await assert.rejects(store.lookup(kind, "chat"));
		await store.import(kind, bytes(sample(kind, [{ words: ["félin"], examples: ["Un chat."], text: "Information" }])));
		assert.ok(store.has(kind));
		assert.equal((await store.lookup(kind, "CHAT")).rows[0].words?.[0], "félin");
		assert.ok(settings.wordDictionaryPaths[kind]?.startsWith(`plugin/data/dictionnaires-${kind}-`));
		await store.select(kind, settings.wordDictionaryPaths[kind]!);
	}
	assert.equal(settings.wordDictionaries.length, extra.length);
	assert.ok(resourceCalls.length > 0);
	const originalPaths = JSON.stringify(settings.wordDictionaryPaths);
	await store.refresh();
	assert.equal(JSON.stringify(settings.wordDictionaryPaths), originalPaths);
	assert.ok(extra.every(kind => store.has(kind)));
	for (const kind of extra) {
		await store.remove(kind, settings.wordDictionaryPaths[kind]!);
		assert.equal(store.has(kind), false);
	}
	const resources = new api.LinguisticResources(adapter, "plugin", "0.4.16");
	const defaults = new api.WordDictionaries(adapter, "plugin", () => settings, async () => {}, resources);
	const revisions: Partial<Record<import("../plugin/linguistic-files").ResourcePack, string>> = {};
	const base = "https://github.com/tcrouzet/finition/releases/download/resources-0.4.16/";
	for (const kind of api.publicDictionaryKinds) {
		assert.ok(api.resourcePacks.includes(kind), `${kind} absent des packs de release`);
		const catalogue = [];
		for (const file of api.resourceFiles[kind]) {
			const data = file.endsWith(".json") ? bytes({ ...sample(kind, [{ text: "Information", words: ["félin"] }]), name: "Finition" }) : new TextEncoder().encode("CC-BY-SA-4.0").buffer;
			downloads.set(base + api.resourceAssetName(kind, file), data);
			catalogue.push({ path: file, bytes: data.byteLength, sha256: await api.resourceHash(data) });
		}
		downloads.set(base + `${kind}-resources.json`, bytes({ version: 1, engine: kind, files: catalogue }));
		revisions[kind] = await resources.install(kind, () => {});
		await resources.refresh(revisions);
		await defaults.refresh();
		await defaults.select(kind, "");
		assert.ok(defaults.has(kind), `${kind} téléchargé indisponible`);
		assert.equal((await defaults.lookup(kind, "chat")).dictionary.name, "Finition");
		assert.ok(requests.includes(base + `${kind}-resources.json`));
		assert.equal(settings.wordDictionaries.length, 0, "Un pack public est enregistré comme import personnel");
	}
	const cancelledResources = new api.LinguisticResources(adapter, "cancelled-plugin", "0.4.16");
	for (const stage of ["before", "catalogue", "file"]) {
		const controller = new AbortController();
		const beforeRequests = requests.length;
		if (stage === "before") controller.abort();
		onDownload = url => { if ((stage === "catalogue" && url.endsWith("-resources.json")) || (stage === "file" && !url.endsWith("-resources.json"))) controller.abort(); };
		await assert.rejects(cancelledResources.install("citations", () => {}, controller.signal), { name: "AbortError" });
		assert.equal(requests.length - beforeRequests, stage === "before" ? 0 : stage === "catalogue" ? 1 : 2, "Un téléchargement arrêté continue à charger les fichiers");
		assert.ok(![...files.keys()].some(path => path.startsWith("cancelled-plugin/")), "Un téléchargement arrêté écrit ou active des ressources");
	}
	const controller = new AbortController();
	let releaseDownload!: () => void;
	onDownload = () => new Promise(resolve => { releaseDownload = resolve; });
	const waitingDownload = cancelledResources.install("citations", () => {}, controller.signal);
	controller.abort();
	await assert.rejects(waitingDownload, { name: "AbortError" });
	releaseDownload();
	onDownload = () => {};
	const retried = await cancelledResources.install("citations", () => {});
	await cancelledResources.refresh({ citations: retried });
	assert.equal(cancelledResources.available("citations"), true, "Un téléchargement arrêté empêche la relance");
	const reloaded = new api.LinguisticResources(adapter, "plugin", "0.4.16");
	await reloaded.refresh(revisions);
	const restored = new api.WordDictionaries(adapter, "plugin", () => settings, async () => {}, reloaded);
	await restored.refresh();
	assert.ok(api.publicDictionaryKinds.every(kind => restored.has(kind)), "Un téléchargement n’est pas conservé après rechargement");
	assert.equal(restored.options.length, api.publicDictionaryKinds.length);
	let document = "Un chat.";
	let selectionFrom = 3, selectionTo = 7;
	const editor = { getValue: () => document, getSelection: () => document.slice(selectionFrom, selectionTo), listSelections: () => [{}], getCursor: (which: string) => ({ line: 0, ch: which === "from" ? selectionFrom : selectionTo }),
		posToOffset: (position: { ch: number }) => position.ch, offsetToPos: (ch: number) => ({ line: 0, ch }),
		replaceRange: (text: string, from: { ch: number }, to: { ch: number }) => { document = document.slice(0, from.ch) + text + document.slice(to.ch); }, setSelection() {}, focus() {} };
	const view = { editor, file: { path: "test.md" } };
	await api.runLocalWordLookup({ workspace: { getActiveViewOfType: () => view } } as unknown as import("obsidian").App, "Conjugaisons", async () => ({ rows: [{ label: "Associations", words: ["chat sauvage", "<b>félin</b>"], text: "Contexte", examples: ["Exemple."] }] }));
	assert.ok(opened, notices.join("\n"));
	assert.equal(focused.at(-1), opened.contentEl, "L’ouverture doit placer le focus sur le contenu, sans sélectionner le bouton d’insertion");
	assert.equal(opened.contentEl.tabIndex, -1, "Le contenu ne doit pas ajouter une étape à la navigation Tab");
	assert.equal(focusOptions?.preventScroll, true, "Le focus initial ne doit pas déplacer la lecture");
	assert.ok(opened.contentEl.children.some(element => element.options.text === "chat sauvage, <b>félin</b>"), "Les mots associés doivent être affichés en texte littéral.");
	opened.modalEl.children.at(-1)!.children[0].click!();
	assert.equal(document, "Un chat.\n\n%%\nchat\n\nAssociations\nContexte\nchat sauvage\n<b>félin</b>\nExemple.\n%%\n", "L’insertion doit conserver les mots associés.");
	const descendants = (element: Element): Element[] => [element, ...element.children.flatMap(descendants)];
	const citationLexicon = { lemmas: new Map([["chats", "chat"], ["chevaux", "cheval"], ["étaient", "être"], ["était", "être"], ["suis", "être"], ["suivait", "suivre"], ["les", "le"], ["porte-monnaies", "porte-monnaie"]]), variants: new Map([["suis", ["être", "suivre"]]]) };
	for (const [word, quote, expected] of [
		["chats", "Le chat, les CHATS, l’chat et le chaton : <b>chat</b>.", ["chat", "CHATS", "chat", "chat"]],
		["chevaux", "Un cheval, deux chevaux et un chevalier.", ["cheval", "chevaux"]],
		["suis", "Il était, ils étaient ; je suis, elle suivait.", ["était", "étaient", "suis", "suivait"]],
		["était", "😀 Il E\u0301TAIT, ils étaient.", ["E\u0301TAIT", "étaient"]],
		["aujourd’hui", "Aujourd'hui et aujourd’hui, jamais demain.", ["Aujourd'hui", "aujourd’hui"]],
		["le", "L’arbre, les arbres et le vent.", ["L", "les", "le"]],
		["porte-monnaie", "Des porte-monnaies et un porte‑monnaie.", ["porte-monnaies", "porte‑monnaie"]],
	] as const) {
		document = word; selectionFrom = 0; selectionTo = word.length;
		await api.runLocalWordLookup({ workspace: { getActiveViewOfType: () => view } } as unknown as import("obsidian").App, "Citations", async () => ({ rows: [{ label: `Référence : ${word}`, text: quote }, { text: `Source : ${word}`, examples: [quote] }], citationLexicon }));
		const paragraphs: Element[] = opened.contentEl.children.filter(element => element.tag === "p");
		const quotations = paragraphs.filter(element => element.textContent === quote);
		assert.equal(quotations.length, 2, "La mise en gras doit conserver chaque citation à l’identique");
		for (const paragraph of quotations) assert.deepEqual(descendants(paragraph).filter(element => element.tag === "strong").map(element => element.textContent), [...expected], `Flexions en gras pour ${word}`);
		assert.equal(descendants(opened.contentEl).filter(element => element.tag === "b").length, 0, "Le texte d’une citation ne doit pas être interprété comme du HTML");
		assert.ok(paragraphs.filter(element => element.textContent === `Source : ${word}`).every(element => !descendants(element).some(child => child.tag === "strong")), "Les références bibliographiques ne sont pas des citations");
	}
	document = "chat"; selectionFrom = 0; selectionTo = 4;
	for (const cancel of [false, true]) for (const outcome of ["success", "empty", "error"]) {
		let release!: () => void;
		const waiting = new Promise<void>(resolve => { release = resolve; });
		const pending = api.runLocalWordLookup({ workspace: { getActiveViewOfType: () => view } } as unknown as import("obsidian").App, "Citations", async () => {
			await waiting;
			if (outcome === "error") throw new Error("Lecture impossible");
			return { rows: outcome === "empty" ? [] : [{ text: "Un chat." }], citationLexicon };
		});
		const notice = progress.at(-1)!;
		const message = notice.message;
		assert.ok(message instanceof Element && descendants(message).some(element => element.options.cls === "finition-correction-spinner"), "La recherche doit afficher une roue pendant l’attente");
		assert.equal(notice.hidden, false);
		const beforeOpen: { contentEl: Element; modalEl: Element } | undefined = opened;
		const beforeNotices = notices.length;
		if (cancel) {
			const stop = descendants(message).find(element => element.options.cls?.includes("finition-loading-cancel"));
			assert.ok(stop?.click, "La recherche doit proposer une croix d’arrêt");
			stop.click();
			assert.equal(notice.hidden, true, "La croix doit fermer immédiatement la progression");
		}
		release(); await pending;
		assert.equal(notice.hidden, true, `La roue doit disparaître après ${outcome}`);
		if (cancel) {
			assert.equal(opened, beforeOpen, "Une recherche arrêtée ouvre une fenêtre");
			assert.equal(notices.length, beforeNotices, "Une recherche arrêtée affiche un message tardif");
		}
	}
	for (const source of ["---\nchat: privé\n---\nUn texte.", "Un #chat/privé."]) {
		document = source;
		selectionFrom = source.indexOf("chat"); selectionTo = selectionFrom + 4;
		let calls = 0;
		await api.runLocalWordLookup({ workspace: { getActiveViewOfType: () => view } } as unknown as import("obsidian").App, "Flexions", async () => { calls++; return { rows: [] }; });
		assert.equal(calls, 0, "Le dictionnaire analyse un mot dans le YAML ou un tag");
		assert.match(notices.at(-1)!, /hors du YAML et des tags/);
	}
}

if (process.argv[1]?.endsWith("check-extra-dictionary-format.ts")) void checkExtraDictionaryFormat().then(() => process.stdout.write("Dictionnaires supplémentaires : PASS\n"));
