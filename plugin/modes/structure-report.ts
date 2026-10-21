/**
 * Commande "Structure" : affiche, pour chaque phrase du document, son
 * encodage syntaxique groupe par groupe (CADRATIF/SUJET/VERBE/COMPLÉMENT/CONJONCTION/
 * INCONNU ; les compléments postverbaux sont condensés en COMPLÉMENT et
 * toute suite avec son propre verbe conjugué après une charnière est
 * condensée en "subordonnée", quelle que soit sa structure interne — voir
 * analyzeClause() dans structure-signature.ts) en texte markdown pur, sans
 * aucune mise en forme (pas de gras, pas de HTML) — purement un outil de
 * lecture/débogage pour comprendre comment Cadence et Tricolons analysent
 * le texte. Ne modifie JAMAIS le document d'origine : le résultat est écrit
 * dans une NOUVELLE note Markdown dédiée (un nouveau document plutôt qu'un
 * calque dans l'éditeur en cours évite tout risque d'interférer avec la
 * frappe).
 *
 * Découpage en groupes IDENTIQUE à modes/ternary.ts : virgules et
 * coordinations « et/ou/ni » entre membres d'une énumération parallèle,
 * puis fusion des seules continuations d'un complément nominal — les deux modules appellent ensuite
 * analyzeClause() groupe par groupe et tricolonMembership() sur le résultat,
 * EXACTEMENT comme modes/ternary.ts, pour que Structure et Tricolons
 * s'accordent toujours, sans aller-retour de capture d'écran. Chaque groupe
 * qui appartient à un tricolon détecté est annoté "(N)" où N est sa
 * position (1, 2 ou 3) dans ce tricolon.
 */

import { sentenceRanges, trimRange } from "./clause-split";
import {
	GetCategory,
	analyzeSentenceStructure,
	structureGroupRanges,
	tricolonMembership,
} from "./structure-signature";

/**
 * Construit le contenu Markdown du rapport pour tout le texte fourni.
 * `getCategory` doit être synchrone et déjà renseigné (voir
 * FinitionRuntime.wordCategoryCache / GrammalecteEngine.getCategories dans
 * main.ts) : ce module ne s'occupe pas d'aller chercher les catégories.
 */
export function buildStructureReport(text: string, getCategory: GetCategory): string {
	const lines: string[] = [
		"# Finition — Structure",
		"",
		"Un verbe négatif est noté NE PAS VERBE, quelle que soit la marque de négation (pas, plus, jamais…).",
		"",
		"Encodage syntaxique de chaque groupe (CADRATIF, SUJET, VERBE, COMPLÉMENT, CONJONCTION, INCONNU ; les compléments postverbaux sont condensés en COMPLÉMENT et toute suite avec son propre verbe conjugué après une charnière est condensée en SUBORDONNÉE), généré pour comprendre comment les modes Cadence et Tricolons analysent le texte. Le « (N) » après un groupe indique sa position (1, 2 ou 3) dans un tricolon détecté. Lecture seule : ce document n'est lié à aucun autre et peut être supprimé sans conséquence.",
		"",
		"---",
		"",
	];

	let sentenceIndex = 0;
	for (const [sentenceStartRaw, sentenceEndRaw] of sentenceRanges(text)) {
		const [sentenceStart, sentenceEnd] = trimRange(text, sentenceStartRaw, sentenceEndRaw);
		if (sentenceStart >= sentenceEnd) continue;
		const sentence = text.slice(sentenceStart, sentenceEnd);
		if (/^#{1,6}[ \t]/.test(sentence)) continue; // pas un titre

		const groupRanges = structureGroupRanges(text, sentenceStart, sentenceEnd, getCategory);
		if (groupRanges.length === 0) continue;

		const analyses = analyzeSentenceStructure(text, sentenceStart, sentenceEnd, getCategory);
		if (analyses.every((analysis) => analysis.displayTokens.length === 0)) continue; // aucune structure reconnaissable

		const membership = tricolonMembership(analyses);

		const renderedGroups = analyses.map((analysis, index) => {
			const rendered = analysis.displayTokens.join(" ");
			const position = membership[index]?.position;
			return position === undefined ? rendered : `${rendered} (${position})`;
		});

		sentenceIndex++;
		lines.push(`${sentenceIndex}. ${sentence}`);
		lines.push("");
		const signature = renderedGroups.map((group, index) => {
			const separator = index === 0 ? "" : group === ":" || renderedGroups[index - 1] === ":" ? " " : ", ";
			return separator + group;
		}).join("");
		lines.push(`${signature}.`);
		lines.push("");
	}

	if (sentenceIndex === 0) {
		lines.push("_Aucune phrase avec une structure reconnaissable n'a été trouvée._");
	}

	return lines.join("\n");
}
