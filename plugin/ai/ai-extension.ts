/**
 * Extension CM6 "Corrections IA" : affiche les suggestions de correction en
 * attente (calculées par diff.ts) comme une simple coloration — texte
 * original barré en rouge, texte proposé inséré visuellement en vert à sa
 * suite (un widget, PAS du texte réel) — à la manière d'un commentaire.
 *
 * Le document n'est JAMAIS modifié automatiquement : un clic sur une
 * proposition verte ou sur la coche l'applique. Le rouge conserve
 * l'original et écarte la suggestion. Tant que rien n'est cliqué, le
 * fichier reste identique à avant l'appel IA.
 *
 * L'état des suggestions en attente vit sur FinitionPlugin (`aiGroups`),
 * pas ici : cette extension se contente de le lire et d'y réagir, comme
 * editor-extension.ts le fait pour `settings`/`settingsVersion`.
 */

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { editorInfoField, setIcon } from "obsidian";

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
	aiSourcePath: string | null;
}

class InsertionWidget extends WidgetType {
	constructor(
		private readonly text: string | null,
		private readonly groupId: number
	) {
		super();
	}

	toDOM(): HTMLElement {
		const span = this.text === null ? createEl("button", { cls: "clickable-icon finition-ai-delete", attr: { type: "button", "aria-label": "Valider la suppression" } }) : createSpan();
		if (this.text === null) setIcon(span, "check");
		else { span.className = "finition-ai-ins"; span.textContent = this.text; }
		span.dataset.finitionAiGroup = String(this.groupId);
		span.dataset.finitionAiAction = "accept";
		span.setAttribute("title", this.text === null ? "Valider la suppression" : "Cliquer pour appliquer la correction");
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
		if (g.insText || g.delFrom < g.delTo) {
			builder.add(
				g.delTo,
				g.delTo,
				Decoration.widget({ widget: new InsertionWidget(g.insText || null, g.id), side: 1 })
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
			private sourceView: boolean;
			private readonly handleClick: (event: MouseEvent) => void;
			private readonly view: EditorView;

			constructor(view: EditorView) {
				this.view = view;
				this.lastVersion = host.aiGroupsVersion;
				this.sourceView = this.isSourceView();
				this.decorations = this.sourceView ? buildAIDecorations(host.aiGroups) : Decoration.none;

				// Clic sur le VERT (proposition) : applique la correction, seule
				// vraie modification du document que fait cette extension. Clic
				// sur le ROUGE (texte original) : garde l'original tel quel, le
				// document n'est pas touché, la suggestion est juste écartée.
				this.handleClick = (event: MouseEvent) => {
					if (!this.isSourceView()) return;
					const target = event.target as HTMLElement | null;
					const marker = target?.closest<HTMLElement>("[data-finition-ai-group]");
					if (!marker) return;
					const id = Number(marker.dataset.finitionAiGroup);
					const action = marker.dataset.finitionAiAction;
					const group = host.aiGroups.find((g) => g.id === id);
					if (!group) return;
					host.aiGroups = host.aiGroups.filter((g) => g.id !== id);
					host.aiGroupsVersion++;
					if (action === "accept") {
						this.view.dispatch({ changes: { from: group.delFrom, to: group.delTo, insert: group.insText ?? "" } });
					} else this.view.dispatch({});
					event.preventDefault();
				};
				view.dom.addEventListener("click", this.handleClick);
			}

			destroy(): void {
				this.view.dom.removeEventListener("click", this.handleClick);
			}

			private isSourceView(): boolean {
				return host.aiSourcePath !== null && this.view.state.field(editorInfoField, false)?.file?.path === host.aiSourcePath;
			}

			update(update: ViewUpdate): void {
				const wasSource = this.sourceView;
				this.sourceView = this.isSourceView();
				if (!this.sourceView) {
					this.decorations = Decoration.none;
					this.lastVersion = -1;
					return;
				}
				if (update.docChanged && wasSource) {
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
