import { StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, showTooltip, WidgetType, type EditorView, type Tooltip } from "@codemirror/view";
import { setIcon } from "obsidian";
import type { AIGroup } from "./ai-extension";
import { splitIntoChunks } from "./chunk";
import { hasResponseText } from "./clean";

interface Paragraph { from: number; to: number; anchor: number }
interface Preview extends Tooltip { from: number; to: number }
const setPreview = StateEffect.define<Preview | null>();
export const paragraphPreview = StateField.define<Preview | null>({
	create: () => null,
	update(_value, transaction) {
		for (const effect of transaction.effects) if (effect.is(setPreview)) return effect.value;
		return null;
	},
	provide: field => showTooltip.from(field),
});

function paragraphs(document: Text): Paragraph[] {
	return splitIntoChunks(document.toString(), 0).flatMap(chunk => hasResponseText(chunk.text)
		? [{ from: chunk.start, to: chunk.end, anchor: chunk.start + chunk.text.replace(/[\s\p{Cf}]+$/u, "").length }] : []);
}

function touches(group: AIGroup, from: number, to: number, length: number): boolean {
	return group.delFrom === group.delTo ? group.delFrom >= from && (group.delFrom < to || group.delFrom === length && to === length) : group.delFrom < to && group.delTo > from;
}

export function correctedParagraph(document: Text, groups: AIGroup[], from: number, to: number): string {
	const ranges = paragraphs(document);
	let previousFrom: number, previousTo: number;
	do {
		previousFrom = from; previousTo = to;
		for (const group of groups) if (touches(group, from, to, document.length)) {
			if (group.delFrom < from) from = ranges.find(range => group.delFrom >= range.from && group.delFrom < range.to)?.from ?? group.delFrom;
			if (group.delTo > to) to = ranges.find(range => group.delTo > range.from && group.delTo <= range.to)?.to ?? group.delTo;
		}
	} while (from !== previousFrom || to !== previousTo);
	let text = document.sliceString(from, to);
	for (const group of [...groups].sort((a, b) => b.delFrom - a.delFrom || b.delTo - a.delTo)) if (touches(group, from, to, document.length)) {
		text = text.slice(0, group.delFrom - from) + (group.insText ?? "") + text.slice(group.delTo - from);
	}
	return text.replace(/[\s\p{Cf}]+$/u, "");
}

class PreviewWidget extends WidgetType {
	constructor(private readonly from: number, private readonly to: number) { super(); }
	eq(other: PreviewWidget): boolean { return other.from === this.from && other.to === this.to; }
	toDOM(): HTMLElement {
		const button = createEl("button", { cls: "clickable-icon finition-ai-preview-toggle", attr: { type: "button", "aria-label": "Voir le paragraphe corrigé", title: "Voir le paragraphe corrigé" } });
		button.dataset.finitionAiPreviewFrom = String(this.from);
		button.dataset.finitionAiPreviewTo = String(this.to);
		setIcon(button, "eye");
		return button;
	}
}

export function paragraphPreviewDecorations(document: Text, groups: AIGroup[]) {
	if (!groups.length) return [];
	const ordered = [...groups].sort((a, b) => a.delFrom - b.delFrom);
	let index = 0;
	return paragraphs(document).flatMap(range => {
		while (index < ordered.length && ordered[index].delTo <= range.from && ordered[index].delFrom < range.from) index++;
		for (let cursor = index; cursor < ordered.length && ordered[cursor].delFrom <= range.to; cursor++) {
			if (touches(ordered[cursor], range.from, range.to, document.length)) return [Decoration.widget({ widget: new PreviewWidget(range.from, range.to), side: 9 }).range(range.anchor)];
		}
		return [];
	});
}

export function toggleParagraphPreview(view: EditorView, groups: AIGroup[], from: number, to: number): void {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > view.state.doc.length) return;
	const current = view.state.field(paragraphPreview, false);
	const text = correctedParagraph(view.state.doc, groups, from, to);
	view.dispatch({ effects: setPreview.of(current?.from === from && current.to === to ? null : {
		from, to, pos: from + view.state.doc.sliceString(from, to).replace(/[\s\p{Cf}]+$/u, "").length, above: true,
		create() {
			const dom = createDiv({ cls: "finition-ai-paragraph-preview", attr: { role: "tooltip", "aria-label": "Paragraphe corrigé", "aria-live": "polite" } });
			dom.textContent = text || "Paragraphe supprimé.";
			return { dom };
		},
	}) });
}

export function closeParagraphPreview(view: EditorView): boolean {
	if (!view.state.field(paragraphPreview, false)) return false;
	view.dispatch({ effects: setPreview.of(null) });
	return true;
}
