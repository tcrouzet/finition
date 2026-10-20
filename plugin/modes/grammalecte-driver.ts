import type { GrammalecteError } from "./grammalecte";
import { decodeDictionary, isSharedDictionary, readPersonalForms, type Orthography, type SharedDictionary } from "../lexicon/shared";
import { adaptGrammalecte, type GraphspellDictionary } from "../lexicon/grammalecte-adapter";

interface NativeSpellChecker {
	oMainDic: GraphspellDictionary;
	activateStorage(): void;
	getTokenizer(): unknown;
	getMorph(word: string): string[];
	parseParagraph(text: string): Iterable<{ nStart: number; nEnd: number; sValue: string }>;
	suggest(word: string): Iterable<string[]>;
}
interface InitParameters {
	oDictionary: unknown; oGraphData: object;
	oOrthography?: Orthography; sPersonalData?: string;
	sConjData: string; sPhonetData: string; sMfspData: string; sThes1Data: string; sThes2Data: string;
}
type WorkerRequest = { id: string } & (
	{ sCommand: "init"; oParam: InitParameters } |
	{ sCommand: "parse"; oParam: { sText: string } } |
	{ sCommand: "dictionary"; oParam: { dictionary: Orthography } } |
	{ sCommand: "lexicalCategories"; oParam: { words: string[] } }
);

// Ces variables sont fournies par les scripts Grammalecte concaténés avant cet adaptateur.
declare const gc_rules_graph: object;
declare const conj: { init(data: string): void };
declare const phonet: { init(data: string): void };
declare const mfsp: { init(data: string): void };
declare const thesaurus: { init(first: string, second: string): void };
declare const SpellChecker: new (language: string, path: string, dictionary: unknown, community: string, personal: string) => NativeSpellChecker;
declare const gc_functions: { load(context: string, checker: NativeSpellChecker): void };
declare const gc_options: { load(context: string): void; getOptionsColors(context: string, format: string): unknown };
declare const gc_engine: {
	oSpellChecker: NativeSpellChecker; oTokenizer: unknown; oOptionsColors: unknown;
	parse(text: string, country: string, debug: boolean, options: null, context: boolean, full: boolean): Iterable<Pick<GrammalecteError, "nStart" | "nEnd" | "sRuleId" | "sMessage" | "aSuggestions">>;
};

let bInitDone = false;
let requestId = "";
let shared: SharedDictionary | undefined;
let personal: string[] = [];
const adapted = new Map<Orthography, GraphspellDictionary>();

function createResponse(sAction: string, result: unknown, bError: boolean) {
	return { id: requestId, sAction: sAction, result: result, bError: !!bError };
}

onmessage = function (e: MessageEvent<WorkerRequest>) {
	void dispatch(e);
};

async function dispatch(e: MessageEvent<WorkerRequest>) {
	const { sCommand, oParam } = e.data;
	requestId = e.data.id;
	try {
		switch (sCommand) {
			case "init":
				await doInit(oParam);
				break;
			case "parse":
				doParse(oParam);
				break;
			case "dictionary":
				if (!bInitDone || !shared) throw new Error("Dictionnaire commun non initialisé.");
				selectDictionary(oParam.dictionary);
				postMessage(createResponse("dictionary", true, false));
				break;
			case "lexicalCategories":
				doLexicalCategories(oParam);
				break;
			default:
				postMessage(createResponse(sCommand, "Commande inconnue: " + String(sCommand), true));
		}
	} catch (e) {
		postMessage(createResponse(sCommand, e instanceof Error ? e.message : String(e), true));
	}
}

async function doInit(oParam: InitParameters) {
	if (bInitDone) {
		postMessage(createResponse("init", true, false));
		return;
	}
	const { oDictionary, sConjData, sPhonetData, sMfspData, sThes1Data, sThes2Data } = oParam;
	const common = isSharedDictionary(oDictionary) ? await decodeDictionary(oDictionary, "grammalecte") : undefined;
	const variant = oParam.oOrthography ?? "fr-classic";
	if (common && !common.grammalecte) throw new Error("Le dictionnaire commun ne contient pas les index Grammalecte.");
	Object.assign(gc_rules_graph, oParam.oGraphData);

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
	if (common) {
		shared = common;
		personal = oParam.sPersonalData ? await readPersonalForms(async () => new TextEncoder().encode(oParam.sPersonalData).buffer) : [];
		selectDictionary(variant);
	} else {
		gc_engine.oSpellChecker = new SpellChecker("fr", "", oDictionary, "", "");
		activateChecker();
	}
	gc_options.load("JavaScript");
	gc_engine.oOptionsColors = gc_options.getOptionsColors("JavaScript", "aHSL");

	bInitDone = true;
	postMessage(createResponse("init", true, false));
}

function activateChecker() {
	gc_engine.oSpellChecker.activateStorage();
	gc_engine.oTokenizer = gc_engine.oSpellChecker.getTokenizer();
	gc_functions.load("JavaScript", gc_engine.oSpellChecker);
}

function selectDictionary(variant: Orthography) {
	if (!shared?.grammalecte || (variant !== "fr-classic" && variant !== "fr-reform")) throw new Error("Variante orthographique invalide.");
	const checker = new SpellChecker("fr", "", shared.grammalecte[variant], "", "");
	if (!adapted.has(variant)) adapted.set(variant, adaptGrammalecte(checker.oMainDic, shared, variant, personal));
	checker.oMainDic = adapted.get(variant)!;
	gc_engine.oSpellChecker = checker;
	activateChecker();
}

// Déduit une catégorie grammaticale lisible (en français, comme dans
// stats.py côté Python) à partir d'une chaîne de morphologie brute
// renvoyée par graphspell (ex. ":V3e:ind:impa:3s", ":N:f:s"...). On ne
// cherche que la présence d'un marqueur de catégorie connu, peu importe sa
// position exacte dans la chaîne — contrairement au lemme, la catégorie
// n'a pas besoin d'un découpage précis.
function categorizeMorph(sMorph: string): string {
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

function doLexicalCategories(oParam: { words: string[] }) {
	if (!bInitDone) {
		postMessage(createResponse("lexicalCategories", "Moteur non initialisé.", true));
		return;
	}
	const words = oParam.words || [];
	const result: Record<string, string> = {};
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
		} catch {
			result[word] = "";
		}
	}
	postMessage(createResponse("lexicalCategories", result, false));
}

function doParse(oParam: { sText: string }) {
	if (!bInitDone) {
		postMessage(createResponse("parse", "Moteur non initialisé.", true));
		return;
	}
	const sText = String(oParam.sText || "").replace(/\u00AD/g, "").normalize("NFC");

	const lErrors: GrammalecteError[] = [];

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
				let aSuggestions: string[] = [];
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
				} catch {
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
