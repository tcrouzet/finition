import { App, MarkdownView, Modal, Notice, setIcon } from "obsidian";
import { dictionaryKeys, isSynonymWord, SynonymsDictionary, type DictionaryLemmas, type SynonymGroup } from "../synonyms";
import type { DictionaryRow } from "../dictionaries";
import { SynonymsModal } from "./synonyms-modal";
import { createRemarkInsertion } from "./insert-remark";
import { mergeRanges, selectionTouchesLink } from "../markdown-links";
import { markdownExclusionRanges } from "../markdown-tags";
import { tokenize } from "../modes/tokenize";
import { LoadingNotice } from "./loading-message";

export async function runLocalSynonyms(app: App, dictionary: SynonymsDictionary): Promise<void> {
	await runLocalWordLookup(app, "Synonymes", async word => ({ groups: await dictionary.lookupGroups(word) }));
}

export async function runLocalWordLookup(app: App, title: string, lookup: (word: string) => Promise<{ groups?: SynonymGroup[]; rows?: DictionaryRow[]; description?: string; citationLexicon?: DictionaryLemmas }>): Promise<void> {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view || view.editor.listSelections().length !== 1 || !isSynonymWord(view.editor.getSelection())) {
		new Notice(`${title} : sélectionne un seul mot.`);
		return;
	}
	const editor = view.editor;
	const document = editor.getValue();
	const file = view.file;
	const from = editor.posToOffset(editor.getCursor("from"));
	const to = editor.posToOffset(editor.getCursor("to"));
	const selected = document.slice(from, to);
	if (markdownExclusionRanges(document).some(([start, end]) => from < end && to > start)) { new Notice(`${title} : sélectionne un mot hors du YAML et des tags.`); return; }
	if (selectionTouchesLink(document, from, to)) { new Notice(`${title} : sélectionne un mot hors des liens et des adresses web.`); return; }
	const insertRemark = createRemarkInsertion(app, view);
	const notice = new LoadingNotice(`${title} : recherche en cours…`);
	try {
		const { groups = [], rows = [], description, citationLexicon } = await lookup(selected);
		if (notice.cancelled) return;
		const words = groups.flatMap(group => group.words);
		if (!words.length && !rows.length) { new Notice(`${title} : aucun résultat pour « ${selected} ».`); return; }
		if (rows.length) {
			new WordInformationModal(app, view, selected, title, rows, insertRemark, description, citationLexicon).open();
			return;
		}
		new SynonymsModal(app, view, selected, words, word => {
			if (app.workspace.getActiveViewOfType(MarkdownView) !== view || view.file !== file || view.editor !== editor || editor.getValue() !== document) {
				new Notice("La note ou le texte a changé. Relance la recherche.");
				return false;
			}
			editor.replaceRange(word, editor.offsetToPos(from), editor.offsetToPos(to));
			editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(from + word.length));
			return true;
		}, insertRemark, title, groups).open();
	} catch (error) {
		if (notice.cancelled) return;
		new Notice(`${title} : ${error instanceof Error ? error.message : String(error)}`, 10000);
	} finally {
		notice.hide();
	}
}

class WordInformationModal extends Modal {
	private restoreFocus: () => void;
	constructor(app: App, view: MarkdownView, private word: string, private title: string, private rows: DictionaryRow[], private insertRemark: (text: string) => boolean, private description?: string, private citationLexicon?: DictionaryLemmas) {
		super(app);
		this.shouldRestoreSelection = false;
		const editor = view.editor, file = view.file;
		this.restoreFocus = () => { if (app.workspace.getActiveViewOfType(MarkdownView) === view && view.editor === editor && view.file === file) editor.focus(); };
	}
	open(): void {
		super.open();
		this.contentEl.tabIndex = -1;
		this.contentEl.focus({ preventScroll: true });
	}
	private paragraph(text: string, cls?: string, citation = true): void {
		const paragraph = this.contentEl.createEl("p", { text, cls });
		const lexicon = this.citationLexicon;
		if (!citation || !lexicon) return;
		const keys = new Set(dictionaryKeys(this.word, lexicon));
		const tokens = [...tokenize(text, lexicon.lemmas), ...Array.from(text.matchAll(/\p{L}[\p{L}\p{M}]*(?:['’ʼ\-‑][\p{L}\p{M}]+)*/gu), match => ({ form: match[0], lemma: match[0], start: match.index, end: match.index + match[0].length }))];
		const ranges = mergeRanges(tokens.filter(token => [token.form, token.lemma].some(word => dictionaryKeys(word, lexicon).some(key => keys.has(key)))).map(token => [token.start, token.end]));
		if (!ranges.length) return;
		paragraph.empty();
		let cursor = 0;
		for (const [from, to] of ranges) {
			paragraph.appendText(text.slice(cursor, from));
			paragraph.createEl("strong", { text: text.slice(from, to) });
			cursor = to;
		}
		paragraph.appendText(text.slice(cursor));
	}
	onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.classList.add("finition-synonyms-content", "finition-word-information");
		this.contentEl.createEl("p", { text: this.word, cls: "finition-synonyms-selection" });
		if (this.description) this.contentEl.createEl("p", { text: this.description });
		let previousLabel = "";
		for (const row of this.rows) {
			if (row.label && row.label !== previousLabel) this.contentEl.createEl("h3", { text: row.label, cls: "finition-synonyms-category" });
			previousLabel = row.label ?? "";
			if (row.text) this.paragraph(row.text, undefined, !row.examples?.length);
			if (row.words?.length) this.contentEl.createEl("p", { text: row.words.join(", ") });
			for (const example of row.examples ?? []) this.paragraph(example, "finition-dictionary-example");
		}
		const footer = this.modalEl.createDiv({ cls: "modal-button-container finition-synonyms-footer" });
		const button = footer.createEl("button", { cls: "clickable-icon finition-synonyms-insert", attr: { "aria-label": "Insérer la liste en remarque", title: "Insérer la liste en remarque" } });
		setIcon(button, "message-square-plus");
		button.addEventListener("click", () => {
			const text = [this.word, this.description, ...this.rows.map(row => [row.label, row.text, ...(row.words ?? []), ...(row.examples ?? [])].filter(Boolean).join("\n"))].filter(Boolean).join("\n\n");
			if (this.insertRemark(text)) this.close();
		});
	}
	onClose(): void {
		this.contentEl.empty();
		this.modalEl.querySelector(".finition-synonyms-footer")?.remove();
		this.restoreFocus();
	}
}
