import { App, MarkdownView, Notice } from "obsidian";
import { splitIntoChunks } from "../ai/chunk";

export function createRemarkInsertion(app: App, view: MarkdownView): (text: string) => boolean {
	const editor = view.editor, file = view.file, document = editor.getValue();
	const from = editor.posToOffset(editor.getCursor("from")), to = editor.posToOffset(editor.getCursor("to"));
	const paragraph = splitIntoChunks(document, 0).find(chunk => to <= chunk.end);
	return text => {
		if (app.workspace.getActiveViewOfType(MarkdownView) !== view || view.file !== file || view.editor !== editor || editor.getValue() !== document) {
			new Notice("La note ou le texte a changé. Relance la recherche pour insérer la liste.");
			return false;
		}
		if (!paragraph || !text.trim()) return false;
		const end = paragraph.end - (paragraph.text.match(/(?:\r?\n[ \t]*)+$/u)?.[0].length ?? 0);
		const newline = document.includes("\r\n") ? "\r\n" : "\n";
		// Un délimiteur dans les résultats ne doit pas fermer la remarque.
		const content = text.replace(/%(?=%)/gu, "%\u200b").replace(/\r?\n/gu, newline);
		editor.replaceRange(`${newline}${newline}%%${newline}${content}${newline}%%${end === document.length ? newline : ""}`, editor.offsetToPos(end), editor.offsetToPos(end));
		editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(Math.min(to, end)));
		return true;
	};
}
