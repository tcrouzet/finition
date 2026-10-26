/**
 * Intégration CodeMirror 6 : calcule les décorations selon le mode actif et
 * les tient à jour (frappe debouncée, changement de réglages immédiat).
 *
 * Ce fichier ne connaît que FinitionRuntime (voir types.ts), jamais la
 * classe FinitionPlugin elle-même : pour ajouter un mode, il suffit
 * d'ajouter un cas dans buildDecorations() et le brancher sur son propre
 * module modes/xxx.ts.
 */

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { Notice } from "obsidian";
import { FinitionMode, FinitionRuntime, Highlight } from "./types";
import type { NoteAnalysis } from "./note-analysis";
import { computeRepetitions, countRepetitionWords } from "./modes/repetition";
import { computeHedgingHighlights } from "./modes/hedging";
import { computeStereotypeHighlights } from "./modes/stereotype";
import { computeBurstinessHighlights } from "./modes/burstiness";
import { computeTernaryHighlights } from "./modes/ternary";
import { computeCadenceHighlights, computeCadenceHighlightsStructural } from "./modes/cadence";
import { structureCategoryWords } from "./modes/structure-signature";
import { computeHingeHighlights } from "./modes/hinges";
import { analyzeTicIA } from "./modes/tic-ia";
import { computeFormHighlights } from "./modes/formes";
import { computeCopuleHighlights } from "./modes/copules";
import { markdownExclusionRanges, maskMarkdownExclusions } from "./markdown-tags";

/** Classe CSS appliquée aux occurrences du lemme actuellement sélectionné au clic. */
const FOCUS_CLASS = "finition-focused";

function analysisMode(view: EditorView, runtime: FinitionRuntime): FinitionMode {
	return runtime.getNoteAnalysis?.(view).mode ?? runtime.settings.mode;
}

function buildDecorations(view: EditorView, runtime: FinitionRuntime, focusedLemma: string | null): DecorationSet {
	const mode = analysisMode(view, runtime);
	const limit = Math.min(view.state.doc.length, runtime.settings.maxDocumentLength);
	// Un séparateur et un caractère Unicode suffisent à reconnaître un tag numérique tronqué.
	const prefix = view.state.doc.sliceString(0, Math.min(view.state.doc.length, limit + 3));
	const protectedRanges = markdownExclusionRanges(prefix);
	let text = maskMarkdownExclusions(prefix, protectedRanges).slice(0, limit);
	if (text.length < view.state.doc.length) {
		text = text.replace(/[\uD800-\uDBFF]$/u, "");
		if (/^[\p{L}\p{M}\p{N}_’'-]/u.test(view.state.doc.sliceString(text.length, Math.min(view.state.doc.length, text.length + 2)))) {
			text = text.replace(/[\p{L}\p{M}\p{N}_’'-]+$/u, "");
		}
	}
	if (["repetition", "stereotype", "copules"].includes(mode) && !runtime.lexicon.size) {
		runtime.updateAnalysisHighlights(view, [], false);
		return Decoration.none;
	}

	let highlights: Highlight[];
	let pending = false;
	let cssClass: (highlight: Highlight) => string;

	if (mode === "repetition") {
		highlights = computeRepetitions(
			text,
			runtime.lexicon,
			runtime.functionWords,
			runtime.settings.span,
			runtime.settings.repetitionMinLength
		);
		cssClass = (highlight) => {
			const base = `finition-repeat finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "hedging") {
		highlights = computeHedgingHighlights(text, runtime.hedgingPhrases);
		cssClass = (highlight) => {
			const base = `finition-hedging finition-color-${runtime.settings.hedgingColorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "stereotype") {
		highlights = computeStereotypeHighlights(text, runtime.lexicon, runtime.functionWords, runtime.stereotypePatterns);
		cssClass = (highlight) => {
			const base = `finition-stereotype finition-color-${runtime.settings.stereotypeColorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "burstiness") {
		highlights = computeBurstinessHighlights(text, runtime.settings.burstThreshold, runtime.settings.burstTolerancePercent);
		cssClass = (highlight) => {
			const base = `finition-burst finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "ternary") {
		// Même mécanisme que Cadence (moteur "Grammalecte") : les catégories
		// manquantes sont résolues de façon asynchrone par le Worker
		// Grammalecte (voir FinitionRuntime.ensureWordCategories dans
		// main.ts) — tant qu'un mot n'est pas encore dans le cache, on le
		// traite comme catégorie inconnue (""), et le regroupement se
		// complète tout seul, sans bloquer la frappe, dès que le Worker a
		// répondu (via un refreshAllEditors()).
		const getCategory = (word: string) => runtime.wordCategoryCache.get(word.toLowerCase()) ?? "";
		highlights = computeTernaryHighlights(text, getCategory);

		const words = structureCategoryWords(text);
		pending = words.some((word) => !runtime.wordCategoryCache.has(word));
		runtime.ensureWordCategories(words);

		cssClass = (highlight) => {
			// Une couleur par tricolon détecté (comme Cadence/Répétitions),
			// pas une seule couleur fixe pour tout le monde : sinon deux
			// tricolons voisins seraient indiscernables l'un de l'autre.
			const base = `finition-ternary finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "cadence") {
		if (runtime.settings.cadenceEngine === "grammalecte") {
			// Les catégories manquantes sont résolues de façon asynchrone par
			// le Worker Grammalecte (voir FinitionRuntime.ensureWordCategories
			// dans main.ts) : tant qu'un mot n'est pas encore dans le cache,
			// on le traite comme catégorie inconnue ("") — le regroupement se
			// complète tout seul, sans bloquer la frappe, dès que le Worker a
			// répondu (via un refreshAllEditors()).
			const getCategory = (word: string) => runtime.wordCategoryCache.get(word.toLowerCase()) ?? "";
			highlights = computeCadenceHighlightsStructural(text, runtime.settings.cadenceSpan, getCategory);

			const words = structureCategoryWords(text);
			pending = words.some((word) => !runtime.wordCategoryCache.has(word));
			runtime.ensureWordCategories(words);
		} else {
			highlights = computeCadenceHighlights(text, runtime.settings.cadenceSpan, runtime.syntaxHinges);
		}
		cssClass = (highlight) => {
			const base = `finition-cadence finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "tic-ia") {
		const categoryWords = structureCategoryWords(text);
		const pending = categoryWords.some((word) => !runtime.wordCategoryCache.has(word));
		const analysis = pending ? null : analyzeTicIA(text, (word) => runtime.wordCategoryCache.get(word.toLowerCase()) ?? "", runtime.lexicon);
		highlights = analysis?.highlights ?? [];
		runtime.updateTicIAStats(view, analysis?.taggedSentences ?? 0, analysis?.totalSentences ?? 0, pending);
		runtime.ensureWordCategories(categoryWords);
		cssClass = (highlight) => {
			const base = `finition-tic-ia finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "copules") {
		highlights = computeCopuleHighlights(text, runtime.copuleLexicon);
		cssClass = highlight => {
			const base = `finition-copule finition-color-${runtime.settings.copuleColorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "formes") {
		highlights = computeFormHighlights(text, runtime.settings);
		cssClass = highlight => {
			const base = `finition-forme finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (mode === "hinges") {
		highlights = computeHingeHighlights(text, runtime.syntaxHinges);
		cssClass = (highlight) => {
			const base = `finition-hinge finition-color-${runtime.settings.hingeColorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else {
		runtime.updateAnalysisHighlights(view, [], false);
		return Decoration.none;
	}

	highlights.sort((a, b) => a.from - b.from);
	runtime.updateAnalysisHighlights(view, focusedLemma === null ? highlights : highlights.filter(highlight => highlight.lemma === focusedLemma), pending, mode === "repetition" ? countRepetitionWords(text, runtime.lexicon) : undefined);
	const decorations: Range<Decoration>[] = [];
	let firstProtected = 0;
	for (const highlight of highlights) {
		while (firstProtected < protectedRanges.length && protectedRanges[firstProtected][1] <= highlight.from) firstProtected++;
		const decoration = Decoration.mark({
			class: cssClass(highlight),
			// data-finition-lemma permet d'identifier, au clic, quel groupe
			// de répétition sélectionner (voir handleClick ci-dessous).
			attributes: { title: highlight.title ?? highlight.lemma, "data-finition-lemma": highlight.lemma },
		});
		let cursor = highlight.from;
		for (let index = firstProtected; index < protectedRanges.length; index++) {
			const [from, to] = protectedRanges[index];
			if (from >= highlight.to) break;
			if (from > cursor) decorations.push(decoration.range(cursor, from));
			cursor = Math.max(cursor, to);
		}
		if (cursor < highlight.to) decorations.push(decoration.range(cursor, highlight.to));
	}
	return Decoration.set(decorations, true);
}

/** Construit l'extension CM6 à enregistrer via `plugin.registerEditorExtension(...)`. */
export function finitionEditorExtension(runtime: FinitionRuntime) {
	return ViewPlugin.fromClass(
		class {
			private analysis: NoteAnalysis | undefined;
			decorations: DecorationSet;
			private timer: number | null = null;
			// Permet de détecter un changement de réglages (mode, empan,
			// mots-outils...) même quand le document lui-même ne change pas :
			// sans ça, décocher un mode ne faisait rien tant qu'on ne tapait
			// pas un caractère (le `update()` ne se déclenchait que sur
			// `docChanged`).
			private lastSettingsVersion: number;
			private lastMode: FinitionMode;
			// Voir FinitionRuntime.wordCategoryCacheVersion (types.ts) : sans
			// ce suivi, la résolution asynchrone des catégories Grammalecte
			// (Tricolon, Cadence "grammalecte") ne déclenchait aucun
			// recalcul — l'affichage restait figé sur le tout premier calcul
			// (cache incomplet) jusqu'à ce qu'un clic recalcule enfin avec le
			// cache complet, donnant deux résultats différents pour le même
			// texte.
			private lastWordCategoryCacheVersion: number;
			private focusedLemma: string | null = null;
			private readonly handleClick: (event: MouseEvent) => void;
			private readonly view: EditorView;

			constructor(view: EditorView) {
				this.view = view;
				this.analysis = runtime.getNoteAnalysis?.(view);
				this.lastSettingsVersion = runtime.settingsVersion;
				this.lastMode = analysisMode(view, runtime);
				this.lastWordCategoryCacheVersion = runtime.wordCategoryCacheVersion;
				this.decorations = buildDecorations(view, runtime, this.focusedLemma);

				// Clic sur une occurrence surlignée : sélectionne (fond noir /
				// texte blanc) toutes les occurrences du même groupe. Reclic
				// sur le même groupe : désélectionne. L'état "sélectionné" est
				// recalculé via buildDecorations() (pas une manipulation
				// directe du DOM) pour survivre aux redessins de CodeMirror
				// (ex. bascule texte brut/rendu quand le curseur change de
				// ligne en Live Preview), qui sinon écrasaient la sélection.
				// On ne fait pas preventDefault/stopPropagation : le
				// positionnement normal du curseur par CodeMirror continue de
				// fonctionner normalement.
				this.handleClick = (event: MouseEvent) => {
					const target = event.target as HTMLElement | null;
					const marker = target?.closest<HTMLElement>("[data-finition-lemma]");
					const lemma = marker?.dataset.finitionLemma ?? null;
					this.focusedLemma = this.focusedLemma === lemma ? null : lemma;
					this.decorations = buildDecorations(this.view, runtime, this.focusedLemma);
					this.view.dispatch({});
				};
				view.dom.addEventListener("click", this.handleClick);
			}

			destroy() {
				if (this.timer !== null) window.clearTimeout(this.timer);
				this.view.dom.removeEventListener("click", this.handleClick);
			}

			update(update: ViewUpdate) {
				const view = update.view;
				const analysis = runtime.getNoteAnalysis?.(view, update);
				const changedNote = this.analysis !== analysis;
				this.analysis = analysis;
				const mode = analysisMode(view, runtime);
				const settingsChanged = changedNote || this.lastSettingsVersion !== runtime.settingsVersion || this.lastMode !== mode;
				const categoryCacheChanged = this.lastWordCategoryCacheVersion !== runtime.wordCategoryCacheVersion;
				if (!update.docChanged && !settingsChanged && !categoryCacheChanged) return;
				if (changedNote || this.lastMode !== mode) this.focusedLemma = null;
				this.lastMode = mode;
				this.lastSettingsVersion = runtime.settingsVersion;
				this.lastWordCategoryCacheVersion = runtime.wordCategoryCacheVersion;
				if (update.docChanged) runtime.updateAnalysisHighlights(view, [], true);
				if (this.timer !== null) window.clearTimeout(this.timer);
				if (mode === "none") {
					this.timer = null;
					this.decorations = Decoration.none;
					runtime.updateAnalysisHighlights(view, [], false);
					return;
				}
				// Un changement de réglages ou l'arrivée de nouvelles
				// catégories Grammalecte doit s'appliquer immédiatement ;
				// seule la frappe est debouncée pour éviter de ralentir la
				// saisie sur de longs documents.
				const delay = settingsChanged || categoryCacheChanged ? 0 : runtime.settings.debounceMs;
				this.timer = window.setTimeout(() => {
					this.decorations = buildDecorations(view, runtime, this.focusedLemma);
					// Force un re-rendu pour que CM6 relise `decorations`.
					view.dispatch({});
				}, delay);
			}
		},
		{
			decorations: (instance) => instance.decorations,
			eventHandlers: {
				mousedown(event: MouseEvent, view: EditorView) {
					if (analysisMode(view, runtime) !== "tic-ia" || event.button !== 0) return;
					const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
					if (position === null) return;
					// Le DOM peut être remplacé au placement du curseur en Live Preview.
					this.decorations.between(position, position, (from, to, decoration) => {
						const { attributes } = decoration.spec as { attributes?: Record<string, string> };
						const title = attributes?.title;
						if (from <= position && position < to && title) new Notice(`Tic IA : ${title}`, 8000);
					});
				},
			},
		}
	);
}
