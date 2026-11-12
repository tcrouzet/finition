import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { lookupFamily } from "../plugin/ui/family";
import type { LexemeRow } from "../plugin/modes/finition-corrector/lexicon";

export async function checkFamily(): Promise<void> {
	const entries: LexemeRow[] = [
		["suis", "être", "verbe", "", "s", "présent, 1re personne", 1],
		["suis", "suivre", "verbe", "", "s", "présent, 1re personne", 1],
		["sommes", "être", "verbe", "", "p", "présent, 1re personne", 1],
		["suivons", "suivre", "verbe", "", "p", "présent, 1re personne", 1],
		["chats", "chat", "nom", "m", "p", "", 1],
		["chat", "chat", "nom", "m", "s", "", 1],
		["chat", "chat", "nom", "m", "s", "", 10],
		["l'ami", "l'ami", "nom", "m", "s", "", 1],
		["l'amis", "l'ami", "nom", "m", "p", "", 1],
		["sale", "sale", "adjectif", "", "s", "", 1],
		["salé", "saler", "verbe", "m", "s", "participe passé", 1],
	];
	const dictionary = (rows: LexemeRow[]) => new TextEncoder().encode(JSON.stringify({
		format: "finition-dictionnaire", version: 2, language: "fr", name: "Lexique de test", encoding: "gzip-base64",
		payload: gzipSync(JSON.stringify({ entries: rows, forms: ["forme-sans-lemme"], variants: [] })).toString("base64"),
		grammalectePayload: "",
	})).buffer;
	let selected = dictionary(entries), reads = 0;
	const read = () => { reads++; return Promise.resolve(selected); };
	const ambiguous = await lookupFamily(read, "SUIS");
	assert.deepEqual(ambiguous.map(row => row.label), ["être", "suivre"]);
	assert.deepEqual(ambiguous.flatMap(row => row.examples).sort(), [
		"sommes — verbe, p, présent, 1re personne", "suis — verbe, s, présent, 1re personne",
		"suivons — verbe, p, présent, 1re personne", "suis — verbe, s, présent, 1re personne",
	].sort(), "Les lemmes ambigus doivent conserver toutes leurs flexions.");
	assert.equal((await lookupFamily(read, "être"))[0].examples?.length, 2, "Un lemme peut être absent des formes fléchies.");
	assert.deepEqual((await lookupFamily(read, "chats"))[0], { label: "chat", examples: ["chat — nom, m, s", "chats — nom, m, p"] }, "Les fréquences différentes ne dupliquent pas une analyse.");
	assert.equal((await lookupFamily(read, "L’AMI"))[0].examples?.length, 2, "Les apostrophes et la casse doivent être normalisées.");
	assert.deepEqual((await lookupFamily(read, "sale"))[0].examples, ["sale — adjectif, s"], "Les accents doivent rester distinctifs.");
	assert.deepEqual(await lookupFamily(read, "inconnu"), []);
	assert.deepEqual(await lookupFamily(read, "forme-sans-lemme"), [], "Une forme sans analyse ne doit pas inventer de flexions.");
	selected = dictionary([["chats", "chater", "verbe", "", "", "", 0]]);
	assert.deepEqual((await lookupFamily(read, "chats"))[0], { label: "chater", examples: ["chats — verbe"] }, "Le résultat doit suivre le lexique sélectionné, sans ancien cache.");
	assert.equal(reads, 8);
	await assert.rejects(lookupFamily(() => Promise.reject(new Error("Fichier absent")), "chat"), /Fichier absent/);
	await assert.rejects(lookupFamily(() => Promise.resolve(new TextEncoder().encode("{}").buffer), "chat"), /Format du dictionnaire invalide/);
}

if (process.argv[1]?.endsWith("check-family.ts")) void checkFamily().then(() => process.stdout.write("Flexions : PASS\n"));
