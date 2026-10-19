/**
 * Encodage fonctionnel partagé par Structure, Cadence, Tricolons et Tic IA.
 * Les variantes lexicales de Grammalecte sont résolues en contexte avant
 * réduction en rôles ; les fonctions des compléments priment sur leur forme.
 */

import { splitRanges, trimRange } from "./clause-split";

// --- Constantes, copiées telles quelles depuis stats.py --------------------

// Équivalent de STRUCTURE_TOKEN_RE : mots (avec apostrophe interne
// éventuelle), points de suspension, ou ponctuation structurelle isolée.
const STRUCTURE_TOKEN_RE = /[\wÀ-ÖØ-öø-ÿŒœÆæ]+(?:[-'’][\wÀ-ÖØ-öø-ÿŒœÆæ]+)*|\.\.\.|[…,.!?;:—–()«»"-]/gu;

const STRUCTURE_PUNCTUATION = new Set([",", "."]);
const IGNORED_STRUCTURE_PUNCTUATION = new Set([
	"...", "…", "!", "?", ";", ":", "—", "–", "-", "(", ")", "«", "»", '"',
]);
const ELIDED_PREFIXES = new Set(["c", "d", "j", "l", "m", "n", "qu", "s", "t"]);
const ELIDED_CATEGORIES: Record<string, string> = {
	c: "pronom",
	d: "préposition",
	j: "pronom",
	l: "déterminant",
	m: "pronom",
	n: "adverbe",
	qu: "conjonction",
	s: "pronom",
	t: "pronom",
};
const SUBORDINATORS = new Set([
	"comme", "comment", "dont", "lorsque",
	"où", "parce", "pendant", "pourquoi", "puisque", "quand", "que", "qui",
	"quoique", "si", "tandis",
]);
const SUBJECT_PRONOUNS = new Set(["ça", "ce", "cela", "elle", "elles", "il", "ils", "je", "j", "nous", "on", "tu", "vous", "personne"]);
const OBJECT_PRONOUNS = new Set(["me", "m", "te", "t", "se", "s", "lui", "leur", "nous", "vous", "y"]);
const AMBIGUOUS_DETERMINERS = new Set(["un", "une", "des", "le", "la", "les", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs"]);
const NEGATIONS = new Set(["ne", "n", "pas", "plus", "jamais"]);
const AUXILIARIES = new Set(["avoir", "ai", "as", "a", "avons", "avez", "ont", "avais", "avait", "avions", "aviez", "avaient", "aurai", "aura", "auront", "aurais", "aurait", "auraient", "eu"]);
const COPULAR_FORMS = new Set([
	"être", "suis", "es", "est", "sommes", "êtes", "sont",
	"étais", "était", "étions", "étiez", "étaient",
	"fus", "fut", "fûmes", "fûtes", "furent",
	"serai", "seras", "sera", "serons", "serez", "seront",
	"serais", "serait", "serions", "seriez", "seraient",
	"sois", "soit", "soyons", "soyez", "soient",
	"fusse", "fusses", "fût", "fussions", "fussiez", "fussent",
]);
const COMMA_RE = /,/g;
const COLON_RE = /(?<!\d):|:(?!\d)/g;
const COORDINATION_RE = /\b(?:et|ou|ni)\b/gi;

/** Catégories lexicales en minuscules, séparées par "|" si ambiguës, ou "" si inconnues. */
export type GetCategory = (word: string) => string;

function structureTokens(sentence: string): string[] {
	const tokens: string[] = [];
	const lowered = sentence.toLowerCase().replace(/’/g, "'");
	const matches = lowered.match(STRUCTURE_TOKEN_RE) ?? [];
	for (const rawToken of matches) {
		if (rawToken.includes("'")) {
			const idx = rawToken.indexOf("'");
			const prefix = rawToken.slice(0, idx);
			const rest = rawToken.slice(idx + 1);
			if (ELIDED_PREFIXES.has(prefix) && rest) {
				tokens.push(prefix, rest);
				continue;
			}
		}
		tokens.push(rawToken);
	}
	return tokens;
}

export function structureCategoryWords(text: string): string[] {
	return [...new Set(structureTokens(text).filter(
		(word) => !STRUCTURE_PUNCTUATION.has(word) && !IGNORED_STRUCTURE_PUNCTUATION.has(word)
	))];
}

// Prépositions en tête des groupes détachés et des cadratifs. Leur présence
// ne suffit pas à fusionner un groupe avec le précédent : les continuations
// d'un complément nominal sont traitées dans mergeNominalContinuationRanges().
// NOTE : "pour" est volontairement ABSENT — c'est aussi un subordonnant de
// but quand il précède un infinitif ("pour mourir dignement", voir
// `pourInfinitive` dans categorizeStructureWords()) : un groupe qui COMMENCE
// par "pour + infinitif" est une proposition de but à part entière, pas la
// continuation du complément précédent (ex. dans "..., ou courir droit vers
// une balle, pour en finir une fois pour toutes.", le second groupe ne doit
// PAS fusionner avec le premier).
const BARE_PREPOSITIONS = new Set([
	"à", "de", "du", "au", "aux", "en", "dans", "sur", "sous",
	"avec", "chez", "vers", "par", "entre", "sans", "selon", "malgré", "depuis", "devant", "derrière", "après", "avant", "pendant", "durant", "autour",
]);

/**
 * true si `text` (un groupe délimité par virgule) commence directement par
 * une préposition nue (voir BARE_PREPOSITIONS).
 */
export function startsWithBarePreposition(text: string, getCategory: GetCategory): boolean {
	const tokens = structureTokens(text).filter(
		(word) => !STRUCTURE_PUNCTUATION.has(word) && !IGNORED_STRUCTURE_PUNCTUATION.has(word)
	);
	if (tokens.length === 0) return false;
	const word = ["et", "mais", "puis"].includes(tokens[0]) ? tokens[1] : tokens[0];
	if (!word || AMBIGUOUS_DETERMINERS.has(word)) return false;
	if (isSubordinator(word, tokens[tokens.indexOf(word) + 1])) return false;
	if (word === "pour") return false; // voir le commentaire de BARE_PREPOSITIONS
	if (BARE_PREPOSITIONS.has(word)) return true;
	const category = ELIDED_CATEGORIES[word] ?? getCategory(word).toLowerCase();
	return category.split("|")[0] === "préposition";
}

function isSubordinator(word: string, next: string | undefined): boolean {
	if (["alors", "bien", "ainsi", "tandis", "afin"].includes(word)) return next === "que";
	if (word === "pendant") return next === "que";
	return SUBORDINATORS.has(word);
}

function wordCategory(word: string, next: string | undefined, getCategory: GetCategory): string {
	if (!word) return "";
	if (SUBJECT_PRONOUNS.has(word)) return "pronom";
	if (AMBIGUOUS_DETERMINERS.has(word)) return "déterminant";
	if (COPULAR_FORMS.has(word) || AUXILIARIES.has(word)) return "verbe";
	if (isSubordinator(word, next)) return "subordination";
	if (["alors", "bien", "ainsi", "peut-être", "puis", "même"].includes(word)) return "adverbe";
	return ELIDED_CATEGORIES[word] ?? getCategory(word).toLowerCase().split("|")[0] ?? "";
}

function syntacticClause(tokens: string[]): string[] {
	if (tokens.length === 0) return [];

	// Repère la PREMIÈRE charnière (subordonnant) du groupe, où qu'elle se
	// trouve — avant OU après le verbe principal. Ex. "j'ai ri COMME un
	// idiot" (charnière après le verbe) mais aussi "tordu COMME un arbre qui
	// a grandi..." (charnière AVANT tout verbe, juste après un simple
	// adjectif/participe sans sujet ni verbe propre). Un ancien algorithme
	// ne cherchait une charnière que dans la QUEUE après le premier verbe
	// trouvé (ou, cas particulier, tout en tête du groupe) : dans le second
	// exemple, ni l'un ni l'autre cas ne s'appliquait, et tout le préfixe
	// "tordu comme un arbre qui" était avalé en bloc dans un unique "SUJET"
	// erroné, qui engloutissait à la fois l'adjectif et la charnière.
	//
	// On scinde donc en PRÉFIXE (tout ce qui précède la charnière, traité
	// récursivement pour lui-même : "COMPLÉMENT" s'il n'a pas de verbe,
	// "SUJET VERBE..." sinon) + CHARNIÈRE + SUFFIXE (traité récursivement).
	// Cette unique règle couvre à la fois l'ancien cas "tokens[0] ===
	// SUBORDINATION" (préfixe vide) et l'ancien cas "charnière après le
	// verbe" (préfixe = SUJET + VERBE).
	const subordinationIndex = tokens.indexOf("SUBORDINATION");
	if (subordinationIndex !== -1) {
		const prefix = tokens.slice(0, subordinationIndex);
		const suffix = tokens.slice(subordinationIndex + 1);
		return [...syntacticClause(prefix), "CHARNIÈRE", ...syntacticClause(suffix)];
	}

	let rest = tokens;
	// Une coordination placée après une virgule relie deux propositions
	// principales, mais ne fait pas partie de leur structure interne.
	if (rest[0] === "CONJONCTION") {
		rest = rest.slice(1);
		if (rest.length === 0) return [];
	}
	const verbIndex = rest.findIndex((token) => token === "VERBE" || token === "COPULE");
	if (verbIndex === -1) {
		const nounIndex = rest.indexOf("NOM");
		if (nounIndex !== -1) return nounIndex < rest.length - 1 ? ["NOM", "COMPLÉMENT"] : ["NOM"];
		return rest.length === 1 && rest[0] === "INCONNU" ? ["INCONNU"] : ["COMPLÉMENT"];
	}
	const result: string[] = [];
	const prefix = rest.slice(0, verbIndex);
	if (prefix.some((token) => ["SUJET", "NOM", "PRONOM"].includes(token))) result.push("SUJET");
	result.push("VERBE");
	const tail = rest.slice(verbIndex + 1);
	if (tail.length > 0 || prefix.includes("OBJET")) {
		result.push("COMPLÉMENT");
	}
	return result;
}

/**
 * Catégorise une suite de "mots structurels" (voir structureTokens()) selon
 * les mêmes règles que le port Python `sentence_structure_signatures()` :
 * ponctuation structurelle laissée telle quelle (pour que l'appelant puisse
 * ensuite la faire éclater en clauses via syntacticClause()), ponctuation
 * ignorée écartée, mots catégorisés et normalisés en majuscules
 * (SUBORDINATION, NOM, VERBE, ADJECTIF, PRONOM...), déterminants et
 * prépositions écartés, et quelques fusions contextuelles (pronom sujet +
 * forme ambiguë, élisions...).
 *
 * Partagée par sentenceStructureSignatures() (signature d'une PHRASE
 * entière, où `words` provient directement de structureTokens() et peut
 * donc contenir de la ponctuation structurelle) et clauseRoleSignature()
 * (signature d'un simple GROUPE, où `words` est déjà filtré de toute
 * ponctuation par l'appelant).
 */
function categorizeStructureWords(words: string[], getCategory: GetCategory): string[] {
	const tokens: string[] = [];
	let previousCategory = "";
	let previousWordCategory = "";
	let subjectPronoun = "";
	for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
		const word = words[wordIndex];
		if (NEGATIONS.has(word)) continue;
		if (IGNORED_STRUCTURE_PUNCTUATION.has(word)) continue;
		if (STRUCTURE_PUNCTUATION.has(word)) {
			tokens.push(word);
			previousCategory = "";
			continue;
		}

		const followingCategories = words
			.slice(wordIndex + 1)
			.filter((candidate) => !STRUCTURE_PUNCTUATION.has(candidate) && !IGNORED_STRUCTURE_PUNCTUATION.has(candidate))
			.map((candidate) => getCategory(candidate).toLowerCase());
		const pourInfinitive = word === "pour" && followingCategories.some((c) => c.startsWith("verbe"));

		let category = pourInfinitive ? "subordination" : wordCategory(word, words[wordIndex + 1], getCategory) || "inconnu";
		const alternatives = getCategory(word).toLowerCase().split("|");
		if (!["participe", "adjectif"].includes(category) && alternatives.includes("verbe") && !["déterminant", "préposition"].includes(previousWordCategory) && ["nom", "pronom"].includes(previousCategory)) category = "verbe";
		if (word === "tout" && getCategory(words[wordIndex + 1] ?? "").split("|").includes("adjectif")) category = "adverbe";
		if (previousWordCategory === "déterminant" && alternatives.includes("nom") && !AUXILIARIES.has(word) && !COPULAR_FORMS.has(word)) category = "nom";
		if (category === "adverbe" && (previousCategory === "verbe" || previousCategory === "copule") && followingCategories.some((candidate) => candidate.startsWith("participe"))) continue;
		if (category === "adverbe" && tokens.length === 0) continue;

		// Un participe ("né", "élevé", "fini", "ri"...) est ambigu hors
		// contexte (voir categorizeMorph() dans grammalecte-driver.ts) : juste après un
		// verbe (l'auxiliaire avoir/être qui précède), il complète un temps
		// composé et doit être fusionné avec ce verbe ("j'ai ri" = UN seul
		// VERBE, pas VERBE+COMPLÉMENT) ; sinon, employé seul, il fonctionne
		// comme un adjectif/complément ("né à Paris", "un imbécile fini").
		if (category === "participe") {
			if (previousCategory === "verbe" || previousCategory === "copule") category = "verbe";
			else category = previousWordCategory === "déterminant" || (previousWordCategory === "préposition" && alternatives.includes("nom")) ? "nom" : "adjectif";
		}
		else if (category.startsWith("nom")) category = "nom";
		else if (category.startsWith("adjectif")) category = "adjectif";
		else if (category.startsWith("verbe")) category = COPULAR_FORMS.has(word) ? "copule" : "verbe";

		if (category === "déterminant" || category === "préposition") {
			previousWordCategory = category;
			continue;
		}

		// Une forme ambiguë (ex. « rigole ») après un pronom sujet est
		// verbale, pas nominale.
		if (category === "nom" && previousWordCategory === "adverbe") {
			category = "adjectif";
		} else if (category === "nom" && previousCategory === "pronom") {
			category = COPULAR_FORMS.has(word) ? "copule" : "verbe";
		}
		// « il se », « je me » : même sujet verbal que « il », « je ».
		const reflexive = category === "pronom" && (["se", "s"].includes(word) ||
			(["me", "m"].includes(word) && ["je", "j"].includes(subjectPronoun)) ||
			(["te", "t"].includes(word) && subjectPronoun === "tu") ||
			(["nous", "vous"].includes(word) && subjectPronoun === word));
		if (category === "pronom" && previousCategory === "pronom") {
			if (!reflexive && OBJECT_PRONOUNS.has(word)) tokens.push("OBJET");
			continue;
		}
		if (category === "verbe" && (previousCategory === "verbe" || previousCategory === "copule")) {
			previousWordCategory = category;
			continue;
		}
		// Les subordonnants composés de deux mots du dictionnaire ("pendant
		// QUE", "parce QUE", "alors QUE"...) ne doivent produire qu'UNE
		// seule charnière, pas deux à la suite.
		if (category === "subordination" && previousCategory === "subordination") continue;

		if (category === "pronom" && SUBJECT_PRONOUNS.has(word)) subjectPronoun = word;
		tokens.push(category !== "pronom" ? category.toUpperCase() : reflexive ? "RÉFLÉCHI" : SUBJECT_PRONOUNS.has(word) ? "SUJET" : OBJECT_PRONOUNS.has(word) ? "OBJET" : "PRONOM");
		previousCategory = category;
		previousWordCategory = category;
	}
	return tokens;
}

/**
 * Encode une phrase en la suite de rôles + ponctuation structurelle qui la
 * compose (ex. ["SUJET","VERBE","COMPLÉMENT",",","CHARNIÈRE","COMPLÉMENT","."]),
 * AVANT jointure en chaîne — exporté pour le mode "Structure" (commande de
 * débogage visuel, voir modes/structure-report.ts) qui a besoin du tableau
 * pour colorer chaque rôle séparément, contrairement à
 * sentenceStructureSignatures() qui ne garde que la chaîne jointe (utilisée
 * pour la comparaison d'égalité par le mode Cadence).
 */
export function sentenceStructureTokens(sentence: string, getCategory: GetCategory): string[] {
	const analyses = analyzeSentenceStructure(sentence, 0, sentence.length, getCategory);
	return analyses.flatMap(({ displayTokens }, index) =>
		index === 0 || displayTokens[0] === ":" || analyses[index - 1].displayTokens[0] === ":" ? displayTokens : [",", ...displayTokens]
	);
}

/**
 * Encode chaque phrase fournie en un patron syntaxique comparable
 * (ex. "SUJET VERBE COMPLÉMENT , COMPLÉMENT"), identique à la lecture
 * fonctionnelle de Structure. Utilisé par le mode Cadence.
 */
export function sentenceStructureSignatures(sentences: string[], getCategory: GetCategory): string[] {
	const signatures: string[] = [];
	for (const sentence of sentences) {
		const tokens = sentenceStructureTokens(sentence, getCategory);
		if (tokens.length > 0) {
			signatures.push(tokens.join(" "));
		}
	}
	return signatures;
}

/**
 * Clé de "parallélisme" minimale d'un simple groupe de mots (pas une phrase
 * entière), utilisée par tricolonMembership() pour décider si deux groupes
 * d'énumération jouent le même rôle. Voir analyzeClause() plus bas pour le
 * calcul complet (c'est elle qui produit réellement ces valeurs).
 */
export interface ClauseParallelKey {
	key: string;
	/** Une nouvelle introduction grammaticale ouvre une autre énumération. */
	startsEnumeration?: boolean;
	/**
	 * "none" : `key` = le code COMPLET du groupe, sans réduction (pas de
	 * charnière, ou charnière en tête du groupe).
	 * "after" : `key` a été réduite à la partie qui SUIT la charnière ("j'ai
	 * ri COMME un idiot" → clé = "COMPLÉMENT" pour "un idiot") : le
	 * préfixe, qui contient son propre SUJET+VERBE, est une introduction
	 * commune à exclure.
	 * "before" : `key` a été réduite à la partie qui PRÉCÈDE la charnière
	 * ("tordu COMME un arbre qui a grandi..." → clé = "COMPLÉMENT" pour
	 * "tordu") : le suffixe, qui a SON PROPRE sujet+verbe, est une
	 * élaboration/subordonnée accrochée à cet élément précis, pas une
	 * structure à comparer aux groupes voisins.
	 */
	reduction: "none" | "after" | "before";
}

/**
 * Résultat complet de l'analyse d'UN groupe (délimité par virgule) : à la
 * fois ce qu'il faut AFFICHER (modes/structure-report.ts), la clé de
 * comparaison pour le mode Tricolon (modes/ternary.ts, via
 * tricolonMembership()), et la plage de texte à surligner dans l'éditeur.
 * Fonction PARTAGÉE entre les deux : ils doivent impérativement s'accorder
 * sur le MÊME calcul, sans quoi Structure et Tricolons finissent par se
 * contredire — ce qui s'est déjà produit avant cette factorisation.
 *
 * PAS de cas particuliers : deux règles générales, appliquées chacune
 * uniformément, quel que soit le contexte précis.
 *
 * Règle d’AFFICHAGE : une charnière qui introduit une subordonnée garde son
 * mot réel ("comme", "pendant", "où"...). Un simple complément postverbal
 * est condensé en "COMPLÉMENT", sans détailler sa forme interne. Et dès que
 * ce qui suit contient un verbe conjugué, c'est une vraie subordonnée,
 * condensée en un unique mot "SUBORDONNÉE".
 *
 * Règle de CLÉ DE COMPARAISON (pour le mode Tricolon) : une introduction
 * SUJET+VERBE n'est retirée que si les deux groupes suivants confirment une
 * ellipse parallèle. Une action autonome garde donc sa structure complète.
 * Toute élaboration subordonnée accrochée après une charnière est retirée dès
 *      qu'elle a son propre verbe conjugué ("tordu COMME un arbre QUI A
 *      GRANDI...", "un théâtre absurde OÙ LES RÔLES CHANGEAIENT...") —
 *      peu importe sa structure interne, elle ne fait que préciser
 *      l'élément qui la précède, elle n'est pas lui.
 * Ce qui reste au milieu — typiquement un simple COMPLÉMENT — est la clé.
 * S'il ne reste RIEN (la charnière est tout de suite en tête, "PENDANT QUE
 * la voisine lançait..." : pas de tête à comparer), la clé devient le
 * marqueur "{mot} SUBORDONNÉE" lui-même : deux subordonnées sont alors
 * comparées par leur mot de charnière ("pendant" ≠ "comme"), plus du tout
 * par leur structure interne.
 */
export interface ClauseAnalysis extends ClauseParallelKey {
	/** Tokens à afficher pour ce groupe (modes/structure-report.ts), dans
	 * l'ordre : rôles en MAJUSCULES et mots de charnière réels en
	 * minuscules ("comme", "pendant"...), "subordonnée" pour toute suite de
	 * charnière contenant un verbe conjugué. */
	displayTokens: string[];
	/** Décalages (relatifs au DÉBUT du texte du groupe) délimitant la
	 * partie à surligner dans l'éditeur pour ce tricolon (modes/ternary.ts) —
	 * [0, longueur totale] si `reduction === "none"` et pas de subordonnée
	 * en tête (tout le groupe compte), sinon restreint à la partie
	 * réellement comparable (charnière incluse quand elle fait partie du
	 * motif répété — cas "subordonnée" —, exclue sinon). */
	highlightFrom: number;
	highlightTo: number;
}

export function alignNominalEnumeration(analyses: ClauseAnalysis[], leadingCadratifCount = 0, prepositionalGroups: boolean[] = []): ClauseAnalysis[] {
	const aligned = analyses.map((analysis) => ({ ...analysis, displayTokens: [...analysis.displayTokens] }));
	for (let index = 0; index < Math.min(leadingCadratifCount, aligned.length - 1); index++) {
		aligned[index].displayTokens = ["CADRATIF"];
		aligned[index].key = "CADRATIF";
		aligned[index].reduction = "none";
		aligned[index].highlightFrom = 0;
	}
	let followsPredicate = aligned[0]?.displayTokens.includes("VERBE") ?? false;
	for (let index = 1; index < aligned.length; index++) {
		const analysis = aligned[index];
		if (!analysis.key) continue;
		if (analysis.displayTokens.includes("VERBE")) {
			followsPredicate = true;
			continue;
		}
		if ((followsPredicate && analysis.displayTokens.length > 0 && !analysis.displayTokens.includes("SUBORDONNÉE")) ||
			(analysis.displayTokens[0] === "NOM" && aligned[index - 1].displayTokens[0] !== "CADRATIF" && (analysis.displayTokens.length > 1 || aligned[0].displayTokens.join(" ") === "NOM COMPLÉMENT"))) {
			analysis.displayTokens = ["COMPLÉMENT"];
			analysis.key = "COMPLÉMENT";
			analysis.highlightFrom = 0;
		}
	}
	for (let index = 0; index + 2 < aligned.length; index++) {
		const anchor = aligned[index];
		if (anchor.displayTokens.join(" ") !== "SUJET VERBE COMPLÉMENT") continue;
		let end = index + 1;
		while (end < aligned.length && !(end === index + 1 && prepositionalGroups[end]) && ["NOM", "COMPLÉMENT"].includes(aligned[end].displayTokens[0])) end++;
		if (end - index < 3) continue;
		anchor.key = "COMPLÉMENT";
		for (const analysis of aligned.slice(index + 1, end)) {
			analysis.displayTokens = ["COMPLÉMENT"];
			analysis.key = "COMPLÉMENT";
			analysis.highlightFrom = 0;
		}
	}
	for (let index = 0; index + 2 < aligned.length; index++) {
		const nominalRun = aligned.slice(index, index + 3);
		const followingRun = aligned.slice(index + 1, index + 4);
		if (
			nominalRun[0].displayTokens[0] === "SUJET" &&
			nominalRun[0].displayTokens[1] === "VERBE" &&
			followingRun.length === 3 &&
			followingRun[0].key !== "" &&
			followingRun.every((analysis) => analysis.key === followingRun[0].key)
		) continue;
		if (nominalRun[0].key !== "" && nominalRun.every((analysis) => analysis.key === nominalRun[0].key)) {
			index += 2;
			continue;
		}
		if (
			nominalRun[0].displayTokens[0] === "NOM" &&
			nominalRun.every(
				(analysis) => analysis.displayTokens.length === 1 && ["NOM", "COMPLÉMENT"].includes(analysis.displayTokens[0])
			)
		) {
			for (const analysis of nominalRun) {
				analysis.displayTokens = ["NOM"];
				analysis.key = "NOM";
			}
			index += 2;
			continue;
		}
		if (nominalRun.every((analysis) => analysis.displayTokens[0] === "NOM")) {
			for (const analysis of nominalRun) analysis.key = "NOM";
			index += 2;
			continue;
		}
		const [anchor, ...followers] = nominalRun;
		if (
			anchor.displayTokens[0] === "SUJET" &&
			anchor.displayTokens[1] === "VERBE" &&
			anchor.displayTokens[anchor.displayTokens.length - 1] === "COMPLÉMENT" &&
			followers.every((analysis) => ["NOM", "COMPLÉMENT"].includes(analysis.displayTokens[0]))
		) {
			for (const analysis of nominalRun) analysis.key = "COMPLÉMENT";
			if (anchor.displayTokens.length === 3) {
				for (const analysis of followers) analysis.displayTokens = ["COMPLÉMENT"];
			}
			index += 2;
			continue;
		}
		if (anchor.displayTokens.join(" ") !== "NOM COMPLÉMENT" || anchor.key !== "COMPLÉMENT") continue;
		const nominalFollowers = aligned.slice(index + 1, index + 3);
		if (!nominalFollowers.every((analysis) => analysis.displayTokens.length === 1 && ["NOM", "COMPLÉMENT"].includes(analysis.key))) continue;
		for (const analysis of nominalFollowers) {
			if (analysis.key === "NOM") {
				analysis.displayTokens = ["COMPLÉMENT"];
				analysis.key = "COMPLÉMENT";
			}
		}
		index += 2;
	}
	for (let index = 0; index < aligned.length; index++) {
		const analysis = aligned[index];
		const verbalIntroduction = analysis.displayTokens[0] === "SUJET" && analysis.displayTokens[1] === "VERBE";
		const newPrepositionalList = prepositionalGroups[index] && aligned[index - 1]?.displayTokens[0] === "SUJET";
		analysis.startsEnumeration = analysis.key === "COMPLÉMENT" && (verbalIntroduction || newPrepositionalList);
	}
	return aligned;
}

function mergeNominalContinuationRanges(
	text: string,
	ranges: Array<[number, number]>,
	getCategory: GetCategory
): Array<[number, number]> {
	const merged: Array<[number, number]> = [];
	for (const [from, to] of ranges) {
		const firstWord = structureTokens(text.slice(from, to))[0];
		const previous = merged.at(-1);
		const previousText = previous ? text.slice(...previous) : "";
		const continuesNominalHead = previous && ["de", "du", "d"].includes(firstWord) &&
			!startsWithBarePreposition(previousText, getCategory) &&
			!analyzeClause(previousText, getCategory).displayTokens.includes("VERBE");
		if (continuesNominalHead) {
			merged[merged.length - 1] = [merged[merged.length - 1][0], to];
		} else {
			merged.push([from, to]);
		}
	}
	return merged;
}

export function leadingCadratifCount(
	text: string,
	ranges: Array<[number, number]>,
	getCategory: GetCategory
): number {
	if (!ranges.length) return 0;
	const first = analyzeClause(text.slice(...ranges[0]), getCategory);
	const nominalFrame = first.displayTokens.join(" ") === "NOM COMPLÉMENT" && ranges.slice(1).some((range) =>
		analyzeClause(text.slice(...range), getCategory).displayTokens.slice(0, 2).join(" ") === "SUJET VERBE");
	if (!nominalFrame && !isCadratif(text.slice(...ranges[0]), getCategory)) return 0;
	let count = 0;
	while (
		count < ranges.length - 1 &&
		!analyzeClause(text.slice(...ranges[count]), getCategory).displayTokens.includes("VERBE")
	) count++;
	return count;
}

function isCadratif(text: string, getCategory: GetCategory): boolean {
	if (startsWithBarePreposition(text, getCategory)) return true;
	if (analyzeClause(text, getCategory).displayTokens.includes("VERBE")) return false;
	const words = structureTokens(text);
	if (wordCategory(words[0], words[1], getCategory) === "préposition") return true;
	if (words.length > 0 && words.every((word, index) => NEGATIONS.has(word) || ["déterminant", "adverbe"].includes(wordCategory(word, words[index + 1], getCategory)))) return true;
	const normalized = text.toLowerCase().replace(/’/g, "'").replace(/^[\s«»—–-]+/, "").replace(/^(?:et|mais|puis)\s+/, "");
	return /^(?:(?:ce|le|un|une|les|chaque|quelques|deux|trois)\s+(?:\w+\s+)?(?:matin|soir|jour|nuit|semaine|heure|mois|dimanche|lundi|mardi)|le lendemain|plus tard|aujourd'hui|hier|demain|ici|là(?:-bas)?|parfois|d'abord)(?:\s|[,.!?-]|$)/u.test(normalized);
}

function hasPrepositionalPredicateComplement(text: string, getCategory: GetCategory): boolean {
	const words = structureTokens(text);
	let predicate = false;
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		const category = wordCategory(word, words[index + 1], getCategory);
		if (category === "verbe") {
			predicate = true;
			continue;
		}
		if (!predicate || category === "participe" || category === "pronom" || NEGATIONS.has(word)) continue;
		if (category === "adverbe" && getCategory(words[index + 1] ?? "").startsWith("participe")) continue;
		return startsWithBarePreposition(words.slice(index).join(" "), getCategory);
	}
	return false;
}

export function analyzeSentenceStructure(text: string, start: number, end: number, getCategory: GetCategory): ClauseAnalysis[] {
	const sections = splitRanges(text, start, end, COLON_RE);
	if (sections.length > 1) {
		return sections.flatMap(([from, to]) => {
			const analyses = analyzeSentenceStructure(text, from, to, getCategory);
			if (to < end) analyses.push({ displayTokens: [":"], key: "", reduction: "none", highlightFrom: 0, highlightTo: 1 });
			return analyses;
		});
	}
	const ranges = structureGroupRanges(text, start, end, getCategory);
	const analyses = ranges.map(([from, to]) => analyzeClause(text.slice(from, to), getCategory));
	for (let index = 0; index + 1 < analyses.length; index++) {
		const anchor = analyzeClause(text.slice(...ranges[index]), getCategory, true);
		const verb = anchor.displayTokens.indexOf("VERBE");
		if (verb < 0 || !anchor.displayTokens.slice(0, verb).includes("SUJET")) continue;
		const key = anchor.displayTokens.slice(verb).join(" ");
		let end = index + 1;
		while (end < analyses.length && analyses[end].displayTokens.join(" ") === key) end++;
		if (end === index + 1) continue;
		analyses[index] = { ...anchor, key };
		index = end - 1;
	}
	const firstCategories = ranges.map(([from, to]) => getCategory(structureTokens(text.slice(from, to))[0] ?? "").split("|"));
	const aligned = alignNominalEnumeration(
		analyses,
		leadingCadratifCount(text, ranges, getCategory),
		ranges.map(([from, to], index) => (startsWithBarePreposition(text.slice(from, to), getCategory) || SUBORDINATORS.has(structureTokens(text.slice(from, to))[0])) && !firstCategories[index].includes("déterminant") &&
			!(index > 0 && hasPrepositionalPredicateComplement(text.slice(...ranges[index - 1]), getCategory)))
	);
	const nominalGroups = analyses.map((analysis, index) => analysis.displayTokens[0] === "NOM" &&
		(firstCategories[index].includes("déterminant") || (firstCategories[index].includes("nom") && !firstCategories[index].some((category) => ["adjectif", "participe", "pronom"].includes(category)))));
	for (let index = 0; index < aligned.length; index++) {
		if (!nominalGroups[index]) continue;
		let end = index + 1;
		while (end < aligned.length && nominalGroups[end]) end++;
		// Les qualificatifs internes ne doivent pas tronçonner une longue liste de noms.
		if (end - index > 3) for (let item = index; item < end; item++) aligned[item].key = "NOM";
		index = end - 1;
	}
	const statements = aligned.filter((analysis) => analysis.displayTokens[0] !== "CADRATIF");
	if (statements.length === 1 && statements[0].displayTokens.join(" ") === "NOM COMPLÉMENT") {
		statements[0].displayTokens = ["NOM"];
		statements[0].key = "NOM";
	}
	for (let index = 0; index < aligned.length; index++) {
		const words = structureTokens(text.slice(...ranges[index]));
		if (wordCategory(words[0], words[1], getCategory) === "conjonction" && aligned[index].displayTokens[0] !== words[0]) {
			aligned[index].displayTokens.unshift(words[0]);
		}
	}
	return aligned;
}

function enumerationRole(text: string, getCategory: GetCategory): string {
	const words = structureTokensWithOffsets(text).filter(({ word }) => !STRUCTURE_PUNCTUATION.has(word));
	const adjectives = words.length > 0 && words.every(({ word }) => getCategory(word).split("|").some((category) => ["adjectif", "participe", "adverbe"].includes(category)));
	if (adjectives) return "COMPLÉMENT";
	const { displayTokens } = analyzeClause(text, getCategory, true);
	const predicate = displayTokens.findIndex((token) => token === "SUJET" || token === "VERBE");
	return displayTokens.includes("VERBE") ? displayTokens.slice(predicate).join(" ") : displayTokens[0] ?? "";
}

function coordinatedItems(text: string, range: [number, number], role: string, getCategory: GetCategory): Array<[number, number]> {
	const [from, to] = range;
	const coordinations = [...text.slice(from, to).matchAll(COORDINATION_RE)];
	for (const match of coordinations.reverse()) {
		const before = trimRange(text, from, from + match.index);
		const after = trimRange(text, from + match.index + match[0].length, to);
		const comparable = (candidate: string) => role.includes("VERBE") ? candidate.replace(/^SUJET /, "") : candidate;
		if (comparable(enumerationRole(text.slice(...before), getCategory)) === comparable(role) && comparable(enumerationRole(text.slice(...after), getCategory)) === comparable(role)) {
			return [...coordinatedItems(text, before, role, getCategory), role.includes("VERBE") ? trimRange(text, from + match.index, to) : after];
		}
	}
	return [range];
}

/** Découpe les groupes et les coordinations qui prolongent une énumération parallèle. */
export function structureGroupRanges(
	text: string,
	start: number,
	end: number,
	getCategory: GetCategory
): Array<[number, number]> {
	const sections = splitRanges(text, start, end, COLON_RE);
	if (sections.length > 1) {
		return sections.flatMap(([from, to]) => {
			const ranges = structureGroupRanges(text, from, to, getCategory);
			if (to < end) ranges.push([to, to + 1]);
			return ranges;
		});
	}
	const commaRanges = splitRanges(text, start, end, COMMA_RE)
		.map(([from, to]) => trimRange(text, from, to))
		.filter(([from, to]) => to > from);
	let ranges: Array<[number, number]> = [];
	for (const range of commaRanges) ranges = splitCoordinatedEnumeration(text, [...ranges, range], getCategory);
	return mergeNominalContinuationRanges(text, ranges, getCategory);
}

function splitCoordinatedEnumeration(text: string, commaRanges: Array<[number, number]>, getCategory: GetCategory): Array<[number, number]> {
	if (commaRanges.length < 2) return commaRanges;

	const [lastFrom, lastTo] = commaRanges[commaRanges.length - 1];
	let coordination: RegExpExecArray | null = null;
	COORDINATION_RE.lastIndex = 0;
	for (const match of text.slice(lastFrom, lastTo).matchAll(COORDINATION_RE)) coordination = match;
	if (!coordination || coordination.index === undefined) {
		return commaRanges;
	}

	const beforeCoordination = trimRange(text, lastFrom, lastFrom + coordination.index);
	const afterCoordination = trimRange(text, lastFrom + coordination.index + coordination[0].length, lastTo);
	if (beforeCoordination[0] >= beforeCoordination[1] || afterCoordination[0] >= afterCoordination[1]) {
		return commaRanges;
	}

	const firstItemRange = commaRanges[commaRanges.length - 2];
	const firstItemText = text.slice(firstItemRange[0], firstItemRange[1]);
	const role = enumerationRole(firstItemText, getCategory);
	if (role.includes("VERBE") && [beforeCoordination, afterCoordination].every((range) => enumerationRole(text.slice(...range), getCategory).replace(/^SUJET /, "") === role.replace(/^SUJET /, ""))) {
		return [...commaRanges.slice(0, -1), ...coordinatedItems(text, [lastFrom, lastTo], role, getCategory)];
	}
	const verbs = structureTokensWithOffsets(firstItemText)
		.filter(({ word }) => getCategory(word).toLowerCase().startsWith("verbe"));
	const lastVerb = verbs[verbs.length - 1];
	let firstItem: [number, number];
	let prefix: [number, number] | null = null;
	if (startsWithBarePreposition(firstItemText, getCategory)) {
		firstItem = firstItemRange;
	} else if (lastVerb) {
		firstItem = trimRange(text, firstItemRange[0] + lastVerb.end, firstItemRange[1]);
		prefix = trimRange(text, firstItemRange[0], firstItem[0]);
	} else {
		firstItem = firstItemRange;
	}
	const items: Array<[number, number]> = [firstItem, beforeCoordination, afterCoordination];
	const itemAnalyses = items.map(([from, to]) => analyzeClause(text.slice(from, to), getCategory));
	const itemRoles = items.map(([from, to]) => enumerationRole(text.slice(from, to), getCategory));
	const sharedNominalHead = itemAnalyses[0].displayTokens.join(" ") === "NOM COMPLÉMENT" && itemRoles[1] === "COMPLÉMENT" && itemRoles[2] === "COMPLÉMENT";
	if (firstItem[0] >= firstItem[1] || !["NOM", "COMPLÉMENT"].includes(itemRoles[0]) || (!sharedNominalHead && !itemRoles.every((role) => role === itemRoles[0]))) {
		return commaRanges;
	}

	const leading = commaRanges.slice(0, -2);
	if (prefix && prefix[0] < prefix[1]) {
		if (analyzeClause(firstItemText, getCategory).displayTokens.join(" ") === "SUJET VERBE COMPLÉMENT") firstItem = firstItemRange;
		else leading.push(prefix);
	}
	return [...leading, firstItem, ...coordinatedItems(text, [lastFrom, lastTo], itemRoles[1], getCategory)];
}

function structureTokensWithOffsets(sentence: string): Array<{ word: string; start: number; end: number }> {
	const tokens: Array<{ word: string; start: number; end: number }> = [];
	const lowered = sentence.toLowerCase().replace(/’/g, "'");
	for (const match of lowered.matchAll(STRUCTURE_TOKEN_RE)) {
		const rawToken = match[0];
		const start = match.index ?? 0;
		if (rawToken.includes("'")) {
			const idx = rawToken.indexOf("'");
			const prefix = rawToken.slice(0, idx);
			const rest = rawToken.slice(idx + 1);
			if (ELIDED_PREFIXES.has(prefix) && rest) {
				tokens.push({ word: prefix, start, end: start + idx });
				tokens.push({ word: rest, start: start + idx + 1, end: start + rawToken.length });
				continue;
			}
		}
		tokens.push({ word: rawToken, start, end: start + rawToken.length });
	}
	return tokens;
}

/**
 * Repasse sur `rawWords` (déjà filtré de toute ponctuation) avec les MÊMES
 * règles que categorizeStructureWords() pour repérer, DANS L'ORDRE, chaque
 * mot qui produit la catégorie "subordination" (= future CHARNIÈRE), en
 * conservant son texte réel ET son décalage d'origine. Dupliqué
 * volontairement (plutôt que de faire renvoyer mot+offsets à
 * categorizeStructureWords()) pour ne pas complexifier la fonction
 * partagée la plus sensible du fichier ; ne garder que la partie
 * strictement nécessaire ici limite le risque de divergence.
 */
function subordinationOccurrences(
	rawWords: Array<{ word: string; start: number; end: number }>,
	getCategory: GetCategory
): Array<{ word: string; start: number; end: number }> {
	const result: Array<{ word: string; start: number; end: number }> = [];
	let previousCategory = "";
	for (let wordIndex = 0; wordIndex < rawWords.length; wordIndex++) {
		const { word, start, end } = rawWords[wordIndex];
		const followingCategories = rawWords
			.slice(wordIndex + 1)
			.map((candidate) => getCategory(candidate.word).toLowerCase());
		const pourInfinitive = word === "pour" && followingCategories.some((c) => c.startsWith("verbe"));

		let category = pourInfinitive ? "subordination" : wordCategory(word, rawWords[wordIndex + 1]?.word, getCategory);

		if (category === "participe") category = previousCategory === "verbe" ? "verbe" : "adjectif";
		else if (category.startsWith("nom")) category = "nom";
		else if (category.startsWith("adjectif")) category = "adjectif";
		else if (category.startsWith("verbe")) category = "verbe";

		if (category === "déterminant" || category === "préposition") continue;
		if (category === "nom" && previousCategory === "pronom") category = "verbe";
		if (category === "pronom" && previousCategory === "pronom") continue;
		if (category === "verbe" && previousCategory === "verbe") continue;
		if (category === "subordination" && previousCategory === "subordination") continue;

		if (category === "subordination") result.push({ word, start, end });
		previousCategory = category;
	}
	return result;
}

export function analyzeClause(text: string, getCategory: GetCategory, expandLeadingSubordinate = false): ClauseAnalysis {
	const rawWords = structureTokensWithOffsets(text).filter(
		({ word }) => !STRUCTURE_PUNCTUATION.has(word) && !IGNORED_STRUCTURE_PUNCTUATION.has(word)
	);
	if (rawWords.length === 0) {
		return { displayTokens: [], key: "", reduction: "none", highlightFrom: 0, highlightTo: text.length };
	}

	const roles = syntacticClause(categorizeStructureWords(rawWords.map(({ word }) => word), getCategory));
	if (roles.length === 0) {
		return { displayTokens: rawWords.map(({ word }) => word), key: "", reduction: "none", highlightFrom: 0, highlightTo: text.length };
	}
	const charnière = subordinationOccurrences(rawWords, getCategory)[0];

	// UNE SEULE décomposition, partagée par l'affichage ET la clé de
	// comparaison (plus aucune divergence possible entre les deux) :
	//
	// Étape 1 — isole une éventuelle introduction SUJET+VERBE. Elle reste
	// dans la clé complète sans charnière ; alignNominalEnumeration() ne la
	// réduit que lorsque les deux groupes suivants confirment une ellipse.
	let intro: string[] = [];
	let rest = roles;
	if (rest[0] === "SUJET" && rest[1] === "VERBE" && rest.length > 2) {
		intro = rest.slice(0, 2);
		rest = rest.slice(2);
	}

	// Étape 2 — élaboration subordonnée : dans ce qui reste, une charnière
	// suivie de sa PROPRE clause verbale ne fait que préciser ce qui la
	// précède (le "head"), quelle que soit sa structure interne. UN HEAD
	// NON VIDE RESTE CE QU'IL EST, PEU IMPORTE CE QUI LE SUIT : la
	// subordonnée entière disparaît alors de l'affichage ET de la clé,
	// qu'il s'agisse d'un simple adjectif ("tordu COMME un arbre QUI A
	// GRANDI...") ou d'une phrase complète ("j'étais trop lâche POUR
	// MOURIR dignement" → "SUJET VERBE COMPLÉMENT", pas plus). Seul un head
	// VIDE — la charnière est tout de suite en tête, rien à comparer avant
	// elle ("PENDANT QUE la voisine lançait...") — garde la charnière
	// visible, sous la forme "{mot} SUBORDONNÉE".
	const charnièreIndex = rest.indexOf("CHARNIÈRE");
	if (charnièreIndex !== -1 && charnière) {
		const head = rest.slice(0, charnièreIndex);
		const after = rest.slice(charnièreIndex + 1);
		if (after.includes("VERBE")) {
			if (head.length > 0) {
				const nominalHead = head[0] === "NOM" && head.length > 1;
				let highlightTo = charnière.start;
				while (highlightTo > 0 && /\s/.test(text[highlightTo - 1])) highlightTo--;
				return {
					displayTokens: [...intro, ...head],
					key: (nominalHead ? head.slice(1) : head).join(" "),
					reduction: "before",
					highlightFrom: 0,
					highlightTo,
				};
			}
			return {
				displayTokens: expandLeadingSubordinate && intro.length === 0 ? [charnière.word, ...after] : [...intro, charnière.word, "SUBORDONNÉE"],
				key: expandLeadingSubordinate && intro.length === 0 ? after.join(" ") : `${charnière.word} SUBORDONNÉE`,
				reduction: intro.length > 0 ? "after" : "none",
				highlightFrom: intro.length > 0 ? charnière.start : 0,
				highlightTo: text.length,
			};
		}
		// Charnière SANS clause verbale après elle : après une introduction
		// verbale, c'est un simple COMPLÉMENT, quelle que soit sa forme interne.
		// Sans introduction verbale, le mot réel reste visible.
		let highlightFrom = charnière.end;
		while (highlightFrom < text.length && /\s/.test(text[highlightFrom])) highlightFrom++;
		if (intro.length > 0) {
			return {
				displayTokens: [...intro, "COMPLÉMENT"],
				key: "COMPLÉMENT",
				reduction: "after",
				highlightFrom,
				highlightTo: text.length,
			};
		}
		return {
			displayTokens: [...intro, ...head, charnière.word, ...after],
			key: after.join(" "),
			reduction: "after",
			highlightFrom,
			highlightTo: text.length,
		};
	}

	// Pas de charnière (ou aucun mot identifiable) : ce qui reste après
	// l'introduction éventuelle EST le contenu, tel quel.
	const nominalHead = rest[0] === "NOM" && rest.length > 1;
	return {
		displayTokens: [...intro, ...rest],
		key: (intro.length > 0 ? [...intro, ...rest] : nominalHead ? rest.slice(1) : rest).join(" "),
		reduction: intro.length > 0 || nominalHead ? "after" : "none",
		highlightFrom: 0,
		highlightTo: text.length,
	};
}

/**
 * Identifiant de tricolon (1, 2, 3...) et position (1, 2 ou 3) À L'INTÉRIEUR
 * de ce tricolon, pour un groupe donné — ou null s'il n'appartient à aucun
 * tricolon.
 */
export interface TricolonMembership {
	groupId: number;
	position: number;
}

/**
 * Détecte les tricolons à partir d'une liste de ClauseParallelKey déjà
 * calculées, UNE PAR GROUPE VIRGULE, dans l'ordre d'apparition dans la
 * phrase, et renvoie l'appartenance de CHAQUE groupe (ou null). Un run de
 * groupes consécutifs de même clé (non vide) doit contenir exactement trois
 * membres : une liste plus longue n'est jamais découpée en tricolons.
 * Seule l'égalité de `key` compte, quelle que soit la
 * `reduction` qui l'a produite (voir analyzeClause()) : un groupe réduit
 * "before" (ex. "tordu COMME un arbre qui a grandi..." → clé
 * "COMPLÉMENT") rejoint librement un run de COMPLÉMENT simples ("sec",
 * "maigre") commencé par des groupes non réduits, et réciproquement.
 *
 * Fonction PARTAGÉE entre modes/ternary.ts (surlignage dans l'éditeur) et
 * modes/structure-report.ts (numérotation (1)(2)(3) dans la commande
 * Structure) : ils doivent impérativement s'accorder sur le MÊME calcul,
 * sans quoi Structure et Tricolons finissent par se contredire — ce qui
 * s'est déjà produit avant cette factorisation.
 */
export function tricolonMembership(keys: ClauseParallelKey[]): Array<TricolonMembership | null> {
	const membership: Array<TricolonMembership | null> = Array.from({ length: keys.length }, () => null);
	let tricolonCount = 0;
	let runStart = 0;
	for (let i = 1; i <= keys.length; i++) {
		const continuesRun = i < keys.length && !keys[i].startsEnumeration && keys[i].key !== "" && keys[i].key === keys[runStart].key;
		if (!continuesRun) {
			if (keys[runStart].key !== "" && i - runStart === 3) {
				tricolonCount++;
				for (let position = 0; position < 3; position++) {
					membership[runStart + position] = { groupId: tricolonCount, position: position + 1 };
				}
			}
			runStart = i;
		}
	}
	return membership;
}
