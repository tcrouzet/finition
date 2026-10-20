import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { decodeDictionary, readPersonalForms } from "../plugin/lexicon/shared";
import { adaptNeural } from "../plugin/lexicon/neural-adapter";
import { adaptRepetitions } from "../plugin/lexicon/repetition-adapter";
import { adaptGrammalecte, grammarMorphology, type GraphspellDictionary } from "../plugin/lexicon/grammalecte-adapter";
import { encodeDictionary, grammarRows, mergeRows } from "./merge-lexicons";
import type { LexemeRow } from "../plugin/modes/finition-corrector/lexicon";
import * as process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function checkSharedLexicon() {
	const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
	const source: unknown = JSON.parse(await read("resources/lexique/finition-dictionnaire.json"));
	const dictionary = await decodeDictionary(source);
	const reference = JSON.parse(await read("scripts/lexicon/repetition-v1.json")) as Record<string, string>;
	const repetition = adaptRepetitions(dictionary);
	for (const [form, lemma] of Object.entries(reference)) assert.equal(repetition.get(form), lemma, `Lemme de répétition modifié : ${form}`);
	assert.equal(adaptRepetitions({ entries: [], forms: [] }).size, 0);
	assert.ok(repetition.size > Object.keys(reference).length, "Les répétitions n’utilisent pas l’enrichissement du lexique commun");
	assert.equal(repetition.get("mangeaient"), "manger");
	assert.ok(dictionary.lemmaOverrides?.length, "Les choix historiques des mots ambigus ne sont pas conservés");
	const grammarOnly = await decodeDictionary(source, "grammalecte");
	assert.equal(grammarOnly.entries.length, 0, "Grammalecte décompresse toutes les analyses neuronales");
	assert.ok(grammarOnly.extras?.length);
	const neuralOnly = await decodeDictionary(source, "neural");
	assert.equal(neuralOnly.grammalecte, undefined, "Le neuronal charge les index natifs inutilisés");
	assert.equal(neuralOnly.entries.length, dictionary.entries.length);
	const legacy: unknown = JSON.parse(await read("scripts/lexicon/neural-v1.json"));
	const original = await decodeDictionary(legacy);
	const merged = new Map(dictionary.entries.map(row => [JSON.stringify(row.slice(0, 5)), row]));
	for (const row of original.entries) {
		const actual = merged.get(JSON.stringify(row.slice(0, 5)));
		assert.ok(actual, `Analyse d’origine perdue : ${row[0]}`);
		assert.equal(actual[6], row[6], `Fréquence modifiée : ${row[0]}`);
		for (const feature of row[5].split(";").filter(Boolean)) assert.ok(actual[5].split(";").includes(feature), `Flexion perdue : ${row[0]}`);
	}
	const vendor = "plugin/vendor/grammalecte/";
	const scripts = await Promise.all(["helpers.js", "str_transform.js", "char_player.js", "lexgraph_fr.js", "ibdawg.js"].map(file => read(vendor + file)));
	const Native = runInNewContext(scripts.join("\n;\n") + "\n;IBDAWG", { self: {}, console }) as new (data: unknown) => GraphspellDictionary & { isValid(word: string): boolean; select(): Iterable<[string, string, string]> };
	const publicForms = new Set([...dictionary.entries.map(row => row[0]), ...dictionary.forms]);
	const nativeForms = new Set<string>();
	const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
	for (const variant of ["fr-classic", "fr-reform"] as const) {
		const reference: unknown = JSON.parse(await read(`scripts/grammalecte/_dictionaries/${variant}.json`));
		assert.equal(fingerprint(dictionary.grammalecte![variant]), fingerprint(reference), "Un index natif a perdu des informations");
		const native = new Native(reference);
		for (const [form] of native.select()) { assert.ok(publicForms.has(form), `Forme Grammalecte perdue : ${form}`); nativeForms.add(form); }
		const adapted = adaptGrammalecte(native, dictionary, variant, ["PERSONAL_ONLY_SENTINEL"]);
		for (const word of ["marche", "suis", "défenseur", "allées", "Paris", "le", "mangera"]) assert.deepEqual(adapted.getMorph(word), native.getMorph(word), `Morphologie native modifiée : ${word}`);
		for (const word of ["fote", "bonjor", "milleir"]) assert.deepEqual(adapted.suggest(word), native.suggest(word), `Suggestions natives modifiées : ${word}`);
		const addition = original.entries.find(row => row[2] === "nom" && /^[a-zà-öø-ÿœ]{5,20}$/.test(row[0]) && !native.lookup(row[0]) && !dictionary.variants?.some(([form]) => form === row[0]));
		assert.ok(addition, "Aucun enrichissement lexical mesurable");
		assert.ok(adapted.lookup(addition[0]) && adapted.isValid(addition[0]));
		assert.ok(adapted.getMorph(addition[0]).includes(`>${addition[1]}/:N${addition[3] ? ":" + addition[3] : ""}${addition[4] ? ":" + addition[4] : ""}`));
		assert.equal(native.lookup(addition[0]), false, "L’adaptateur modifie l’index d’origine");
		assert.ok(adapted.lookup("PERSONAL_ONLY_SENTINEL"));
		for (const [form, mask] of dictionary.variants!.slice(0, 30)) assert.equal(adapted.lookup(form), Boolean(mask & (variant === "fr-classic" ? 1 : 2)), `Variante contournée : ${form}`);
	}
	for (const form of dictionary.forms) assert.ok(nativeForms.has(form), "Une forme complémentaire n’a aucune provenance publique");
	const neural = adaptNeural(dictionary, ["PERSONAL_ONLY_SENTINEL"]);
	assert.equal(neural.lookup("marche").length > 1, true, "Les analyses ambiguës ont été aplaties");
	assert.ok(neural.has("PERSONAL_ONLY_SENTINEL") && !adaptNeural({ entries: [], forms: [] }).has("PERSONAL_ONLY_SENTINEL"));
	assert.deepEqual(grammarRows("aimeraient", "aimer", ":V1_it____a:K:3p/*"), [["aimeraient", "aimer", "verbe", "", "p", "cnd:pre:3p", 0]]);
	assert.deepEqual(grammarRows("allées", "aller", ":V3_i____e_:Q:f:p/*"), [["allées", "aller", "verbe", "f", "p", "par:pas", 0]]);
	assert.deepEqual(grammarRows("autres", "autre", ":N:A:e:p/*").map(row => row[2]), ["nom", "adjectif"]);
	const proper = adaptNeural({ entries: grammarRows("NomPropreLocal", "NomPropreLocal", ":M2:m:s/*"), forms: [] });
	assert.ok(proper.has("NomPropreLocal") && proper.has("NOMPROPRELOCAL") && !proper.has("nomproprelocal"), "La fusion a perdu la casse d’un nom propre");
	assert.equal(proper.lookup("nomproprelocal").length, 0);
	const classic = adaptNeural({ entries: [], forms: ["CLASSIC_SENTINEL", "REFORM_SENTINEL"], variants: [["CLASSIC_SENTINEL", 1], ["REFORM_SENTINEL", 2]] }, ["REFORM_SENTINEL"], "fr-classic");
	assert.ok(classic.has("CLASSIC_SENTINEL") && !classic.has("REFORM_SENTINEL"), "Le filtre neuronal laisse passer l’autre variante via les compléments personnels");
	assert.equal(grammarMorphology(["mot", "mot", "__proto__", "", "", "", 0]), undefined, "Une catégorie inconnue invente une morphologie native");
	assert.deepEqual(grammarRows("mot", "mot", ":constructor:__proto__"), []);
	const duplicate: LexemeRow = ["marche", "marcher", "verbe", "", "s", "ind:pre:1s", 12];
	const rows = mergeRows([duplicate], [["marche", "marcher", ":V1_it____a:Ip:3s/*"]]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0][5], "ind:pre:1s;ind:pre:3s");
	assert.equal(rows[0][6], 12);
	for (const entries of [[null], [["mot", "lemme", "nom", "", "", "", -1]]]) await assert.rejects(decodeDictionary({ name: "finition-dictionnaire", version: 1, encoding: "gzip-base64", payload: encodeDictionary([entries, []]) }));
	await assert.rejects(decodeDictionary({ name: "finition-dictionnaire", version: 2, encoding: "gzip-base64", payload: encodeDictionary({ entries: [], forms: [], grammalecte: {}, variants: [] }) }));
	await assert.rejects(readPersonalForms(async () => new TextEncoder().encode('{"format":"finition-personal-forms","version":1,"forms":[null]}').buffer));
	await assert.rejects(decodeDictionary({ name: "finition-dictionnaire", version: 1, encoding: "gzip-base64", payload: encodeDictionary({}) }));
	await assert.rejects(decodeDictionary({ name: "finition-dictionnaire", version: 2, encoding: "gzip-base64", payload: encodeDictionary({ entries: [], forms: [], variants: [], lemmaOverrides: [["mot", null]] }), grammalectePayload: encodeDictionary({}) }, "neural"), /Lemmes/);
	assert.equal(encodeDictionary(rows), encodeDictionary(rows));
	process.stdout.write(`Lexique commun : ${original.entries.length} analyses neuronales conservées, ${dictionary.entries.length} analyses fusionnées ; index, variantes, suggestions, enrichissement, compléments privés et rejets vérifiés\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) void checkSharedLexicon().catch((error: unknown) => { console.error(error); process.exit(1); });
