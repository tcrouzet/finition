import { StateEffect, StateField, type Text } from "@codemirror/state";
import { showTooltip, type EditorView, type Tooltip } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type { AIGroup, AIGroupHost } from "./ai-extension";
import { splitIntoChunks } from "./chunk";
import { hasResponseText } from "./clean";

interface Paragraph { from: number; to: number; anchor: number }
type PreviewHost = Pick<AIGroupHost, "aiGroups" | "aiGroupsVersion" | "aiSourcePath">;
interface Preview extends Tooltip { from: number; to: number; host: PreviewHost; version: number; path: string | null }
const setPreview = StateEffect.define<Preview | null>();
export const paragraphPreview = StateField.define<Preview | null>({
	create: () => null,
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(setPreview)) return effect.value;
		if (transaction.docChanged || transaction.isUserEvent("input.finition-correction") || transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return null;
		if (value && (value.host.aiGroupsVersion !== value.version || transaction.state.field(editorInfoField, false)?.file?.path !== value.path)) return null;
		return value;
	},
	provide: field => showTooltip.from(field),
});

function paragraphs(document: Text): Paragraph[] {
	return splitIntoChunks(document.toString(), 0).flatMap(chunk => hasResponseText(chunk.text)
		? [{ from: chunk.start, to: chunk.end, anchor: chunk.start + chunk.text.search(/[^\s\p{Cf}]/u) }] : []);
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

export function paragraphPreviewRanges(document: Text, groups: AIGroup[]): Paragraph[] {
	if (!groups.length) return [];
	const ordered = [...groups].sort((a, b) => a.delFrom - b.delFrom);
	let index = 0;
	return paragraphs(document).flatMap(range => {
		while (index < ordered.length && ordered[index].delTo <= range.from && ordered[index].delFrom < range.from) index++;
		for (let cursor = index; cursor < ordered.length && ordered[cursor].delFrom <= range.to; cursor++) {
			if (touches(ordered[cursor], range.from, range.to, document.length)) return [range];
		}
		return [];
	});
}

export function toggleParagraphPreview(view: EditorView, host: PreviewHost, from: number, to: number): void {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > view.state.doc.length) return;
	const current = view.state.field(paragraphPreview, false);
	const text = correctedParagraph(view.state.doc, host.aiGroups, from, to);
	view.dispatch({ effects: setPreview.of(current?.from === from && current.to === to ? null : {
		from, to, host, version: host.aiGroupsVersion, path: host.aiSourcePath,
		pos: from + Math.max(0, view.state.doc.sliceString(from, to).search(/[^\s\p{Cf}]/u)), above: false,
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
