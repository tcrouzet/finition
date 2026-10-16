/**
 * Mode "Monotonie" : repère les séries de phrases consécutives de longueur
 * "perceptiblement proche" (en nombre de mots), par analogie avec
 * script/burstiness/ dans unshiter (burst_detect.py, color_scale.py,
 * length_metrics.py, sentence_split.py — mode "regex", sans spaCy).
 *
 * Contrairement aux autres modes, aucun dictionnaire n'est nécessaire : tout
 * se calcule localement sur le texte (découpage en phrases, comptage de
 * mots, comparaison phrase à phrase). Pas d'export Python requis.
 */

import { Highlight, PALETTE_SIZE } from "../types";

// --- Découpage en phrases (port de sentence_split.py, mode "regex") -----

// Un mot = une suite de lettres, éventuellement reliée par apostrophe ou
// trait d'union ("après-midi", "qu'il" compte comme deux mots séparés,
// cohérent avec le reste du plugin — mais seul le NOMBRE de mots importe
// ici, pas leur lemme).
const WORD_RE = /[a-zàâäéèêëîïôöùûüÿœæ]+(?:['’-][a-zàâäéèêëîïôöùûüÿœæ]+)*/gi;

function countWords(sentence: string): number {
	WORD_RE.lastIndex = 0;
	return sentence.match(WORD_RE)?.length ?? 0;
}

// Une phrase se termine par ".", "!", "?", "…" ou "...", éventuellement
// suivi d'un guillemet/parenthèse fermante, et la phrase suivante commence
// par une majuscule, un chiffre ou un guillemet/parenthèse ouvrante.
const SENTENCE_BOUNDARY_RE =
	/(?<end>(?:\.\.\.|[.!?…])(?:\s?[»”"')*_`]+)?)\s+(?=[*_`]*[A-ZÀ-ÖØ-Þ0-9«"“(-])/g;

// Blocs de code (``` ou ~~~) : à exclure de l'analyse (jamais de "phrases"
// dans du code). Remplacés par des espaces de même longueur pour préserver
// tous les décalages de caractères du texte d'origine.
const CODE_FENCE_RE = /(```|~~~)[\s\S]*?\1/g;

function maskCodeFences(text: string): string {
	return text.replace(CODE_FENCE_RE, (match) => " ".repeat(match.length));
}

interface Sentence {
	start: number;
	end: number;
	wordCount: number;
}

function splitSentences(text: string): Sentence[] {
	const masked = maskCodeFences(text);
	const sentences: Sentence[] = [];
	let last = 0;
	SENTENCE_BOUNDARY_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = SENTENCE_BOUNDARY_RE.exec(masked)) !== null) {
		const endGroup = match.groups?.end ?? "";
		const endPos = match.index + endGroup.length;
		const raw = text.slice(last, endPos);
		if (raw.trim().length > 0) {
			// On resserre les bornes sur le texte réel (ignore les espaces de
			// bord), pour ne pas surligner un retour à la ligne ou une espace.
			const leading = raw.length - raw.trimStart().length;
			const trimmed = raw.trim();
			sentences.push({
				start: last + leading,
				end: last + leading + trimmed.length,
				wordCount: countWords(trimmed),
			});
		}
		last = SENTENCE_BOUNDARY_RE.lastIndex;
	}
	const tail = text.slice(last);
	if (tail.trim().length > 0) {
		const leading = tail.length - tail.trimStart().length;
		const trimmed = tail.trim();
		sentences.push({
			start: last + leading,
			end: last + leading + trimmed.length,
			wordCount: countWords(trimmed),
		});
	}
	return sentences;
}

// --- Détection des séries (port de burst_detect.py) ----------------------

interface Run {
	start: number; // index de la 1ère phrase de la série (dans `sentences`)
	end: number; // index exclusif de fin
	counts: number[];
}

/** Tolérance en pourcentage de la moyenne des deux longueurs COMPARÉES
 * (a et b, les deux phrases voisines — pas une moyenne globale du
 * document) : plus ces deux phrases sont longues, plus l'écart toléré
 * (en mots) est grand, toujours avec un minimum absolu d'1 mot (le minimum
 * possible). Ex. 10 % : deux phrases de 10 mots tolèrent 1 mot d'écart,
 * deux phrases de 30 mots en tolèrent 3. */
function isClose(a: number, b: number, percent: number): boolean {
	if (a === b) return true;
	const ref = (a + b) / 2; // moyenne de a et b uniquement, pas du document
	const tolerance = Math.max(1, Math.round((percent / 100) * ref));
	return Math.abs(a - b) <= tolerance;
}

function detectBursts(counts: number[], threshold: number, percent: number): Run[] {
	const runs: Run[] = [];
	let i = 0;
	const n = counts.length;
	while (i < n) {
		let j = i;
		while (j + 1 < n && isClose(counts[j], counts[j + 1], percent)) j++;
		const runLength = j - i + 1;
		if (runLength >= threshold) {
			runs.push({ start: i, end: j + 1, counts: counts.slice(i, j + 1) });
		}
		i = j + 1;
	}
	return runs;
}

// --- Couleur par POSITION dans la série (pas par longueur) ---------------

// La couleur ne dépend PAS de la longueur des phrases (deux phrases de
// même longueur ne sont pas forcément de la même couleur), mais de leur
// POSITION dans la série repérée :
// - la phrase centrale de la série reçoit toujours la couleur 0 (fixe) ;
// - chaque phrase avant/après s'en écarte par pas de 1 à partir du CENTRE
//   de la palette (8 pour 16 couleurs) : la phrase juste avant le centre
//   reçoit la couleur 7, celle juste après la couleur 9, puis 6/10, 5/11…
//   plafonné aux bornes de la palette (0 et PALETTE_SIZE-1) au-delà.
const BURST_REFERENCE_COLOR = 0;
const BURST_LATERAL_CENTER = Math.floor(PALETTE_SIZE / 2); // 8 pour PALETTE_SIZE = 16

function colorsForRun(length: number): number[] {
	const centerIndex = Math.floor((length - 1) / 2);
	return Array.from({ length }, (_, i) => {
		const offset = i - centerIndex;
		if (offset === 0) return BURST_REFERENCE_COLOR;
		return Math.min(Math.max(BURST_LATERAL_CENTER + offset, 0), PALETTE_SIZE - 1);
	});
}

// --- Point d'entrée --------------------------------------------------------

/**
 * Détecte les séries de phrases de longueur proche et retourne un
 * surlignage par phrase (le champ `lemma` sert d'identifiant de série, pour
 * que le clic mette en évidence toutes les phrases de la même série, comme
 * les autres modes le font pour un lemme ou une locution répétée).
 */
export function computeBurstinessHighlights(text: string, threshold: number, tolerancePercent: number): Highlight[] {
	const sentences = splitSentences(text);
	const counts = sentences.map((sentence) => sentence.wordCount);
	const runs = detectBursts(counts, threshold, tolerancePercent);

	const highlights: Highlight[] = [];
	runs.forEach((run, runIndex) => {
		const colors = colorsForRun(run.end - run.start);
		for (let i = run.start; i < run.end; i++) {
			const sentence = sentences[i];
			highlights.push({
				from: sentence.start,
				to: sentence.end,
				lemma: `run-${runIndex}`,
				colorIndex: colors[i - run.start],
			});
		}
	});
	return highlights;
}
