/**
 * Extension CM6 "Ortho-typo IA" : affiche les suggestions de correction en
 * attente (calculées par diff.ts) comme une simple coloration — texte
 * original barré en rouge, texte proposé inséré visuellement en vert à sa
 * suite (un widget, PAS du texte réel) — à la manière d'un commentaire.
 *
 * Le document n'est JAMAIS modifié automatiquement : un clic sur une
 * suggestion (sa partie rouge ou verte, peu importe) l'applique — et
 * SEULEMENT à ce moment le texte change réellement, via une transaction
 * CM6 classique. Tant que rien n'est cliqué, le fichier reste identique à
 * avant l'appel IA.
 *
 * L'état des suggestions en attente vit sur FinitionPlugin (`aiGroups`),
 * pas ici : cette extension se contente de le lire et d'y réagir, comme
 * editor-extension.ts le fait pour `settings`/`settingsVersion`.
 */

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

export interface AIGroup {
	id: number;
	delFrom: number;
	delTo: number;
	delText: string;
	insText: string | null;
}

/** Interface minimale requise de FinitionPlugin, pour éviter un import circulaire. */
export interface AIGroupHost {
	aiGroups: AIGroup[];
	aiGroupsVersion: number;
}

class InsertionWidget extends WidgetType {
	constructor(
		private readonly text: string,
		private readonly groupId: number
	) {
		super();
	}

	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "finition-ai-ins";
		span.textContent = this.text;
		span.dataset.finitionAiGroup = String(this.groupId);
		span.dataset.finitionAiAction = "accept";
		span.setAttribute("title", "Cliquer pour appliquer la correction");
		return span;
	}

	eq(other: InsertionWidget): boolean {
		return other.text === this.text && other.groupId === this.groupId;
	}
}

function buildAIDecorations(groups: AIGroup[]): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const sorted = [...groups].sort((a, b) => a.delFrom - b.delFrom || a.delTo - b.delTo);
	for (const g of sorted) {
		if (g.delFrom < g.delTo) {
			builder.add(
				g.delFrom,
				g.delTo,
				Decoration.mark({
					class: "finition-ai-del",
					attributes: {
						"data-finition-ai-group": String(g.id),
						"data-finition-ai-action": "reject",
						title: "Cliquer pour garder le texte original",
					},
				})
			);
		}
		if (g.insText) {
			builder.add(
				g.delTo,
				g.delTo,
				Decoration.widget({ widget: new InsertionWidget(g.insText, g.id), side: 1 })
			);
		}
	}
	return builder.finish();
}

export function finitionAIExtension(host: AIGroupHost) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private lastVersion: number;
			private readonly handleClick: (event: MouseEvent) => void;
			private readonly view: EditorView;

			constructor(view: EditorView) {
				this.view = view;
				this.lastVersion = host.aiGroupsVersion;
				this.decorations = buildAIDecorations(host.aiGroups);

				// Clic sur le VERT (proposition) : applique la correction, seule
				// vraie modification du document que fait cette extension. Clic
				// sur le ROUGE (texte original) : garde l'original tel quel, le
				// document n'est pas touché, la suggestion est juste écartée.
				this.handleClick = (event: MouseEvent) => {
					const target = event.target as HTMLElement | null;
					const marker = target?.closest<HTMLElement>("[data-finition-ai-group]");
					if (!marker) return;
					const id = Number(marker.dataset.finitionAiGroup);
					const action = marker.dataset.finitionAiAction;
					const group = host.aiGroups.find((g) => g.id === id);
					if (!group) return;
					if (action === "accept") {
						this.view.dispatch({ changes: { from: group.delFrom, to: group.delTo, insert: group.insText ?? "" } });
					}
					// action === "reject" : aucune transaction, le texte original reste.
					host.aiGroups = host.aiGroups.filter((g) => g.id !== id);
					host.aiGroupsVersion++;
					event.preventDefault();
				};
				view.dom.addEventListener("click", this.handleClick);
			}

			destroy(): void {
				this.view.dom.removeEventListener("click", this.handleClick);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged) {
					// Remappe les suggestions restantes après une édition
					// (validation d'une autre suggestion, frappe manuelle...) :
					// sans ça leurs positions deviendraient fausses.
					host.aiGroups = host.aiGroups
						.map((g) => ({
							...g,
							delFrom: update.changes.mapPos(g.delFrom, 1),
							delTo: update.changes.mapPos(g.delTo, -1),
						}))
						.filter((g) => g.delFrom <= g.delTo);
				}
				if (update.docChanged || this.lastVersion !== host.aiGroupsVersion) {
					this.lastVersion = host.aiGroupsVersion;
					this.decorations = buildAIDecorations(host.aiGroups);
				}
			}
		},
		{ decorations: (instance) => instance.decorations }
	);
}
