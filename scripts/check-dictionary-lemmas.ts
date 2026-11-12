import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import type { DictionaryKind, DictionaryRow, DictionarySettings, WordDictionary } from "../plugin/dictionaries";
import type { LexemeRow } from "../plugin/modes/finition-corrector/lexicon";
import type { DictionaryLemmas, SynonymDictionary } from "../plugin/synonyms";

export async function checkDictionaryLemmas(): Promise<void> {
	const built = await build({ stdin: { contents: 'export * from "./plugin/dictionaries"; export * from "./plugin/synonyms"; export * from "./plugin/lexicon/repetition-adapter";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"] });
	const module = { exports: {} };
	runInNewContext(built.outputFiles[0].text, { module, URL, TextDecoder, TextEncoder, window: { setTimeout }, require: (name: string) => { assert.equal(name, "obsidian"); return { requestUrl() { throw new Error("Réseau interdit"); } }; } });
	const api = module.exports as typeof import("../plugin/dictionaries") & typeof import("../plugin/synonyms") & typeof import("../plugin/lexicon/repetition-adapter");
	const entries: LexemeRow[] = [
		["chats", "chat", "nom", "m", "p", "", 1],
		["couraient", "courir", "verbe", "", "p", "imparfait", 1],
		["suis", "être", "verbe", "", "s", "présent", 1],
		["suis", "suivre", "verbe", "", "s", "présent", 1],
		["était", "être", "verbe", "", "s", "imparfait", 1],
		["l’amis", "l’ami", "nom", "m", "p", "", 1],
	];
	const shared = { entries, forms: [] };
	const lemmas = api.adaptRepetitions(shared);
	let lexicon: DictionaryLemmas = { lemmas, variants: api.dictionaryLemmaVariants(shared, lemmas) };
	assert.deepEqual(Array.from(api.dictionaryKeys("CHATS", lexicon)), ["chat"]);
	assert.deepEqual(Array.from(api.dictionaryKeys("SUIS", lexicon)), ["être", "suivre"]);
	assert.deepEqual(Array.from(api.dictionaryKeys("LʼAMIS", lexicon)), ["l'ami"]);
	assert.deepEqual(Array.from(api.dictionaryKeys("E\u0301TAIT", lexicon)), ["être"]);
	assert.deepEqual(Array.from(api.dictionaryKeys("chaton", lexicon)), ["chaton"]);
	assert.equal(api.dictionaryLabels.historique, "Étymologie");
	const data: SynonymDictionary = {
		format: "finition-synonymes", version: 1, language: "fr", name: "Test",
		sources: [{ id: "test", name: "Test", license: "CC0-1.0", url: "" }],
		groups: [
			{ category: "nom", label: "", words: ["chat", "félin"], sources: ["test"] },
			{ category: "verbe", label: "", words: ["être", "exister"], sources: ["test"] },
			{ category: "verbe", label: "", words: ["suivre", "accompagner"], sources: ["test"] },
		], index: { chat: [0], chats: [0], être: [1], suivre: [2] },
	};
	let reads = 0;
	const synonyms = new api.SynonymsDictionary(async () => { reads++; return new TextEncoder().encode(JSON.stringify(data)).buffer; }, async () => lexicon);
	const exact = new api.SynonymsDictionary(async () => new TextEncoder().encode(JSON.stringify(data)).buffer);
	assert.deepEqual(Array.from(await exact.lookup("était")), [], "Sans résolution du lemme, la forme fléchie reste introuvable");
	assert.deepEqual(Array.from(await synonyms.lookup("était")), ["exister"]);
	assert.deepEqual(Array.from(await synonyms.lookup("chats")), ["félin"], "Une flexion doit retrouver les synonymes de son lemme sans doublon");
	assert.deepEqual(Array.from(await synonyms.lookup("suis")), ["exister", "accompagner"], "Les analyses ambiguës doivent être conservées");
	assert.deepEqual(Array.from(await synonyms.lookup("constructor")), []);
	assert.equal(reads, 1);
	const row = { text: "Petit félin." };
	const quote = { label: "Victor Hugo, 1862", text: "Les chats couraient près de l’ami aujourd’hui." };
	const historical = { text: "Référence : Hugo, cours, 1862", examples: ["Il était sans crainte."] };
	const makeDictionary = (kind: DictionaryKind, values: Record<string, DictionaryRow[]>): WordDictionary => ({ format: "finition-dictionnaire", version: 1, language: "fr", kind, name: "Test", entries: values });
	const documents: Partial<Record<DictionaryKind, WordDictionary>> = {
		definitions: makeDictionary("definitions", { chat: [row, row], chats: [{ text: "Entrée fléchie à ignorer." }] }),
		historique: makeDictionary("historique", { courir: [{ text: "Du latin currere." }] }),
		phonetique: makeDictionary("phonetique", { chat: [{ text: "ʃa" }], chats: [{ text: "forme fléchie" }] }),
		rimes: makeDictionary("rimes", { chat: [{ words: ["rat"] }], chats: [{ words: ["plats"] }] }),
		citations: makeDictionary("citations", { origine: [quote, historical], autre: [quote] }),
	};
	let lemmaReads = 0;
	const settings: DictionarySettings = { wordDictionaries: [], wordDictionaryPaths: {} };
	const resources = {
		available: (kind: DictionaryKind) => Boolean(documents[kind]),
		read: async (kind: DictionaryKind) => new TextEncoder().encode(JSON.stringify(documents[kind])).buffer,
	} as unknown as import("../plugin/linguistic-resources").LinguisticResources;
	const store = new api.WordDictionaries({} as import("obsidian").DataAdapter, "plugin", () => settings, async () => {}, resources, async () => { lemmaReads++; return lexicon; });
	await store.refresh();
	assert.equal((await store.lookup("definitions", "CHATS")).rows.length, 1, "Seul le lemme doit être recherché et les sens identiques dédoublonnés");
	assert.equal((await store.lookup("definitions", "CHATS")).rows[0].text, row.text);
	assert.equal((await store.lookup("historique", "couraient")).rows[0]?.text, "Du latin currere.");
	const before = lemmaReads;
	assert.equal((await store.lookup("phonetique", "chats")).rows[0]?.text, "forme fléchie");
	assert.deepEqual(Array.from((await store.lookup("rimes", "chats")).rows[0].words!), ["plats"]);
	assert.equal(lemmaReads, before, "Phonétique et Rimes doivent conserver la forme sélectionnée");
	const original = JSON.stringify(documents.citations);
	for (const word of ["chat", "chats", "courir", "couraient", "ami", "le", "aujourd’hui"]) {
		const rows = (await store.lookup("citations", word)).rows;
		assert.equal(rows.length, 1, `Citation introuvable ou dupliquée pour ${word}`);
		assert.equal(rows[0].text, quote.text);
		assert.equal(rows[0].label, quote.label);
	}
	assert.equal((await store.lookup("citations", "être")).rows[0]?.examples?.[0], historical.examples[0]);
	assert.equal((await store.lookup("citations", "suis")).rows.length, 1);
	for (const word of ["Hugo", "cours", "origine", "chaton", "constructor"]) assert.equal((await store.lookup("citations", word)).rows.length, 0, `La recherche doit porter sur le texte cité : ${word}`);
	assert.equal(JSON.stringify(documents.citations), original, "L’index lemmatisé ne doit pas réécrire les citations");
	lexicon = { lemmas: new Map(lemmas).set("couraient", "chanter").set("chats", "être"), variants: new Map() };
	assert.equal((await store.lookup("citations", "courir")).rows.length, 0, "Un ancien index de citations survit au changement de lexique");
	assert.equal((await store.lookup("citations", "chanter")).rows.length, 1);
	assert.deepEqual(Array.from(await synonyms.lookup("chats")), ["exister"], "Le dictionnaire de synonymes doit suivre le lemme du lexique actif");
	const many = makeDictionary("citations", { autre: Array.from({ length: 501 }, (_, index) => ({ label: `Référence ${index}`, text: "Les chats couraient." })) });
	assert.equal((await api.buildCitationIndex(many, lexicon)).get("chanter")?.length, 501);
	const publicQuotes = api.parseWordDictionary(readFileSync("resources/citations/citations.json", "utf8"), "citations");
	const publicLexicon: DictionaryLemmas = { lemmas: new Map([["chevaux", "cheval"], ["mangeaient", "manger"], ["mangeait", "manger"]]), variants: new Map() };
	const publicIndex = await api.buildCitationIndex(publicQuotes, publicLexicon);
	const horses = publicIndex.get(api.dictionaryKeys("chevaux", publicLexicon)[0]) ?? [];
	assert.ok(horses.some(row => row.label?.startsWith("George Sand, ")), "Le corpus enrichi doit retrouver Sand depuis une flexion");
	assert.ok((publicIndex.get("manger") ?? []).some(row => row.label?.startsWith("Honoré de Balzac, ")), "La recherche doit couvrir les nouveaux auteurs");
	assert.ok(Array.from(publicIndex.values()).some(rows => rows.some(row => row.label?.includes("https://fr.wikiquote.org/w/index.php?oldid="))), "Les citations sourcées de Wikiquote doivent être indexées");
	process.stdout.write("Recherches lexicales : flexions, ambiguïtés, étymologie, index de citations, texte original et changement de lexique vérifiés\n");
}

if (process.argv[1]?.endsWith("check-dictionary-lemmas.ts")) void checkDictionaryLemmas();
