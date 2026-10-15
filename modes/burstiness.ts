/**
 * Mode "Burstiness" : repère les séries de phrases consécutives de longueur
 * "perceptiblement proche" (en nombre de mots), par analogie avec
 * script/burstiness/ dans unshiter (burst_detect.py, color_scale.py,
 * length_metrics.py, sentence_split.py — mode "regex", sans spaCy).
 *
 * Contrairement aux autres modes, aucun dictionnaire n'est nécessaire : tout
 * se calcule localement sur le texte (découpage en phrases, comptage de
 * mots, comparaison phrase à phrase). Pas d'export Python requis.
 */

import { Highlight } from "../types";

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

/** Loi de Weber-Fechner : la marge perceptible croît en racine carrée de la
 * longueur moyenne, pas proportionnellement — 1 mot d'écart se remarque
 * entre deux phrases de 3-4 mots, 4 mots d'écart ne se remarque pas entre
 * deux phrases de 26-30 mots. */
function isClose(a: number, b: number, k: number): boolean {
	if (a === b) return true;
	const ref = Math.max((a + b) / 2, 1);
	return Math.abs(a - b) <= k * Math.sqrt(ref);
}

function detectBursts(counts: number[], threshold: number, k: number): Run[] {
	const runs: Run[] = [];
	let i = 0;
	const n = counts.length;
	while (i < n) {
		let j = i;
		while (j + 1 < n && isClose(counts[j], counts[j + 1], k)) j++;
		const runLength = j - i + 1;
		if (runLength >= threshold) {
			runs.push({ start: i, end: j + 1, counts: counts.slice(i, j + 1) });
		}
		i = j + 1;
	}
	return runs;
}

// --- Couleur par rang local (port de color_scale.py) ---------------------

// 5 teintes fixes : indices 0-4, le centre (2) est la référence (médiane de
// la série). Voir styles.css pour les couleurs réelles (reprises telles
// quelles de script/burstiness/config.py : COLOR_SCALE).
const PALETTE_CENTER = 2;
const PALETTE_SIZE = 5;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function colorsForRun(counts: number[]): number[] {
	const localMedian = median(counts);
	const uniqueValues = Array.from(new Set(counts)).sort((a, b) => a - b);
	const reference = uniqueValues.reduce((best, value) =>
		Math.abs(value - localMedian) < Math.abs(best - localMedian) ? value : best
	);
	const above = uniqueValues.filter((value) => value > reference).sort((a, b) => a - b);
	const below = uniqueValues.filter((value) => value < reference).sort((a, b) => b - a);

	const colorByValue = new Map<number, number>();
	colorByValue.set(reference, PALETTE_CENTER);
	above.forEach((value, rank) => colorByValue.set(value, Math.min(PALETTE_CENTER + 1 + rank, PALETTE_SIZE - 1)));
	below.forEach((value, rank) => colorByValue.set(value, Math.max(PALETTE_CENTER - 1 - rank, 0)));

	return counts.map((count) => colorByValue.get(count) ?? PALETTE_CENTER);
}

// --- Point d'entrée --------------------------------------------------------

/**
 * Détecte les séries de phrases de longueur proche et retourne un
 * surlignage par phrase (le champ `lemma` sert d'identifiant de série, pour
 * que le clic mette en évidence toutes les phrases de la même série, comme
 * les autres modes le font pour un lemme ou une locution répétée).
 */
export function computeBurstinessHighlights(text: string, threshold: number, toleranceK: number): Highlight[] {
	const sentences = splitSentences(text);
	const counts = sentences.map((sentence) => sentence.wordCount);
	const runs = detectBursts(counts, threshold, toleranceK);

	const highlights: Highlight[] = [];
	runs.forEach((run, runIndex) => {
		const colors = colorsForRun(run.counts);
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
