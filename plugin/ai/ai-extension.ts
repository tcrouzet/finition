/**
 * Extension CM6 "Corrections IA" : affiche les suggestions de correction en
 * attente (calculées par diff.ts) comme une simple coloration — texte
 * original barré en rouge, texte proposé inséré visuellement en vert à sa
 * suite (un widget, PAS du texte réel) — à la manière d'un commentaire.
 *
 * Le document n'est JAMAIS modifié automatiquement : un clic sur le
 * rouge ou le vert applique la correction. La poubelle
 * refuse la proposition. Tant que rien
 * n'est cliqué, le fichier reste identique à avant l'appel IA.
 *
 * L'état des suggestions en attente vit sur FinitionPlugin (`aiGroups`),
 * pas ici : cette extension se contente de le lire et d'y réagir, comme
 * editor-extension.ts le fait pour `settings`/`settingsVersion`.
 */

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder, type Range, type Text } from "@codemirror/state";
import { editorInfoField, setIcon } from "obsidian";
import { applyCorrectionHistory, correctionHistory, resolveCorrection } from "./correction-history";
import { closeParagraphPreview, paragraphPreview } from "./paragraph-preview";
import { whitespaceDisplay } from "./whitespace-display";

export interface AIGroup {
	id: number;
	delFrom: number;
	delTo: number;
	delText: string;
	insText: string | null;
}

/** Interface minimale requise de FinitionPlugin, pour éviter un import circulaire. */
export interface AIGroupHost {
	getNoteAnalysis?: (view: EditorView, update?: ViewUpdate) => AIGroupHost;
	aiGroups: AIGroup[];
	aiGroupsVersion: number;
	aiSourcePath: string | null;
}

class CorrectionWidget extends WidgetType {
	constructor(
		private readonly text: string,
		private readonly groupId: number,
		private readonly kind: "insert" | "delete" | "reject" = "insert"
	) {
		super();
	}

	get lineBreaks(): number { return this.kind === "reject" ? 0 : this.text.split("\n").length - 1; }

	toDOM(): HTMLElement {
		const label = this.kind === "reject" ? "Refuser la correction" : "Accepter la correction";
		const span = this.kind === "reject" ? createEl("button", { cls: "clickable-icon finition-ai-reject", attr: { type: "button", "aria-label": label } }) : createSpan({ attr: { role: "button", tabindex: "0", "aria-label": label } });
		if (this.kind === "reject") setIcon(span, "trash-2");
		else { span.className = this.kind === "delete" ? "finition-ai-del" : "finition-ai-ins"; span.textContent = this.text; }
		span.dataset.finitionAiGroup = String(this.groupId);
		span.dataset.finitionAiAction = this.kind === "reject" ? "reject" : "accept";
		span.setAttribute("title", label);
		return span;
	}

	eq(other: CorrectionWidget): boolean {
		return other.text === this.text && other.groupId === this.groupId && other.kind === this.kind;
	}
}

function buildAIDecorations(groups: AIGroup[], document: Text): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const whitespace: Range<Decoration>[] = [];
	const sorted = [...groups].sort((a, b) => a.delFrom - b.delFrom || a.delTo - b.delTo);
	for (const g of sorted) {
		const display = whitespaceDisplay(document, g);
		if (display) {
			if (display.removed) whitespace.push(Decoration.widget({ widget: new CorrectionWidget(display.removed, g.id, "delete"), side: 4 }).range(display.anchor));
			if (display.added) whitespace.push(Decoration.widget({ widget: new CorrectionWidget(display.added, g.id), side: 5 }).range(display.anchor));
			whitespace.push(Decoration.widget({ widget: new CorrectionWidget("", g.id, "reject"), side: 6 }).range(display.anchor));
			continue;
		}
		if (g.delFrom < g.delTo) {
			builder.add(
				g.delFrom,
				g.delTo,
				Decoration.mark({
					class: "finition-ai-del",
					attributes: {
						"data-finition-ai-group": String(g.id),
						"data-finition-ai-action": "accept",
						title: "Cliquer pour appliquer la correction",
						role: "button", tabindex: "0", "aria-label": "Accepter la correction",
					},
				})
			);
		}
		if (g.insText) builder.add(g.delTo, g.delTo, Decoration.widget({ widget: new CorrectionWidget(g.insText, g.id), side: 1 }));
		if (g.insText || g.delFrom < g.delTo) {
			builder.add(g.delTo, g.delTo, Decoration.widget({ widget: new CorrectionWidget("", g.id, "reject"), side: 2 }));
		}
	}
	return builder.finish().update({ add: whitespace, sort: true });
}

export function finitionAIExtension(host: AIGroupHost) {
	return ViewPlugin.fromClass(
		class {
			private host: AIGroupHost;
			decorations: DecorationSet;
			private lastVersion: number;
			private sourceView: boolean;
			private readonly handleClick: (event: Event) => void;
			private readonly handleKeyDown: (event: KeyboardEvent) => void;
			private readonly view: EditorView;

			constructor(view: EditorView) {
				this.view = view;
				this.host = host.getNoteAnalysis?.(view) ?? host;
				this.lastVersion = this.host.aiGroupsVersion;
				this.sourceView = this.isSourceView();
				this.decorations = this.sourceView ? buildAIDecorations(this.host.aiGroups, view.state.doc) : Decoration.none;

				this.handleClick = (event: Event) => {
					if (!this.isSourceView()) return;
					const target = event.target as HTMLElement | null;
					const marker = target?.closest<HTMLElement>("[data-finition-ai-group]");
					if (!marker) return;
					const id = Number(marker.dataset.finitionAiGroup);
					const action = marker.dataset.finitionAiAction;
					const group = this.host.aiGroups.find((g) => g.id === id);
					if (!group) return;
					this.view.dispatch(resolveCorrection(this.host, group, action === "accept"));
					this.view.focus();
					event.preventDefault();
				};
				this.handleKeyDown = event => {
					if (event.key === "Escape" && closeParagraphPreview(this.view)) { event.preventDefault(); event.stopPropagation(); return; }
					if (event.key !== "Enter" && event.key !== " ") return;
					if (!(event.target as HTMLElement | null)?.closest(".finition-ai-del, .finition-ai-ins")) return;
					this.handleClick(event);
					event.stopPropagation();
				};
				view.dom.addEventListener("click", this.handleClick);
				view.dom.addEventListener("keydown", this.handleKeyDown, true);
			}

			destroy(): void {
				this.view.dom.removeEventListener("click", this.handleClick);
				this.view.dom.removeEventListener("keydown", this.handleKeyDown, true);
			}

			private isSourceView(): boolean {
				return this.host.aiSourcePath !== null && this.view.state.field(editorInfoField, false)?.file?.path === this.host.aiSourcePath;
			}

			update(update: ViewUpdate): void {
				const wasSource = this.sourceView;
				const previousHost = this.host;
				this.host = host.getNoteAnalysis?.(this.view, update) ?? host;
				this.sourceView = this.isSourceView();
				if (!this.sourceView) {
					this.decorations = Decoration.none;
					this.lastVersion = -1;
					return;
				}
				if (update.docChanged && wasSource && !host.getNoteAnalysis) {
					// Remappe les suggestions restantes après une édition
					// (validation d'une autre suggestion, frappe manuelle...) :
					// sans ça leurs positions deviendraient fausses.
					this.host.aiGroups = this.host.aiGroups
						.map((g) => ({
							...g,
							delFrom: update.changes.mapPos(g.delFrom, 1),
							delTo: update.changes.mapPos(g.delTo, -1),
						}))
						.filter((g) => g.delFrom <= g.delTo);
				}
				applyCorrectionHistory(this.host, update.transactions ?? [], this.view.state.doc);
				if (update.docChanged || previousHost !== this.host || this.lastVersion !== this.host.aiGroupsVersion) {
					this.lastVersion = this.host.aiGroupsVersion;
					this.decorations = buildAIDecorations(this.host.aiGroups, this.view.state.doc);
				}
			}
		},
		{ decorations: (instance) => instance.decorations, provide: () => [correctionHistory, paragraphPreview] }
	);
}
