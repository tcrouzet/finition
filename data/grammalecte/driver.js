/*
 * driver.js — code "colle" entre le moteur Grammalecte (concaténé avant ce
 * fichier dans le même Worker) et le plugin Finition.
 *
 * Ce fichier n'est PAS un module : il tourne dans le scope global du Worker,
 * après que helpers.js, ibdawg.js, spellchecker.js, gc_engine.js, etc. aient
 * déjà été évalués (voir grammalecte.ts pour l'ordre de concaténation).
 *
 * Contrairement au worker officiel de l'extension Firefox (gce_worker.js),
 * on ne charge AUCUN fichier via importScripts/XHR depuis ce fichier :
 * tout (dictionnaire + données linguistiques) est transmis par postMessage
 * depuis le thread principal, qui lit les fichiers via l'API Obsidian.
 */

"use strict";

let bInitDone = false;

function createResponse(sAction, result, bError) {
	return { sAction: sAction, result: result, bError: !!bError };
}

onmessage = function (e) {
	const { sCommand, oParam } = e.data;
	try {
		switch (sCommand) {
			case "init":
				doInit(oParam);
				break;
			case "parse":
				doParse(oParam);
				break;
			case "lexicalCategories":
				doLexicalCategories(oParam);
				break;
			default:
				postMessage(createResponse(sCommand, "Commande inconnue: " + sCommand, true));
		}
	} catch (e) {
		postMessage(createResponse(sCommand, (e && e.message) || String(e), true));
	}
};

function doInit(oParam) {
	if (bInitDone) {
		postMessage(createResponse("init", true, false));
		return;
	}
	const { oDictionary, sConjData, sPhonetData, sMfspData, sThes1Data, sThes2Data } = oParam;

	// Modules de données linguistiques : init() attend le texte JSON brut
	// (comme le ferait helpers.loadFile), pas un objet déjà parsé.
	conj.init(sConjData);
	phonet.init(sPhonetData);
	mfsp.init(sMfspData);
	thesaurus.init(sThes1Data, sThes2Data);

	// On reproduit gc_engine.load() à la main, car la version originale
	// attend un NOM DE FICHIER + un chemin pour le dictionnaire principal,
	// alors qu'on lui fournit directement l'objet JSON déjà parsé
	// (IBDAWG accepte les deux formes, cf. graphspell-js/ibdawg.js).
	gc_engine.oSpellChecker = new SpellChecker("fr", "", oDictionary, "", "");
	gc_engine.oSpellChecker.activateStorage();
	gc_engine.oTokenizer = gc_engine.oSpellChecker.getTokenizer();
	gc_functions.load("JavaScript", gc_engine.oSpellChecker);
	gc_options.load("JavaScript");
	gc_engine.oOptionsColors = gc_options.getOptionsColors("JavaScript", "aHSL");

	bInitDone = true;
	postMessage(createResponse("init", true, false));
}

// Déduit une catégorie grammaticale lisible (en français, comme dans
// stats.py côté Python) à partir d'une chaîne de morphologie brute
// renvoyée par graphspell (ex. ":V3e:ind:impa:3s", ":N:f:s"...). On ne
// cherche que la présence d'un marqueur de catégorie connu, peu importe sa
// position exacte dans la chaîne — contrairement au lemme, la catégorie
// n'a pas besoin d'un découpage précis.
function categorizeMorph(sMorph) {
	// Un participe (passé "élevé", "né", "fini", "tendu", "ri"... ou
	// présent) est AMBIGU hors contexte : employé seul il fonctionne comme
	// un ADJECTIF ("un homme né à Paris", "un imbécile fini"), mais juste
	// après un auxiliaire (avoir/être conjugué) il fait partie du même
	// groupe VERBAL, pas un complément à part ("j'ai ri" = un seul verbe
	// composé, pas VERBE+COMPLÉMENT). On ne peut pas trancher ici, sans le
	// contexte de la phrase : on renvoie donc une catégorie à part,
	// "participe", et c'est categorizeStructureWords() (structure-
	// signature.ts) qui choisit verbe/adjectif selon le mot précédent.
	// Tags Dicollecte des participes (voir lexgraph_fr.js / dTag) : ":Q" =
	// participe passé, ":P" = participe présent — PAS ":par", qui n'existe
	// pas dans ce jeu d'étiquettes (bug précédent : la règle ne matchait
	// jamais, d'où les participes catégorisés "verbe" sans distinction).
	// On détecte ça AVANT la règle générale "toute forme verbale = verbe"
	// ci-dessous, car une entrée participe porte aussi un tag de groupe
	// verbal (ex. ":V1_:Q:m:s").
	if (/:Q\b/.test(sMorph) || /:P\b/.test(sMorph)) return "participe";
	if (/:V\d/.test(sMorph) || /:V0[ea]/.test(sMorph)) return "verbe";
	if (/:N\b/.test(sMorph) || /:M[12P]\b/.test(sMorph)) return "nom";
	if (/:A\b/.test(sMorph)) return "adjectif";
	if (/:W\b/.test(sMorph)) return "adverbe";
	if (/:R\w*\b/.test(sMorph)) return "préposition";
	if (/:D\w*\b/.test(sMorph)) return "déterminant";
	if (/:O\w*\b/.test(sMorph)) return "pronom";
	if (/:C[cs]?\b/.test(sMorph)) return "conjonction";
	return "";
}

function doLexicalCategories(oParam) {
	if (!bInitDone) {
		postMessage(createResponse("lexicalCategories", "Moteur non initialisé.", true));
		return;
	}
	const words = oParam.words || [];
	const result = {};
	for (const word of words) {
		try {
			const aMorph = gc_engine.oSpellChecker.getMorph(word) || [];
			let category = "";
			let fallback = "";
			for (const sMorph of aMorph) {
				const candidate = categorizeMorph(sMorph);
				if (!fallback && candidate) fallback = candidate;
				if (candidate === "participe") {
					category = candidate;
					break;
				}
			}
			if (!category) category = fallback;
			const alternatives = [...new Set(aMorph.map(categorizeMorph).filter(Boolean))];
			if (aMorph.some((morph) => /:A\b/.test(morph)) && !alternatives.includes("adjectif")) alternatives.push("adjectif");
			result[word] = [category, ...alternatives.filter((candidate) => candidate !== category)].join("|");
		} catch (e) {
			result[word] = "";
		}
	}
	postMessage(createResponse("lexicalCategories", result, false));
}

function doParse(oParam) {
	if (!bInitDone) {
		postMessage(createResponse("parse", "Moteur non initialisé.", true));
		return;
	}
	const sText = String(oParam.sText || "").replace(/\u00AD/g, "").normalize("NFC");

	const lErrors = [];

	// Découpage par paragraphe : text.getParagraph() renvoie un itérable de
	// paragraphes avec leur position dans le texte complet (comme dans
	// gce_worker.js), pour pouvoir remapper nStart/nEnd sur le document entier.
	let nOffset = 0;
	for (const sParagraph of sText.split(/\n/)) {
		if (sParagraph.trim().length > 0) {
			// Erreurs grammaticales / typographiques
			// Array.from() est indispensable : sans bFullInfo, gc_engine.parse()
			// renvoie un itérateur (proche d'un générateur) sur sa Map interne
			// d'erreurs, pas un vrai tableau. Un itérateur ne peut pas être
			// cloné par postMessage ("[object Generator] could not be cloned"),
			// il faut donc le matérialiser ici, avant tout postMessage.
			const aGrammErr = Array.from(gc_engine.parse(sParagraph, "FR", false, null, false, false));
			for (const oErr of aGrammErr) {
				lErrors.push({
					nStart: oErr.nStart + nOffset,
					nEnd: oErr.nEnd + nOffset,
					sType: "grammaire",
					sRuleId: oErr.sRuleId,
					sMessage: oErr.sMessage,
					aSuggestions: oErr.aSuggestions || [],
				});
			}

			// Erreurs orthographiques (mots absents du dictionnaire)
			const aSpellErr = gc_engine.oSpellChecker.parseParagraph(sParagraph);
			for (const oToken of aSpellErr) {
				let aSuggestions = [];
				try {
					// suggest() est un GÉNÉRATEUR qui produit un tableau de
					// suggestions par dictionnaire actif (principal, communautaire,
					// personnel) — jamais un tableau directement. Il faut le
					// consommer avec for...of et fusionner les tableaux obtenus,
					// sinon on tente d'envoyer un générateur via postMessage, ce
					// qui est impossible (structured clone ne sait pas le faire).
					for (const aSugg of gc_engine.oSpellChecker.suggest(oToken.sValue)) {
						aSuggestions.push(...aSugg);
					}
				} catch (e) {
					// Pas bloquant : on garde l'erreur sans suggestion plutôt
					// que de faire planter toute l'analyse.
				}
				lErrors.push({
					nStart: oToken.nStart + nOffset,
					nEnd: oToken.nEnd + nOffset,
					sType: "orthographe",
					sRuleId: "spelling",
					sMessage: "Mot absent du dictionnaire : " + oToken.sValue,
					aSuggestions: aSuggestions,
					sValue: oToken.sValue,
				});
			}
		}
		// +1 pour le \n qui a servi de séparateur
		nOffset += sParagraph.length + 1;
	}

	postMessage(createResponse("parse", lErrors, false));
}
