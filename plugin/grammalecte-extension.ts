/**
 * Intégration CM6 de Grammalecte : soulignement des erreurs (rouge ondulé =
 * orthographe, bleu ondulé = grammaire) + popup de suggestions au clic.
 *
 * Contrairement à Ortho-typo IA (une seule proposition, clic direct
 * accepter/rejeter), Grammalecte renvoie souvent PLUSIEURS suggestions par
 * erreur : on affiche donc une petite liste cliquable au survol/clic,
 * plutôt qu'une décoration verte appliquée directement.
 */

import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from "@codemirror/view";
import { RangeSetBuilder, ChangeDesc } from "@codemirror/state";
import type FinitionPlugin from "./main";
import type { GrammalecteError } from "./modes/grammalecte";

let activePopup: HTMLElement | null = null;
let activeOutsideClickHandler: ((evt: MouseEvent) => void) | null = null;

export function closeGrammalectePopup(): void {
	activePopup?.remove();
	activePopup = null;
	// Indispensable : sans ça, l'écouteur "clic en dehors" du popup précédent
	// reste attaché sur `document` indéfiniment. Au clic suivant (même pour
	// ouvrir un AUTRE popup), ce vieil écouteur se déclenche et referme le
	// nouveau popup aussitôt ouvert — d'où l'impression que "le clic ne fait
	// plus rien" à partir de la 2e erreur.
	if (activeOutsideClickHandler) {
		document.removeEventListener("mousedown", activeOutsideClickHandler);
		activeOutsideClickHandler = null;
	}
}

function openPopup(
	view: EditorView,
	err: GrammalecteError,
	coords: { left: number; bottom: number },
	onResolved: (err: GrammalecteError) => void,
	onAddToDictionary: (word: string) => void
): void {
	closeGrammalectePopup();

	const popup = createDiv();
	popup.className = "finition-grammalecte-popup";
	popup.style.left = `${coords.left}px`;
	popup.style.top = `${coords.bottom + 4}px`;

	const message = createDiv();
	message.className = "finition-grammalecte-popup-message";
	message.textContent = err.sMessage;
	popup.appendChild(message);

	if (err.aSuggestions.length > 0) {
		const list = createDiv();
		list.className = "finition-grammalecte-popup-suggestions";
		for (const suggestion of err.aSuggestions) {
			const btn = createEl("button");
			btn.textContent = suggestion;
			btn.addEventListener("click", () => {
				// On retire l'erreur AVANT de modifier le document : sinon elle
				// resterait en mémoire avec des positions devenues fausses dès
				// que le texte change de taille (cause du bug "le 2e clic ne
				// marche plus").
				onResolved(err);
				view.dispatch({ changes: { from: err.nStart, to: err.nEnd, insert: suggestion } });
				closeGrammalectePopup();
			});
			list.appendChild(btn);
		}
		popup.appendChild(list);
	}

	const actions = createDiv();
	actions.className = "finition-grammalecte-popup-actions";

	// "Ajouter au dictionnaire" : uniquement pour les erreurs d'orthographe
	// (mot isolé absent du dictionnaire, ex. nom propre ou néologisme) — une
	// erreur de grammaire porte sur un groupe de mots, pas un mot unique à
	// mémoriser comme "correct".
	if (err.sType === "orthographe" && err.sValue) {
		const dictBtn = createEl("button");
		dictBtn.className = "finition-grammalecte-popup-dictionary";
		dictBtn.textContent = "Ajouter au dictionnaire";
		dictBtn.addEventListener("click", () => {
			onAddToDictionary(err.sValue as string);
			closeGrammalectePopup();
		});
		actions.appendChild(dictBtn);
	}

	const ignoreBtn = createEl("button");
	ignoreBtn.className = "finition-grammalecte-popup-ignore";
	ignoreBtn.textContent = "Ignorer";
	ignoreBtn.addEventListener("click", () => {
		// "Ignorer" doit aussi faire disparaître le soulignement, sinon on
		// peut re-cliquer indéfiniment sur la même erreur sans jamais
		// pouvoir s'en débarrasser visuellement. Contrairement à "Ajouter au
		// dictionnaire", ça ne concerne QUE cette occurrence précise.
		onResolved(err);
		closeGrammalectePopup();
	});
	actions.appendChild(ignoreBtn);
	popup.appendChild(actions);

	document.body.appendChild(popup);
	activePopup = popup;

	// Ferme le popup si on clique ailleurs.
	const onDocClick = (evt: MouseEvent) => {
		if (!popup.contains(evt.target as Node)) {
			closeGrammalectePopup();
		}
	};
	activeOutsideClickHandler = onDocClick;
	window.setTimeout(() => { if (activePopup === popup) document.addEventListener("mousedown", onDocClick); }, 0);
}

/**
 * Remet à jour les positions de toutes les erreurs encore en attente après
 * une modification du document (CM6 ne le fait jamais automatiquement pour
 * des données qui vivent en dehors de ses propres structures de décoration).
 * Une erreur dont la plage a été entièrement avalée par l'édition (ex. la
 * correction qu'on vient d'appliquer) s'effondre à une position unique et
 * est supprimée.
 */
function remapAndPruneErrors(plugin: Pick<FinitionPlugin, "grammalecteErrors">, changes: ChangeDesc): void {
	plugin.grammalecteErrors = plugin.grammalecteErrors
		.map((err) => ({
			...err,
			nStart: changes.mapPos(err.nStart, 1),
			nEnd: changes.mapPos(err.nEnd, -1),
		}))
		.filter((err) => err.nEnd > err.nStart);
}

function buildDecorations(view: EditorView, plugin: FinitionPlugin, analysis: Pick<FinitionPlugin, "grammalecteErrors"> = plugin.getNoteAnalysis?.(view) ?? plugin): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const docLength = view.state.doc.length;
	const errors = [...analysis.grammalecteErrors].sort((a, b) => a.nStart - b.nStart);
	const highlights: { from: number; to: number }[] = [];

	const colorClass = `finition-color-${plugin.settings.grammalecteColorIndex}`;

	for (const err of errors) {
		if (err.nStart < 0 || err.nEnd > docLength || err.nStart >= err.nEnd) continue;
		highlights.push({ from: err.nStart, to: err.nEnd });
		const underlineClass = err.sType === "orthographe" ? "finition-grammalecte-spelling" : "finition-grammalecte-grammar";
		builder.add(
			err.nStart,
			err.nEnd,
			Decoration.mark({
				class: `${underlineClass} ${colorClass}`,
				attributes: { "data-finition-grammalecte-id": String(analysis.grammalecteErrors.indexOf(err)) },
			})
		);
	}
	plugin.updateGrammalecteHighlights(view, highlights);
	return builder.finish();
}

export function finitionGrammalecteExtension(plugin: FinitionPlugin) {
	return ViewPlugin.fromClass(
		class {
			analysis: Pick<FinitionPlugin, "grammalecteErrors" | "grammalecteErrorsVersion">;
			decorations: DecorationSet;
			lastVersion = -1;
			lastSettingsVersion = -1;

			constructor(view: EditorView) {
				this.analysis = plugin.getNoteAnalysis?.(view) ?? plugin;
				this.decorations = buildDecorations(view, plugin, this.analysis);
				this.lastVersion = this.analysis.grammalecteErrorsVersion;
				this.lastSettingsVersion = plugin.settingsVersion;
			}

			update(update: ViewUpdate): void {
				const previous = this.analysis;
				this.analysis = plugin.getNoteAnalysis?.(update.view, update) ?? plugin;
				if (update.docChanged) {
					if (!plugin.getNoteAnalysis) remapAndPruneErrors(this.analysis, update.changes);
					this.decorations = buildDecorations(update.view, plugin, this.analysis);
					this.lastVersion = this.analysis.grammalecteErrorsVersion;
				} else if (
					previous !== this.analysis || this.analysis.grammalecteErrorsVersion !== this.lastVersion ||
					plugin.settingsVersion !== this.lastSettingsVersion
				) {
					// settingsVersion change notamment quand on modifie la couleur
					// de fond de Grammalecte dans les réglages (Palette) : sans ce
					// deuxième déclencheur, il aurait fallu taper un caractère pour
					// voir la nouvelle couleur s'appliquer.
					this.lastVersion = this.analysis.grammalecteErrorsVersion;
					this.lastSettingsVersion = plugin.settingsVersion;
					this.decorations = buildDecorations(update.view, plugin, this.analysis);
				}
			}
		},
		{
			decorations: (v) => v.decorations,
			eventHandlers: {
				mousedown(evt: MouseEvent, view: EditorView) {
					const target = evt.target as HTMLElement;
					const idAttr = target.getAttribute?.("data-finition-grammalecte-id");
					if (idAttr === null || idAttr === undefined) return;
					const analysis = plugin.getNoteAnalysis?.(view) ?? plugin;
					const err = analysis.grammalecteErrors[Number(idAttr)];
					if (!err) return;
					evt.preventDefault();
					const rect = target.getBoundingClientRect();
					openPopup(
						view,
						err,
						{ left: rect.left, bottom: rect.bottom },
						(resolvedErr) => {
							const idx = analysis.grammalecteErrors.indexOf(resolvedErr);
							if (idx !== -1) analysis.grammalecteErrors.splice(idx, 1);
							analysis.grammalecteErrorsVersion++;
							plugin.refreshAllEditors();
						},
						(word) => {
							void plugin.addWordToGrammalecteDictionary(word, view);
						}
					);
				},
			},
		}
	);
}
