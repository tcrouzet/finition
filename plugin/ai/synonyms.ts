import { App, MarkdownView, Notice } from "obsidian";
import type { FinitionSettings } from "../types";
import { SynonymsModal } from "../ui/synonyms-modal";
import { createRemarkInsertion } from "../ui/insert-remark";
import { callAnthropic } from "./anthropic";
import { callOpenAI } from "./openai";
import { callCodex } from "./codex";
import { splitIntoChunks } from "./chunk";
import { aiModelName, getAIConnection } from "./provider";
import { selectionTouchesLink } from "../markdown-links";
import { markdownExclusionRanges, maskMarkdownExclusions } from "../markdown-tags";
import systemPrompt from "./system-prompt-synonymes.md";
import { loadingMessage } from "../ui/loading-message";

let synonymRequest = 0;
let synonymProgress: Notice | null = null;

export function cancelSynonyms(): void {
	synonymRequest++;
	synonymProgress?.hide();
	synonymProgress = null;
}

export function synonymContext(text: string, from: number, to: number): string {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > text.length || from >= to || !text.slice(from, to).trim()) {
		throw new Error("Sélectionne d’abord un texte.");
	}
	if (markdownExclusionRanges(text).some(([start, end]) => from < end && to > start)) throw new Error("Sélectionne un texte hors du YAML et des tags.");
	text = maskMarkdownExclusions(text);
	const paragraphs = splitIntoChunks(text, 0).filter((paragraph) => paragraph.text.trim());
	const first = paragraphs.findIndex(({ end }) => from < end);
	const last = paragraphs.findIndex(({ end }) => to <= end);
	const start = paragraphs[Math.max(0, first - 1)].start;
	const end = paragraphs[Math.min(paragraphs.length - 1, last + 1)].end;
	return `${text.slice(start, from)}**${text.slice(from, to)}**${text.slice(to, end)}`;
}

export function parseSynonyms(text: string): string[] {
	const seen = new Set<string>();
	return text.split(/\r?\n/).flatMap((line) => {
		const synonym = line.match(/^\s*[-*+•]\s+(.+?)\s*$/u)?.[1];
		if (!synonym || seen.has(synonym.toLocaleLowerCase("fr"))) return [];
		seen.add(synonym.toLocaleLowerCase("fr"));
		return [synonym];
	});
}

export async function runSynonyms(app: App, settings: FinitionSettings): Promise<void> {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) { new Notice("Synonymes IA : ouvre une note et sélectionne un texte."); return; }
	const editor = view.editor;
	if (editor.listSelections().length !== 1 || !editor.getSelection().trim()) {
		new Notice("Synonymes IA : sélectionne un texte continu.");
		return;
	}
	let connection: ReturnType<typeof getAIConnection>;
	try { connection = getAIConnection(settings); }
	catch (error) {
		new Notice(`Synonymes IA : ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	const document = editor.getValue();
	const file = view.file;
	const from = editor.posToOffset(editor.getCursor("from"));
	const to = editor.posToOffset(editor.getCursor("to"));
	if (selectionTouchesLink(document, from, to)) { new Notice("Synonymes IA : sélectionne un texte hors des liens et des adresses web."); return; }
	const insertRemark = createRemarkInsertion(app, view);
	cancelSynonyms();
	const requestId = synonymRequest;
	const progressMessage = (model: string) => loadingMessage(`Synonymes IA · ${model} : recherche en cours…`);
	const progress = synonymProgress = new Notice(progressMessage(aiModelName(connection)), 0);
	try {
		const request = connection.provider === "codex" ? callCodex : connection.provider === "openai" ? callOpenAI : callAnthropic;
		const result = await request({ ...connection, maxTokens: settings.aiMaxTokens, system: systemPrompt, userText: synonymContext(document, from, to), onModel: model => { if (requestId === synonymRequest) progress.setMessage(progressMessage(`Codex · ${model}`)); } });
		if (requestId !== synonymRequest) return;
		if (result.error || typeof result.text !== "string") throw new Error(result.error ?? "Réponse vide.");
		const synonyms = parseSynonyms(result.text);
		if (!synonyms.length) throw new Error("Aucun synonyme dans la réponse.");
		new SynonymsModal(app, view, document.slice(from, to), synonyms, (synonym) => {
			if (app.workspace.getActiveViewOfType(MarkdownView) !== view || view.file !== file || view.editor !== editor || editor.getValue() !== document) {
				new Notice("La note ou le texte a changé. Relance la recherche.");
				return false;
			}
			editor.replaceRange(synonym, editor.offsetToPos(from), editor.offsetToPos(to));
			editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(from + synonym.length));
			return true;
		}, insertRemark).open();
	} catch (error) {
		if (requestId === synonymRequest) new Notice(`Synonymes IA : ${error instanceof Error ? error.message : String(error)}`, 10000);
	} finally {
		progress.hide();
		if (synonymProgress === progress) synonymProgress = null;
	}
}
