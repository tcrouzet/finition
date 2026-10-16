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
				});
			}
		}
		// +1 pour le \n qui a servi de séparateur
		nOffset += sParagraph.length + 1;
	}

	postMessage(createResponse("parse", lErrors, false));
}
