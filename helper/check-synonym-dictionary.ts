import * as assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { finitionSynonymMetadata, isSynonymWord, synonymKey, personalSynonymPath, parseSynonymDictionary, SynonymsDictionary, type SynonymDictionary } from "../plugin/synonyms";

async function main() {
	const sample: SynonymDictionary = {
		format: "finition-synonymes", version: 1, language: "fr", name: "Test",
		sources: [{ id: "principal", name: "Principal", license: "CC0-1.0", url: "" }, { id: "second", name: "Second", license: "CC0-1.0", url: "" }],
		groups: [
			{ category: "adjectif", label: "", words: ["Rapide", "prompt", "VIF"], sources: ["second"] },
			{ category: "adjectif", label: "", words: ["vif", "véloce"], sources: ["principal"] },
		], index: { rapide: [0, 1], "l'œil": [1] },
	};
	for (const word of ["ÉTÉ", "l’œil", "arc-en-ciel", "porte‑bonheur", "e\u0301te\u0301"]) assert.ok(isSynonymWord(word), word);
	for (const word of ["", " rapide", "deux mots", "42", "<script>", "-mot", "mot\n"]) assert.ok(!isSynonymWord(word), word);
	assert.equal(synonymKey("L’ŒIL"), "l'œil");
	assert.equal(synonymKey("E\u0301TE\u0301"), "été");
	for (const path of ["", "local.json", ".obsidian/plugins/finition/prive.json"]) assert.equal(personalSynonymPath(path), path);
	for (const path of ["../x.json", "/tmp/x.json", "a/../x.json", "a//x.json", "a/./x.json", "a\\x.json", "https://x.json", "a.json\u0000", "a.js"]) assert.throws(() => personalSynonymPath(path));
	assert.deepEqual(parseSynonymDictionary(JSON.stringify(sample)), sample);
	const metadata = { ...sample, description: "myThes et WOLF", documentation: "https://example.org/dictionnaire" };
	assert.deepEqual(parseSynonymDictionary(JSON.stringify(metadata)), metadata);
	const rich = { ...sample, groups: [{ ...sample.groups[0], sense: "Personne qui défend.", unmarked: ["Rapide", "prompt", "VIF"], registers: [{ labels: ["québec", "familier"], words: ["VIF"] }] }], index: { rapide: [0] } };
	assert.deepEqual(parseSynonymDictionary(JSON.stringify(rich)), rich);
	for (const change of [
		{ format: "other" }, { version: 2 }, { language: "en" }, { sources: [] }, { groups: [] }, { index: {} },
		{ description: 42 }, { description: "x".repeat(1001) }, { description: "texte\u0000" }, { documentation: 42 },
		{ sources: [...sample.sources, sample.sources[0]] },
		{ index: { rapide: [-1] } }, { index: { rapide: [2] } }, { index: { rapide: [0.5] } }, { index: { Rapide: [0] } },
		{ index: { "deux mots": [0] } }, { groups: [{ ...sample.groups[0], sources: ["unknown"] }] },
		{ groups: [{ ...sample.groups[0], words: ["texte\u0000"] }] },
		{ groups: [{ ...sample.groups[0], sense: 42 }] },
		{ groups: [{ ...sample.groups[0], sense: "texte\u0000" }] },
		{ groups: [{ ...sample.groups[0], unmarked: "prompt" }] },
		{ groups: [{ ...sample.groups[0], unmarked: ["absent"] }] },
		{ groups: [{ ...sample.groups[0], registers: [{ labels: [], words: ["prompt"] }] }] },
		{ groups: [{ ...sample.groups[0], registers: [{ labels: ["rare"], words: ["absent"] }] }] },
		{ groups: [{ ...sample.groups[0], registers: [{ labels: ["rare"], words: [] }] }] },
		{ groups: [{ ...sample.groups[0], registers: [{ labels: Array(9).fill("rare"), words: ["prompt"] }] }] },
	]) assert.throws(() => parseSynonymDictionary(JSON.stringify({ ...sample, ...change })));
	for (const documentation of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "obsidian://test", "/doc", "https://example.org/\n", "https://example.org/" + "x".repeat(2000)]) {
		assert.throws(() => parseSynonymDictionary(JSON.stringify({ ...sample, documentation })));
	}
	let seed = 37;
	for (let index = 0; index < 128; index++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const protocol = ["http", "https", "javascript", "data", "file", "obsidian", "ftp", "vbscript"][seed % 8];
		const documentation = `${protocol}://example.org/${seed}`;
		if (["http", "https"].includes(protocol)) assert.equal(parseSynonymDictionary(JSON.stringify({ ...sample, documentation })).documentation, documentation);
		else assert.throws(() => parseSynonymDictionary(JSON.stringify({ ...sample, documentation })));
	}
	for (const text of ["null", "[]", "{", "\ufeff{}"]) assert.throws(() => parseSynonymDictionary(text));
	let reads = 0;
	const dictionary = new SynonymsDictionary(async () => { reads++; return new TextEncoder().encode(JSON.stringify(sample)).buffer; });
	assert.deepEqual(await dictionary.lookup("RAPIDE"), ["vif", "véloce", "prompt"]);
	assert.deepEqual(await dictionary.lookup("l’œil"), ["vif", "véloce"]);
	assert.deepEqual((await dictionary.lookupGroups("rapide")).map(group => group.words), [["vif", "véloce"], ["prompt", "VIF"]]);
	assert.deepEqual(await dictionary.lookup("constructor"), []);
	assert.equal(reads, 1);
	const richDictionary = new SynonymsDictionary(async () => new TextEncoder().encode(JSON.stringify(rich)).buffer);
	const richGroups = await richDictionary.lookupGroups("rapide");
	assert.equal(richGroups[0].sense, "Personne qui défend.");
	assert.deepEqual(richGroups[0].registers, rich.groups[0].registers);
	assert.deepEqual(richGroups[0].unmarked, ["prompt", "VIF"]);
	await assert.rejects(dictionary.lookup("deux mots"));
	let attempt = 0;
	const retry = new SynonymsDictionary(async () => { if (!attempt++) throw new Error("Lecture impossible"); return new TextEncoder().encode(JSON.stringify(sample)).buffer; });
	await assert.rejects(retry.lookup("rapide"), /Lecture impossible/);
	assert.ok((await retry.lookup("rapide")).length);
	await assert.rejects(new SynonymsDictionary(async () => new Uint8Array([255]).buffer).lookup("rapide"));
	const publicText = readFileSync("ressources/synonymes/synonymes.json", "utf8");
	const publicData = parseSynonymDictionary(publicText);
	assert.equal(publicData.description, finitionSynonymMetadata.description);
	assert.equal(publicData.documentation, finitionSynonymMetadata.documentation);
	assert.deepEqual(publicData.sources.map(source => source.id), ["mythes", "wolf"]);
	assert.ok(Object.keys(publicData.index).length > 40000 && publicData.groups.length > 50000);
	const publicDictionary = new SynonymsDictionary(async () => new TextEncoder().encode(publicText).buffer);
	assert.ok((await publicDictionary.lookup("rapide")).some(word => synonymKey(word) === "véloce"));
	assert.ok((await publicDictionary.lookup("maison")).length > 1);
	const privatePath = "Antidote/dictionnaires/finition-synonymes.json";
	if (existsSync(privatePath)) {
		const personal = parseSynonymDictionary(readFileSync(privatePath, "utf8"));
		assert.deepEqual(personal.sources.map(source => source.id), ["personnel"]);
		assert.ok(Object.keys(personal.index).length > 70000);
		const groups = await new SynonymsDictionary(async () => new TextEncoder().encode(JSON.stringify(personal)).buffer).lookupGroups("défenseur");
		for (const label of ["Partisan", "Protecteur", "Avocat"]) assert.ok(groups.some(group => group.label === label && group.words.length), label);
	}
	const detailsPath = "Antidote/dictionnaires/finition-synonymes-details.json";
	if (existsSync(detailsPath)) {
		const text = readFileSync(detailsPath, "utf8");
		parseSynonymDictionary(text);
		const groups = await new SynonymsDictionary(async () => new TextEncoder().encode(text).buffer).lookupGroups("défenseur");
		assert.equal(new Set(groups.map(group => group.sense)).size, 4);
		assert.ok(groups[0].sense?.includes("cause"));
		assert.equal(groups[0].label, "Partisan");
		assert.ok(groups[0].registers?.some(row => row.labels[0] === "rare" && row.words.includes("mainteneur")));
		assert.ok(groups.some(group => group.registers?.some(row => row.labels.join("/") === "québec/familier" && row.words.includes("obstineux"))));
		assert.ok(groups.some(group => group.words.includes("libero")));
		assert.ok(groups.every(group => !group.words.includes("liberolibéro")));
	}
	process.stdout.write(`PASS: format, chemins, Unicode, cache, erreurs ; ${Object.keys(publicData.index).length} entrées publiques validées\n`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
