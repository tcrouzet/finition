import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import * as process from "node:process";
import { decodeDictionary, personalDictionaryPath } from "../plugin/lexicon/shared";
import type { LexemeRow } from "../plugin/modes/finition-corrector/lexicon";
import { grammarMorphology } from "../plugin/lexicon/grammalecte-adapter";
import { adaptRepetitions } from "../plugin/lexicon/repetition-adapter";

export function grammarRows(form: string, lemma: string, tag: string): LexemeRow[] {
	const tags = tag.split("/")[0].split(":");
	const categories = new Set<string>();
	const category: Record<string, string> = { N: "nom", A: "adjectif", W: "adverbe", R: "préposition", J: "interjection", B: "nombre" };
	for (const value of tags) {
		if (Object.hasOwn(category, value)) categories.add(category[value]);
		if (/^M[12P]$/.test(value)) categories.add("nom propre");
		if (/^V[0-3]/.test(value)) categories.add("verbe");
		if (/^D/.test(value)) categories.add("déterminant");
		if (/^O/.test(value)) categories.add("pronom");
		if (/^C[cs]?$/.test(value)) categories.add("conjonction");
	}
	const person = tags.find(value => /^[123][sp]/.test(value))?.slice(0, 2) ?? "";
	const gender = tags.includes("m") ? "m" : tags.includes("f") ? "f" : "";
	const number = tags.includes("s") ? "s" : tags.includes("p") ? "p" : person.slice(1);
	const tenses: Record<string, string> = { Ip: "ind:pre", Iq: "ind:imp", Is: "ind:pas", If: "ind:fut", K: "cnd:pre", Sp: "sub:pre", Sq: "sub:imp", E: "imp:pre" };
	const inflections = tags.flatMap(value => Object.hasOwn(tenses, value) ? [tenses[value] + (person ? ":" + person : "")] : value === "Y" ? ["inf"] : value === "P" ? ["par:pre"] : value === "Q" ? ["par:pas"] : []);
	return [...categories].map(category => [form, lemma, category, gender, number, category === "verbe" ? inflections.sort().join(";") : "", 0]);
}

export function mergeRows(neural: readonly LexemeRow[], grammar: Iterable<readonly [string, string, string]>): LexemeRow[] {
	const rows = new Map<string, LexemeRow>();
	const add = (row: LexemeRow) => {
		const key = JSON.stringify(row.slice(0, 5));
		const previous = rows.get(key);
		const inflections = [...new Set([...(previous?.[5].split(";") ?? []), ...row[5].split(";")].filter(Boolean))].sort().join(";");
		rows.set(key, [row[0], row[1], row[2], row[3], row[4], inflections, Math.max(previous?.[6] ?? 0, row[6])]);
	};
	for (const row of neural) add(row);
	for (const [form, lemma, tag] of grammar) for (const row of grammarRows(form, lemma, tag)) add(row);
	return [...rows.values()];
}

export const encodeDictionary = (value: unknown): string => {
	const compressed = gzipSync(JSON.stringify(value), { level: 9 });
	compressed[9] = 255;
	return compressed.toString("base64");
};

async function main() {
	const root = new URL("../", import.meta.url);
	const neuralPath = new URL("scripts/lexicon/neural-v1.json", root);
	let neuralBytes = await readFile(neuralPath);
	let neural = JSON.parse(neuralBytes.toString()) as { name: string; version: number; encoding: string; payload: string; sources: Record<string, { license?: string | null }>; counts: Record<string, number> };
	let data = await decodeDictionary(neural);
	if (data.forms.length && !neural.sources.additionalForms?.license) {
		await mkdir(new URL("Antidote/dictionnaires/archives/", root), { recursive: true });
		const backup = new URL("Antidote/dictionnaires/archives/finition-dictionnaire-legacy.json", root);
		try { await copyFile(neuralPath, backup, 1); }
		catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error; }
		const personal = new URL(personalDictionaryPath, root);
		let forms: string[] = [];
		try {
			const previous: unknown = JSON.parse(await readFile(personal, "utf8"));
			if (!previous || typeof previous !== "object" || !("forms" in previous) || !Array.isArray(previous.forms) || !previous.forms.every((form: unknown) => typeof form === "string")) throw new Error("Complément personnel invalide.");
			forms = previous.forms;
		} catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
		await writeFile(personal, JSON.stringify({ format: "finition-personal-forms", version: 1, forms: [...new Set([...forms, ...data.forms])].sort() }) + "\n");
		delete neural.sources.additionalForms;
		neural = { ...neural, counts: { ...neural.counts, additionalForms: 0, additionalInputForms: 0 }, payload: encodeDictionary([data.entries, []]) };
		neuralBytes = Buffer.from(JSON.stringify(neural) + "\n");
		await writeFile(neuralPath, neuralBytes);
		data = { ...data, forms: [] };
	}
	const vendor = new URL("plugin/vendor/grammalecte/", root);
	const scripts = await Promise.all(["helpers.js", "str_transform.js", "char_player.js", "lexgraph_fr.js", "ibdawg.js"].map(file => readFile(new URL(file, vendor), "utf8")));
	const native = runInNewContext(scripts.join("\n;\n") + "\n;IBDAWG", { console, self: {} }) as new (data: unknown) => { select(): IterableIterator<[string, string, string]> };
	const grammalecte: Record<string, unknown> = {};
	const variants = new Map<string, number>();
	const inputs: Record<string, string> = { neural: createHash("sha256").update(neuralBytes).digest("hex") };
	const records: Array<[string, string, string]> = [];
	for (const [variant, mask] of [["fr-classic", 1], ["fr-reform", 2]] as const) {
		const bytes = await readFile(new URL(`scripts/grammalecte/_dictionaries/${variant}.json`, root));
		const index: unknown = JSON.parse(bytes.toString());
		grammalecte[variant] = index;
		inputs[variant] = createHash("sha256").update(bytes).digest("hex");
		for (const row of new native(index).select()) {
			variants.set(row[0], (variants.get(row[0]) ?? 0) | mask);
			records.push(row);
		}
	}
	const entries = mergeRows(data.entries, records);
	const repetition: unknown = JSON.parse(await readFile(new URL("scripts/lexicon/repetition-v1.json", root), "utf8"));
	if (!repetition || typeof repetition !== "object" || Array.isArray(repetition) || !Object.values(repetition).every(lemma => typeof lemma === "string" && lemma.length > 0)) throw new Error("Lexique de répétition invalide.");
	const lemmas = adaptRepetitions({ entries, forms: [] });
	const lemmaOverrides = Object.entries(repetition).filter(([form, lemma]) => lemmas.get(form) !== lemma);
	const known = new Set(entries.map(row => row[0]));
	const forms = [...new Set([...data.forms, ...variants.keys()])].filter(form => !known.has(form)).sort();
	const variantRows = [...variants].filter(([, mask]) => mask !== 3).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
	const extras = new Map<string, string[]>();
	for (const row of entries) {
		if (variants.has(row[0])) continue;
		const values = extras.get(row[0]) ?? [];
		const morph = grammarMorphology(row);
		if (morph && !values.includes(morph)) values.push(morph);
		extras.set(row[0], values);
	}
	const value = { name: "finition-dictionnaire", version: 2, encoding: "gzip-base64", language: "fr",
		license: { grammalecte: "MPL-2.0", morphalou: "LGPL-LR", lexique: "CC-BY-SA-4.0" },
		sources: { ...neural.sources, grammalecte: { authors: ["Olivier R.", "Dicollecte"], license: "MPL-2.0", url: "https://github.com/Pofilo/grammalecte/blob/master/lexicons/French.lex" } },
		inputs, counts: { analyses: entries.length, morphologicalForms: known.size, additionalForms: forms.length },
		payload: encodeDictionary({ entries, forms, variants: variantRows, lemmaOverrides }),
		grammalectePayload: encodeDictionary({ forms, grammalecte, variants: variantRows, extras: [...extras] }) };
	const destination = new URL("resources/lexique/", root);
	await mkdir(destination, { recursive: true });
	await writeFile(new URL("finition-dictionnaire.json", destination), JSON.stringify(value) + "\n");
	process.stdout.write(JSON.stringify(value.counts) + "\n");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) void main().catch((error: unknown) => { console.error(error); process.exit(1); });
