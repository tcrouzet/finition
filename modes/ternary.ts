/**
 * Mode "Tricolons" : repère les suites de 3 groupes consécutifs (séparés par
 * une virgule et/ou une coordination), À L'INTÉRIEUR D'UNE MÊME PHRASE, dont la signature
 * syntaxique est identique — voir tricolonMembership() dans
 * structure-signature.ts pour l'algorithme exact, PARTAGÉ avec la commande
 * "Structure" (modes/structure-report.ts) pour que les deux s'accordent
 * toujours sur le même résultat.
 *
 * Découpage aligné sur celui de la commande Structure : virgules et
 * coordinations d'énumération, à l'intérieur d'une phrase (sentenceRanges(), jamais coupée sur
 * ";:—–", et qui ignore désormais toute ponctuation encore à l'intérieur
 * de guillemets ouverts — voir clause-split.ts). Seules les continuations
 * d'un même complément nominal sont fusionnées ; les groupes détachés restent
 * distincts. Les listes de plus de trois membres ne sont
 * jamais découpées en tricolons.
 *
 * Avertissement honnête : reconnaître un VRAI tricolon rhétorique (parallèle
 * de SENS, pas seulement de grammaire) à partir de seules catégories
 * grammaticales reste un problème difficile ; cette heuristique ne prétend
 * pas y parvenir parfaitement sur toutes les phrases littéraires.
 */

import { Highlight, PALETTE_SIZE } from "../types";
import { sentenceRanges } from "./clause-split";
import {
	analyzeSentenceStructure,
	structureGroupRanges,
	tricolonMembership,
	GetCategory,
} from "./structure-signature";

/** Une suite d'exactement 3 groupes consécutifs de même structure. */
export interface TricolonRun {
	from: number;
	to: number;
}

/**
 * Détecte tous les tricolons (groupes de 3, voir en-tête du fichier) dans
 * tout le texte, phrase par phrase.
 */
export function tricolonRuns(text: string, getCategory: GetCategory): TricolonRun[] {
	const runs: TricolonRun[] = [];

	for (const [sentenceStart, sentenceEnd] of sentenceRanges(text)) {
		const sentence = text.slice(sentenceStart, sentenceEnd);
		if (/^#{1,6}[ \t]/.test(sentence.trim())) continue; // pas un titre
		if (!sentence.includes(",")) continue; // court-circuit : pas de virgule, pas de tricolon possible

		const groupRanges = structureGroupRanges(text, sentenceStart, sentenceEnd, getCategory);
		if (groupRanges.length < 3) continue;

		const parallelKeys = analyzeSentenceStructure(text, sentenceStart, sentenceEnd, getCategory);
		const membership = tricolonMembership(parallelKeys);

		// Regroupe les plages des groupes partageant le même groupId en un
		// seul surlignage par tricolon détecté. Chaque groupe apporte sa
		// propre plage EFFECTIVE (highlightFrom/highlightTo, voir
		// analyzeClause()) plutôt que sa plage BRUTE : un
		// groupe réduit "after" (ex. "j'ai ri COMME un idiot") ne contribue
		// que sa partie après la charnière, un groupe réduit "before" (ex.
		// "tordu COMME un arbre qui a grandi...") que sa partie avant —
		// jamais l'introduction commune ou l'élaboration subordonnée, qui
		// ne font pas partie du parallélisme même si elles appartiennent
		// grammaticalement au même groupe virgule. Seuls le DÉBUT du
		// premier groupe et la FIN du dernier groupe d'un même tricolon
		// délimitent le surlignage final (tout ce qui est entre les deux,
		// virgules incluses, reste visuellement englobé).
		let currentGroupId: number | null = null;
		let currentFrom = 0;
		let currentTo = 0;
		for (let i = 0; i < groupRanges.length; i++) {
			const groupId = membership[i]?.groupId ?? null;
			const key = parallelKeys[i];
			const effectiveFrom = groupRanges[i][0] + key.highlightFrom;
			const effectiveTo = groupRanges[i][0] + key.highlightTo;
			if (groupId !== currentGroupId) {
				if (currentGroupId !== null) runs.push({ from: currentFrom, to: currentTo });
				currentGroupId = groupId;
				currentFrom = effectiveFrom;
			}
			currentTo = effectiveTo;
		}
		if (currentGroupId !== null) runs.push({ from: currentFrom, to: currentTo });
	}

	return runs;
}

/**
 * Point d'entrée pour editor-extension.ts : chaque tricolon détecté devient
 * un surlignage. `colorIndex` boucle sur la palette (comme Cadence et
 * Répétitions) pour que deux tricolons voisins restent visuellement
 * distincts.
 */
export function computeTernaryHighlights(text: string, getCategory: GetCategory): Highlight[] {
	return tricolonRuns(text, getCategory).map(({ from, to }, index) => ({
		from,
		to,
		lemma: `ternary-${index}`,
		colorIndex: index % PALETTE_SIZE,
	}));
}
