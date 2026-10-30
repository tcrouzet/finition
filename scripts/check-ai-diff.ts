import assert from "node:assert/strict";
import { diffToGroups, type DiffGroup } from "../plugin/ai/diff";
import { protectLinks } from "../plugin/ai/protected-links";
import { cleanTypography } from "../plugin/ai/clean";
import { fixPunctuationSpacing } from "../plugin/modes/punctuation";
import { stripHTMLTags } from "../plugin/ai/annotations";

const apply = (source: string, groups: DiffGroup[]) => [...groups].reverse().reduce((text, group) => text.slice(0, group.delFrom) + (group.insText ?? "") + text.slice(group.delTo), source);

export function checkAIDiff(): void {
	for (const [source, expected] of [
		["Saison 1, épisode 2, en 2026 : 25 tonnes.", "Saison 1, épisode 2, en 2026\u00a0: 25\u00a0tonnes."],
		["25 tonnes, 27 ans, 40Mo.", "25\u00a0tonnes, 27\u00a0ans, 40\u00a0Mo."],
		["1. Un titre\n\n  2. Une liste\nTrois\n4 choses.", "1. Un titre\n\n  2. Une liste\nTrois\n4 choses."],
		["Mot 123, valeur3, `à 3` et [3 choses](https://example.org/3).", "Mot 123, valeur3, `à 3` et [3 choses](https://example.org/3)."],
		["100 personnes, chapitre 2, saison 1, 25 pages.", "100 personnes, chapitre 2, saison 1, 25 pages."],
		["Le 2 m’a dit que le 3 s’est levé. 25 mo, 25 MO.", "Le 2 m’a dit que le 3 s’est levé. 25 mo, 25 MO."],
		["3,5kg, 20 km/h, 1 m², 5 kWh, 25 °C, 20 % et 5 €.", "3,5\u00a0kg, 20\u00a0km/h, 1\u00a0m², 5\u00a0kWh, 25\u00a0°C, 20\u00a0% et 5\u00a0€."],
	] as const) assert.equal(fixPunctuationSpacing(source), expected, "Les insécables doivent relier un nombre à une unité du dictionnaire uniquement");
	const linked = "Une fote. " + "mot ".repeat(700) + "[lien](https://example.org) " + "mot ".repeat(700) + "Une fote.";
	assert.equal(apply(linked, protectLinks(linked).diff(linked.replace("[lien](https://example.org)", "lien").replaceAll("fote", "faute"))), linked.replaceAll("fote", "faute"), "Le comparateur perd les corrections d’un long tronçon contenant un lien");
	for (const separator of ["\n\n", "\r\n\r\n", "\n \t\n", "\n\u00a0\n", "\n\u202f\n"]) {
		const source = `«\u00a0Maman,${separator}«\u00a0Besoin de te voir.${separator}«\u00a0C’est difficile pour moi.\u00a0»${separator}«\u00a0T’en penses quoi\u00a0?\u00a0»`;
		assert.equal(fixPunctuationSpacing(source), source, "Une ouverture de citation du paragraphe précédent transforme les suivantes en guillemets anglais");
		assert.equal(protectLinks(source).diff(source).length, 0, "La correction IA modifie les guillemets d’un dialogue sur plusieurs paragraphes");
	}
	assert.equal(fixPunctuationSpacing("« Il dit : « oui »\nencore. »\n\n« Une « autre » citation. »"), "«\u00a0Il dit\u00a0: “oui”\nencore.\u00a0»\n\n«\u00a0Une “autre” citation.\u00a0»", "Les citations réellement imbriquées ne sont plus reconnues dans leur paragraphe");
	for (const ending of ["", "\n", "\n\n", "\n\n\n", "\r\n", "\r\n\r\n"]) {
		const source = "Une fote." + ending;
		for (const replyEnding of ["", "\n", "\n\n", "\r\n"]) {
			assert.equal(protectLinks(source).diff(source.trimEnd() + replyEnding).length, 0, "Un retour IA crée une correction sur le saut de ligne final de la note");
			assert.equal(apply(source, protectLinks(source).diff("Une faute." + replyEnding)), "Une faute." + ending, "Accepter une correction change les sauts de ligne finaux");
		}
	}
	const selected = "Avant.\n\nUne fote.\n\nAprès.";
	const from = selected.indexOf("Une"), to = selected.indexOf("Après");
	assert.equal(apply(selected.slice(from, to), protectLinks(selected, from, to).diff("Une faute.")), "Une faute.\n\n", "Une correction sur une sélection supprime son séparateur de paragraphes");
	for (const source of ["  Premier paragraphe.", "\u2060Premier paragraphe.", "Avant.\n\n\u00a0Suite."]) {
		const revised = source.replace(/^[ \t\p{Cf}\u00a0]+/gmu, "");
		assert.equal(protectLinks(source).diff(revised).length, 0, "Des blancs de début de paragraphe produisent une poubelle sans texte visible");
	}
	assert.equal(apply("fote.", protectLinks("fote.").diff(" faute.")), "faute.", "Une correction de mot ajoute un blanc au début du paragraphe");
	assert.equal(apply("25 tonnes.", protectLinks("25 tonnes.").diff("25 tonnes.")), "25\u00a0tonnes.", "Le retour IA doit relier le nombre à une unité reconnue");
	for (const invisible of ["\u2060", "\u200e", "\u200f", "\u200b", "\ufeff", "\u00a0", "\u202f", "\u2009"]) {
		const source = "Premier paragraphe.\n\nDeuxième paragraphe.";
		const revised = `${invisible} Premier paragraphe.\n\n${invisible} Deuxième paragraphe.`;
		assert.equal(cleanTypography(revised), source, "Un invisible reste en début de paragraphe après le retour IA");
		assert.equal(protectLinks(source).diff(revised).length, 0, "Une réponse identique ajoute des caractères invisibles à la note");
	}
	assert.equal(cleanTypography("Premier.\n\n\u2060 \n\nSuite."), "Premier.\n\nSuite.", "Une ligne invisible crée un faux paragraphe");
	assert.equal(cleanTypography("» Suite."), "» Suite.", "La normalisation typographique réintroduit une insécable en tête de paragraphe");
	assert.equal(cleanTypography("\u2060\u00a0– Bonjour."), "—\u00a0Bonjour.", "Un invisible empêche de reconnaître le tiret de dialogue");
	for (const preserved of ["25\u00a0tonnes.", "—\u00a0Bonjour.", "Une famille 👨‍👩‍👧‍👦.", "Un porte\u2060monnaie.", "  - élément\n    - enfant", "    const valeur = 1", "```\n\u2060 code\n```", "`\u2060 code`", "[\u2060 lien](https://example.org)"]) {
		assert.equal(cleanTypography(preserved), preserved, "Le nettoyage altère une insécable, une séquence Unicode ou une zone protégée");
	}
	for (const [source, revised, expected] of [
		["25\u00a0tonnes", "25 tonnes", "25\u00a0tonnes"],
		["25\u00a0bidules", "25 bidules", "25\u00a0bidules"],
		["25\u202fpages", "25 pages", "25\u202fpages"],
		["25\u00a0%", "25 %", "25\u00a0%"],
		["25\u00a0bidules", "26 bidules", "26\u00a0bidules"],
		["25\u00a0bidules", "25 bidule", "25\u00a0bidule"],
		["25\u00a0bidules", "26 bidule", "26\u00a0bidule"],
		["25\u00a0bidules et 3 trucs", "26 machins et 4 choses", "26\u00a0machins et 4 choses"],
		["25\u00a0bidules", "25 bidules en 2026 environ", "25\u00a0bidules en 2026 environ"],
	] as const) assert.equal(apply(source, protectLinks(source).diff(revised)), expected, "Une révision retire une insécable numérique existante");
	assert.equal(fixPunctuationSpacing("25 tonnes"), "25\u00a0tonnes");
	for (const [source, sent] of [
		["Une <strong>fote</strong>.", "Une fote."],
		["<p><em>Une fote</em>.</p>", "Une fote."],
		["Une <SPAN title='a > b' data-secret=\"privé\">fote</SPAN>.", "Une fote."],
		["Une fote<br /> puis une suite<hr>.", "Une fote puis une suite."],
		["Une <!-- commentaire privé -->fote.", "Une fote."],
		["<note-custom>Une fote.</note-custom>", "Une fote."],
		["<svg:text>Une fote.</svg:text>", "Une fote."],
		["<!DOCTYPE html><?xml version='1.0'?><p>Une fote.</p>", "Une fote."],
	] as const) {
		const guarded = protectLinks(source);
		assert.equal(guarded.text, sent, "Des balises HTML ou leurs attributs sont envoyés à l’IA");
		assert.equal(guarded.diff(sent).length, 0, "Le retrait des balises dans l’envoi modifie la note");
		assert.equal(apply(source, guarded.diff(sent.replace("fote", "faute"))), source.replace("fote", "faute"), "Une correction perd les balises HTML ou ses positions");
		assert.equal(apply(source, guarded.diff(sent.replace("fote", "<b>faute</b>"))), source.replace("fote", "faute"), "Des balises ajoutées par l’IA entrent dans la note");
	}
	for (const literal of ["1 < 2 et 3 > 2", "<https://example.org>", "<nom@example.org>"]) assert.equal(stripHTMLTags(literal), literal, "Un texte entre chevrons est confondu avec une balise HTML");
	const withAttributes = "Un <span title='texte privé'>mot</span>.";
	for (const selected of ["texte privé", "</span>"]) {
		const from = withAttributes.indexOf(selected);
		assert.equal(protectLinks(withAttributes, from, from + selected.length).text, "", "Une sélection partielle expose une balise ou ses attributs");
	}
	const annotated = "La 2<sup>e</sup> note contient une fote et H<sub>2</sub>O.";
	const guardedAnnotations = protectLinks(annotated);
	assert.equal(guardedAnnotations.text, "La 2e note contient une fote et H2O.", "Les balises sup/sub sont envoyées à l’IA");
	assert.equal(apply(annotated, guardedAnnotations.diff("La 2e note contient une faute et H2O.")), annotated.replace("fote", "faute"), "Une correction altère un exposant ou un indice");
	assert.equal(apply(annotated, guardedAnnotations.diff("La 2ème note contient une fote et H3O.")), annotated, "L’IA modifie le contenu d’un exposant ou indice");
	for (const source of ["Un <SUP class=\"a>b\">mot</SUP> et une fote.", "Un <sup><sub>mot</sub></sup> et une fote.", "Un <sup>mot</sup> puis <sub>mot</sub> et une fote."]) {
		const guarded = protectLinks(source);
		assert.ok(!/[<>]/u.test(guarded.text), "Des attributs ou balises imbriquées sont envoyés à l’IA");
		assert.equal(apply(source, guarded.diff(guarded.text.replace("fote", "faute"))), source.replace("fote", "faute"));
		assert.equal(protectLinks(source, source.indexOf("mot"), source.indexOf("mot") + 2).diff("autre").length, 0, "Une sélection partielle modifie un exposant ou indice");
	}
	assert.equal(protectLinks("J’ai 27\u00a0ans.").diff("J’ai 27 ans.").length, 0, "L’IA propose de supprimer l’insécable après le nombre");
	assert.equal(fixPunctuationSpacing("27 ans, 2 mois et 3 jours."), "27\u00a0ans, 2\u00a0mois et 3\u00a0jours.");
	assert.equal(apply("27\u00a0ans", protectLinks("27\u00a0ans").diff("28 ans")), "28\u00a0ans", "Changer le nombre retire l’insécable de la durée");
	for (const [number, unit] of [["27", "ans"], ["1", "an"], ["2", "années"], ["1", "année"], ["3", "mois"], ["1", "jour"], ["12", "jours"], ["2", "semaines"], ["1", "semaine"], ["24", "heures"], ["1", "heure"], ["5", "minutes"], ["1", "minute"], ["30", "secondes"], ["1", "seconde"], ["2", "décennies"], ["3", "siècles"], ["1", "millénaire"], ["27", "ANS"]] as const) {
		const expected = `${number}\u00a0${unit}`;
		for (const space of ["", " ", "\t", "\u00a0", "\u202f"]) {
			const preserved = space === "\u202f" ? `${number}\u202f${unit}` : expected;
			assert.equal(fixPunctuationSpacing(`${number}${space}${unit}`), preserved, "Ponctuations ne relie pas une durée à son nombre");
			assert.equal(cleanTypography(`${number}${space}${unit}`), preserved, "La normalisation IA perd l’insécable avant une durée");
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
	for (let sample = 0; sample < 20; sample++) {
		const source = `Avant ${"mot ".repeat(700)}milieu ${"texte ".repeat(700)}après.`;
		const revised = source.replace("Avant", "😀 Un commencement").replace("milieu", next(2) ? "" : "au centre").replace("après", "une conclusion entière");
		const groups = diffToGroups(source, revised);
		assert.equal(apply(source, groups), revised, "Le diff des longs tronçons perd une insertion, suppression ou position Unicode");
		for (const group of groups) assert.equal(source.slice(group.delFrom, group.delTo), group.delText);
	}
	const rewritten = "source ".repeat(1200), replacement = "réécrit ".repeat(1200);
	assert.equal(apply(rewritten, diffToGroups(rewritten, replacement)), replacement, "Le garde-fou du diff perd une réécriture complète");
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
