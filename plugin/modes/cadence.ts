/**
 * Mode "Cadence" : repère les PHRASES découpées en groupes (par virgule ou
 * charnière syntaxique — liste dans data/syntax-hinges.json : "qui", "que",
 * "comme", "et"...) de même nombre de mots EXACTEMENT, quand cette
 * structure se RÉPÈTE dans une autre phrase proche (même esprit que les
 * répétitions lexicales, mais sur le rythme plutôt que sur le lemme : une
 * phrase seule sur son modèle, même reconnaissable, ne ressemble à aucune
 * autre et n'est pas surlignée). Une phrase sans virgule ni charnière est
 * un cas particulier à 1 seul groupe (sa longueur totale). Pas de notion
 * d'équilibre interne entre les groupes d'une même phrase : seule compte
 * la comparaison exacte entre deux phrases différentes. Jamais coupée sur
 * ";:—–" (voir sentenceRanges() dans clause-split.ts) : seul un point ou
 * un saut de paragraphe/titre termine une phrase.
 */

import { Highlight, PALETTE_SIZE } from "../types";
import { WORD_RE, sentenceRanges, trimRange } from "./clause-split";
import { sentenceStructureSignatures, GetCategory } from "./structure-signature";

// Deux phrases sont de même structure seulement si chaque groupe
// correspondant a EXACTEMENT le même nombre de mots (une tolérance ±1
// laissait passer des rapprochements sans rapport perceptible, ex. [6,6]
// et [6,5] jugés "semblables" alors qu'ils ne le sont pas).
const CROSS_SENTENCE_TOLERANCE = 0;

function escapeRegExp(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Séparateur entre les groupes d'une phrase : virgule et/ou une charnière
// jouant le rôle de liaison parallèle (insensible à la casse). La liste de
// charnières vient de data/syntax-hinges.json (pas en dur ici).
// \b en JS ne reconnaît que les lettres ASCII : "où" (accentué) ne
// matcherait jamais ses frontières avec \b. On utilise des lookarounds
// Unicode (\p{L}) à la place.
function buildGroupSeparator(hinges: string[]): RegExp {
	if (hinges.length === 0) return /\s*,\s*/gi;
	const alternatives = hinges.map(escapeRegExp).join("|");
	const pattern = "\\s*(?:,|(?:^|[^\\p{L}\\p{N}_])(?:" + alternatives + ")(?![\\p{L}\\p{N}_]))\\s*";
	return new RegExp(pattern, "giu");
}

function wordCount(group: string): number {
	WORD_RE.lastIndex = 0;
	let count = 0;
	while (WORD_RE.exec(group) !== null) count++;
	return count;
}

/** Une phrase candidate, avec le nombre de mots de chacun de ses groupes. */
interface Candidate {
	range: [number, number]; // la phrase entière (bornes rognées), pas ses morceaux
	counts: number[]; // nombre de mots de chaque groupe
	start: number; // position de la phrase, pour la comparaison d'empan
}

function sameShape(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((count, index) => Math.abs(count - b[index]) <= CROSS_SENTENCE_TOLERANCE);
}

/** Repère les phrases candidates, dans l'ordre du document. */
function collectCandidates(text: string, hinges: string[]): Candidate[] {
	const groupSeparator = buildGroupSeparator(hinges);
	const candidates: Candidate[] = [];
	for (const [clauseStartRaw, clauseEndRaw] of sentenceRanges(text)) {
		const clause = text.slice(clauseStartRaw, clauseEndRaw);
		// Un titre Markdown ("#", "##"...) n'est pas une phrase : on l'exclut
		// explicitement, même s'il devrait déjà être retiré en amont par
		// BLOCK_BREAK_RE (clause-split.ts). Sans ça, l'extension aux phrases
		// à 1 seul groupe (juste ajoutée) ferait "matcher" deux titres de
		// même longueur entre eux (ex. deux dates "Jeudi 19 février" /
		// "Vendredi 20 février"), ce qui n'a rien d'une cadence stylistique.
		if (/^#{1,6}[ \t]/.test(clause.trim())) continue;
		// Pas de minimum de groupes : une phrase simple (sans virgule ni
		// charnière) devient un candidat à 1 seul groupe = sa longueur totale,
		// comparable à d'autres phrases simples de même longueur à proximité.
		const rawGroups = clause.split(groupSeparator);
		const counts = rawGroups.map((group) => wordCount(group.trim()));
		if (counts.some((count) => count === 0)) continue; // groupe vide (séparateur en tête/queue)

		const range = trimRange(text, clauseStartRaw, clauseEndRaw);
		candidates.push({ range, counts, start: range[0] });
	}
	return candidates;
}

/**
 * Point d'entrée pour editor-extension.ts : regroupe les phrases de même
 * structure trouvées à moins de `span` caractères l'une de l'autre (chaîne
 * transitive, comme pour les répétitions). Une phrase isolée sur son
 * modèle n'est jamais surlignée ; `span` est le réglage "Cadence — empan
 * de comparaison".
 */
export function computeCadenceHighlights(text: string, span: number, hinges: string[]): Highlight[] {
	const candidates = collectCandidates(text, hinges);

	// Union-find : relie deux phrases de même structure trouvées à moins de
	// `span` caractères l'une de l'autre. Les candidats sont déjà dans
	// l'ordre du document, donc on peut arrêter la recherche en arrière dès
	// qu'on sort de l'empan (les précédents sont encore plus loin).
	const parent = candidates.map((_, index) => index);
	function find(i: number): number {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	}
	function union(a: number, b: number): void {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) parent[rootA] = rootB;
	}
	for (let i = 0; i < candidates.length; i++) {
		for (let j = i - 1; j >= 0; j--) {
			if (candidates[i].start - candidates[j].start > span) break;
			if (sameShape(candidates[i].counts, candidates[j].counts)) union(i, j);
		}
	}

	const clusters = new Map<number, number[]>();
	candidates.forEach((_, index) => {
		const root = find(index);
		if (!clusters.has(root)) clusters.set(root, []);
		clusters.get(root)!.push(index);
	});

	const highlights: Highlight[] = [];
	let colorCounter = 0;
	for (const members of clusters.values()) {
		if (members.length < 2) continue; // phrase seule sur son modèle : pas de surlignage
		const lemma = `cadence-${members[0]}`;
		const colorIndex = colorCounter++ % PALETTE_SIZE;
		for (const memberIndex of members) {
			const [from, to] = candidates[memberIndex].range;
			highlights.push({ from, to, lemma, colorIndex });
		}
	}
	return highlights;
}

/** Une phrase candidate pour le moteur "grammalecte" : signature syntaxique au lieu d'un tableau de longueurs. */
interface StructuralCandidate {
	range: [number, number];
	signature: string;
	start: number;
}

function collectStructuralCandidates(text: string, getCategory: GetCategory): StructuralCandidate[] {
	const sentences: { range: [number, number]; text: string }[] = [];
	for (const [startRaw, endRaw] of sentenceRanges(text)) {
		const clause = text.slice(startRaw, endRaw);
		if (/^#{1,6}[ \t]/.test(clause.trim())) continue; // pas un titre
		if (!clause.trim()) continue;
		sentences.push({ range: trimRange(text, startRaw, endRaw), text: clause });
	}
	// L'encodage phrase par phrase conserve les plages des phrases reconnues.
	const candidates: StructuralCandidate[] = [];
	for (const sentence of sentences) {
		const [signature] = sentenceStructureSignatures([sentence.text], getCategory);
		if (!signature) continue; // phrase sans structure reconnaissable (ex. une seule interjection)
		candidates.push({ range: sentence.range, signature, start: sentence.range[0] });
	}
	return candidates;
}

/**
 * Variante "grammalecte" de Cadence : regroupe les phrases qui partagent
 * exactement la même signature syntaxique (SUJET/VERBE/COMPLÉMENT/
 * PROPOSITION_SUBORDONNÉE...), fidèle à `sentence_structure_signatures()`
 * + `structural_diversity()` du projet Python `unshiter`
 * (script/detector/stats.py). `getCategory` doit être synchrone : voir
 * FinitionRuntime.wordCategoryCache (types.ts) pour la façon dont le cache
 * alimenté par le Worker Grammalecte est exposé ici sans bloquer.
 */
export function computeCadenceHighlightsStructural(text: string, span: number, getCategory: GetCategory): Highlight[] {
	const candidates = collectStructuralCandidates(text, getCategory);

	const parent = candidates.map((_, index) => index);
	function find(i: number): number {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	}
	function union(a: number, b: number): void {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) parent[rootA] = rootB;
	}
	for (let i = 0; i < candidates.length; i++) {
		for (let j = i - 1; j >= 0; j--) {
			if (candidates[i].start - candidates[j].start > span) break;
			if (candidates[i].signature === candidates[j].signature) union(i, j);
		}
	}

	const clusters = new Map<number, number[]>();
	candidates.forEach((_, index) => {
		const root = find(index);
		if (!clusters.has(root)) clusters.set(root, []);
		clusters.get(root)!.push(index);
	});

	const highlights: Highlight[] = [];
	let colorCounter = 0;
	for (const members of clusters.values()) {
		if (members.length < 2) continue;
		const lemma = `cadence-struct-${members[0]}`;
		const colorIndex = colorCounter++ % PALETTE_SIZE;
		for (const memberIndex of members) {
			const [from, to] = candidates[memberIndex].range;
			highlights.push({ from, to, lemma, colorIndex });
		}
	}
	return highlights;
}
