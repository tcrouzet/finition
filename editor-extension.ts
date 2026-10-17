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
import { RangeSetBuilder } from "@codemirror/state";
import { FinitionRuntime, Highlight } from "./types";
import { computeRepetitions } from "./modes/repetition";
import { computeHedgingHighlights } from "./modes/hedging";
import { computeStereotypeHighlights } from "./modes/stereotype";
import { computeBurstinessHighlights } from "./modes/burstiness";
import { computeTernaryHighlights } from "./modes/ternary";
import { computeCadenceHighlights, computeCadenceHighlightsStructural } from "./modes/cadence";
import { structureCategoryWords } from "./modes/structure-signature";
import { computeHingeHighlights } from "./modes/hinges";

/** Classe CSS appliquée aux occurrences du lemme actuellement sélectionné au clic. */
const FOCUS_CLASS = "finition-focused";

function buildDecorations(view: EditorView, runtime: FinitionRuntime, focusedLemma: string | null): DecorationSet {
	const text = view.state.doc.toString();
	if (text.length > runtime.settings.maxDocumentLength) return Decoration.none;

	let highlights: Highlight[];
	let cssClass: (highlight: Highlight) => string;

	if (runtime.settings.mode === "repetition") {
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
	} else if (runtime.settings.mode === "hedging") {
		highlights = computeHedgingHighlights(text, runtime.hedgingPhrases);
		cssClass = (highlight) => {
			const base = `finition-hedging finition-color-${runtime.settings.hedgingColorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (runtime.settings.mode === "stereotype") {
		highlights = computeStereotypeHighlights(text, runtime.lexicon, runtime.functionWords, runtime.stereotypePatterns);
		cssClass = (highlight) => {
			const base = `finition-stereotype finition-color-${runtime.settings.stereotypeColorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (runtime.settings.mode === "burstiness") {
		highlights = computeBurstinessHighlights(text, runtime.settings.burstThreshold, runtime.settings.burstTolerancePercent);
		cssClass = (highlight) => {
			const base = `finition-burst finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (runtime.settings.mode === "ternary") {
		// Même mécanisme que Cadence (moteur "Grammalecte") : les catégories
		// manquantes sont résolues de façon asynchrone par le Worker
		// Grammalecte (voir FinitionRuntime.ensureWordCategories dans
		// main.ts) — tant qu'un mot n'est pas encore dans le cache, on le
		// traite comme catégorie inconnue (""), et le regroupement se
		// complète tout seul, sans bloquer la frappe, dès que le Worker a
		// répondu (via un refreshAllEditors()).
		const getCategory = (word: string) => runtime.wordCategoryCache.get(word.toLowerCase()) ?? "";
		highlights = computeTernaryHighlights(text, getCategory);

		runtime.ensureWordCategories(structureCategoryWords(text));

		cssClass = (highlight) => {
			// Une couleur par tricolon détecté (comme Cadence/Répétitions),
			// pas une seule couleur fixe pour tout le monde : sinon deux
			// tricolons voisins seraient indiscernables l'un de l'autre.
			const base = `finition-ternary finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (runtime.settings.mode === "cadence") {
		if (runtime.settings.cadenceEngine === "grammalecte") {
			// Les catégories manquantes sont résolues de façon asynchrone par
			// le Worker Grammalecte (voir FinitionRuntime.ensureWordCategories
			// dans main.ts) : tant qu'un mot n'est pas encore dans le cache,
			// on le traite comme catégorie inconnue ("") — le regroupement se
			// complète tout seul, sans bloquer la frappe, dès que le Worker a
			// répondu (via un refreshAllEditors()).
			const getCategory = (word: string) => runtime.wordCategoryCache.get(word.toLowerCase()) ?? "";
			highlights = computeCadenceHighlightsStructural(text, runtime.settings.cadenceSpan, getCategory);

			runtime.ensureWordCategories(structureCategoryWords(text));
		} else {
			highlights = computeCadenceHighlights(text, runtime.settings.cadenceSpan, runtime.syntaxHinges);
		}
		cssClass = (highlight) => {
			const base = `finition-cadence finition-color-${highlight.colorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else if (runtime.settings.mode === "hinges") {
		highlights = computeHingeHighlights(text, runtime.syntaxHinges);
		cssClass = (highlight) => {
			const base = `finition-hinge finition-color-${runtime.settings.hingeColorIndex}`;
			return highlight.lemma === focusedLemma ? `${base} ${FOCUS_CLASS}` : base;
		};
	} else {
		return Decoration.none;
	}

	highlights.sort((a, b) => a.from - b.from);
	const builder = new RangeSetBuilder<Decoration>();
	for (const highlight of highlights) {
		builder.add(
			highlight.from,
			highlight.to,
			Decoration.mark({
				class: cssClass(highlight),
				// data-finition-lemma permet d'identifier, au clic, quel groupe
				// de répétition sélectionner (voir handleClick ci-dessous).
				attributes: { title: highlight.lemma, "data-finition-lemma": highlight.lemma },
			})
		);
	}
	return builder.finish();
}

/** Construit l'extension CM6 à enregistrer via `plugin.registerEditorExtension(...)`. */
export function finitionEditorExtension(runtime: FinitionRuntime) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private timer: number | null = null;
			// Permet de détecter un changement de réglages (mode, empan,
			// mots-outils...) même quand le document lui-même ne change pas :
			// sans ça, décocher un mode ne faisait rien tant qu'on ne tapait
			// pas un caractère (le `update()` ne se déclenchait que sur
			// `docChanged`).
			private lastSettingsVersion: number;
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
				this.lastSettingsVersion = runtime.settingsVersion;
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
				this.view.dom.removeEventListener("click", this.handleClick);
			}

			update(update: ViewUpdate) {
				const settingsChanged = this.lastSettingsVersion !== runtime.settingsVersion;
				const categoryCacheChanged = this.lastWordCategoryCacheVersion !== runtime.wordCategoryCacheVersion;
				if (!update.docChanged && !settingsChanged && !categoryCacheChanged) return;
				this.lastSettingsVersion = runtime.settingsVersion;
				this.lastWordCategoryCacheVersion = runtime.wordCategoryCacheVersion;
				const view = update.view;
				if (this.timer !== null) window.clearTimeout(this.timer);
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
		}
	);
}
