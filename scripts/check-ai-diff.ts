import assert from "node:assert/strict";
import { diffToGroups, type DiffGroup } from "../plugin/ai/diff";
import { protectLinks } from "../plugin/ai/protected-links";
import { cleanTypography } from "../plugin/ai/clean";
import { fixPunctuationSpacing } from "../plugin/modes/punctuation";

const apply = (source: string, groups: DiffGroup[]) => [...groups].reverse().reduce((text, group) => text.slice(0, group.delFrom) + (group.insText ?? "") + text.slice(group.delTo), source);

export function checkAIDiff(): void {
	assert.equal(protectLinks("J’ai 27\u00a0ans.").diff("J’ai 27 ans.").length, 0, "L’IA propose de supprimer l’insécable après le nombre");
	assert.equal(fixPunctuationSpacing("27 ans, 2 mois et 3 jours."), "27\u00a0ans, 2\u00a0mois et 3\u00a0jours.");
	assert.equal(apply("27\u00a0ans", protectLinks("27\u00a0ans").diff("28 ans")), "28\u00a0ans", "Changer le nombre retire l’insécable de la durée");
	for (const [number, unit] of [["27", "ans"], ["1", "an"], ["2", "années"], ["1", "année"], ["3", "mois"], ["1", "jour"], ["12", "jours"], ["2", "semaines"], ["1", "semaine"], ["24", "heures"], ["1", "heure"], ["5", "minutes"], ["1", "minute"], ["30", "secondes"], ["1", "seconde"], ["2", "décennies"], ["3", "siècles"], ["1", "millénaire"], ["27", "ANS"]] as const) {
		const expected = `${number}\u00a0${unit}`;
		for (const space of ["", " ", "\t", "\u00a0", "\u202f"]) {
			assert.equal(fixPunctuationSpacing(`${number}${space}${unit}`), expected, "Ponctuations n’ajoute pas l’insécable avant une durée");
			assert.equal(cleanTypography(`${number}${space}${unit}`), expected, "La normalisation IA perd l’insécable avant une durée");
		}
		assert.equal(protectLinks(expected).diff(`${number} ${unit}`).length, 0);
		assert.equal(fixPunctuationSpacing(expected), expected, "Une durée correcte n’est pas stable au second passage");
	}
	for (const protectedText of ["`27 ans`", "[27 ans](https://example.org/27ans)", "#27ans", "27\nans", "27 anniversaires", "27 anciens", "version27ans"]) assert.equal(fixPunctuationSpacing(protectedText), protectedText, "La règle de durée modifie un contenu protégé ou un autre mot");
	for (const [source, revised] of [
		["jours,", "jours;"], ["Paris", "Paris,"], ["médecins,", "médecins;"],
		["Lot-et-Garonne,", "Lot-et-Garonne;"], ["l’embrassait,", "l’embrassait;"],
		["j'ai", "j’ai"], ["0,5", "0.5"], ["😀 café, café.", "😀 café; café."],
		["«texte»", "“texte”"], ["Attends...", "Attends…"], ["mot, ", "mot,\u00a0"], ["😀", "😃"],
	] as const) {
		const groups = diffToGroups(source, revised);
		assert.equal(apply(source, groups), revised);
		assert.ok(groups.length > 0);
		assert.ok(groups.every(group => !/[\p{L}\p{M}\p{N}_]/u.test(group.delText + (group.insText ?? ""))), `Une correction de ponctuation recolore un mot intact : ${source}`);
		for (const group of groups) assert.equal(source.slice(group.delFrom, group.delTo), group.delText);
		const protectedGroups = protectLinks(source).diff(revised);
		assert.equal(apply(source, protectedGroups), cleanTypography(revised));
		assert.ok(protectedGroups.every(group => !/[\p{L}\p{M}\p{N}_]/u.test(group.delText + (group.insText ?? ""))), "Le recalage des liens réintroduit les mots intacts");
	}
	assert.deepEqual(diffToGroups("Une fote.", "Une faute."), [{ delFrom: 4, delTo: 8, delText: "fote", insText: "faute" }], "Une correction orthographique doit conserver le mot entier");
	const long = "un mot intact, ".repeat(2500);
	const revised = long.replace("intact,", "intact;");
	assert.ok(diffToGroups(long, revised).every(group => !/\p{L}/u.test(group.delText + (group.insText ?? ""))), "Une ponctuation dans un long paragraphe recolore le texte entier");
	assert.equal(apply(long, diffToGroups(long, revised)), revised);
	const allPunctuation = long.replace(/,/gu, ";");
	const longGroups = diffToGroups(long, allPunctuation);
	assert.equal(apply(long, longGroups), allPunctuation);
	assert.ok(longGroups.every(group => !/\p{L}/u.test(group.delText + (group.insText ?? ""))), "De nombreuses ponctuations dans un long paragraphe recolorent des mots intacts");
	let seed = 173;
	const next = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const alphabet = ["mot", "a", "é", "e\u0301", "😀", "😃", " ", "\u00a0", ",", ";", "'", "’", "\n", "-", "1"];
	for (let sample = 0; sample < 200; sample++) {
		const tokens = Array.from({ length: 30 }, () => alphabet[next(alphabet.length)]);
		const source = tokens.join("");
		tokens.splice(next(tokens.length), next(4), alphabet[next(alphabet.length)]);
		const revised = tokens.join("");
		const groups = diffToGroups(source, revised);
		assert.equal(apply(source, groups), revised, "Le diff ne reconstitue pas la révision");
		for (const group of groups) {
			assert.equal(source.slice(group.delFrom, group.delTo), group.delText);
			for (const char of Array.from(group.delText + (group.insText ?? ""))) assert.ok(!(char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff), "Le diff coupe une paire UTF-16");
		}
	}
	process.stdout.write("Diff IA : ponctuation isolée, mots, Unicode, positions et longs paragraphes vérifiés\n");
}

if (process.argv[1]?.endsWith("check-ai-diff.ts")) checkAIDiff();
