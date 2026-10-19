import { App, MarkdownView, Notice } from "obsidian";
import type { FinitionSettings } from "../types";
import { SynonymsModal } from "../ui/synonyms-modal";
import { createRemarkInsertion } from "../ui/insert-remark";
import { callAnthropic } from "./anthropic";
import { callOpenAI } from "./openai";
import { splitIntoChunks } from "./chunk";
import { detectProvider } from "./provider";
import systemPrompt from "./system-prompt-synonymes.md";

export function synonymContext(text: string, from: number, to: number): string {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > text.length || from >= to || !text.slice(from, to).trim()) {
		throw new Error("Sélectionne d’abord un texte.");
	}
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
	const provider = detectProvider(settings.aiModel);
	const apiKey = provider === "openai" ? settings.openaiApiKey : settings.aiApiKey;
	if (!apiKey) {
		new Notice(`Synonymes IA : renseigne ta clé API ${provider === "openai" ? "OpenAI" : "Anthropic"} dans Réglages → Finition.`);
		return;
	}
	const document = editor.getValue();
	const file = view.file;
	const from = editor.posToOffset(editor.getCursor("from"));
	const to = editor.posToOffset(editor.getCursor("to"));
	const insertRemark = createRemarkInsertion(app, view);
	const progress = new Notice("Synonymes IA : recherche en cours…", 0);
	try {
		const request = provider === "openai" ? callOpenAI : callAnthropic;
		const result = await request({ apiKey, model: settings.aiModel, maxTokens: settings.aiMaxTokens, system: systemPrompt, userText: synonymContext(document, from, to) });
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
		new Notice(`Synonymes IA : ${error instanceof Error ? error.message : String(error)}`, 10000);
	} finally {
		progress.hide();
	}
}
