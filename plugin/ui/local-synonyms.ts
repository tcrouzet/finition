import { App, MarkdownView, Modal, Notice, setIcon } from "obsidian";
import { isSynonymWord, SynonymsDictionary, type SynonymGroup } from "../synonyms";
import type { DictionaryRow } from "../dictionaries";
import { SynonymsModal } from "./synonyms-modal";
import { createRemarkInsertion } from "./insert-remark";
import { selectionTouchesLink } from "../markdown-links";

export async function runLocalSynonyms(app: App, dictionary: SynonymsDictionary): Promise<void> {
	await runLocalWordLookup(app, "Synonyme", async word => ({ groups: await dictionary.lookupGroups(word) }));
}

export async function runLocalWordLookup(app: App, title: string, lookup: (word: string) => Promise<{ groups?: SynonymGroup[]; rows?: DictionaryRow[]; description?: string }>): Promise<void> {
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
	if (selectionTouchesLink(document, from, to)) { new Notice(`${title} : sélectionne un mot hors des liens et des adresses web.`); return; }
	const insertRemark = createRemarkInsertion(app, view);
	const notice = new Notice(`${title}…`, 0);
	try {
		const { groups = [], rows = [], description } = await lookup(selected);
		const words = groups.flatMap(group => group.words);
		if (!words.length && !rows.length) { new Notice(`${title} : aucun résultat pour « ${selected} ».`); return; }
		if (rows.length) {
			new WordInformationModal(app, view, selected, title, rows, insertRemark, description).open();
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
		new Notice(`${title} : ${error instanceof Error ? error.message : String(error)}`, 10000);
	} finally {
		notice.hide();
	}
}

class WordInformationModal extends Modal {
	private restoreFocus: () => void;
	constructor(app: App, view: MarkdownView, private word: string, private title: string, private rows: DictionaryRow[], private insertRemark: (text: string) => boolean, private description?: string) {
		super(app);
		this.shouldRestoreSelection = false;
		const editor = view.editor, file = view.file;
		this.restoreFocus = () => { if (app.workspace.getActiveViewOfType(MarkdownView) === view && view.editor === editor && view.file === file) editor.focus(); };
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
			if (row.text) this.contentEl.createEl("p", { text: row.text });
			for (const example of row.examples ?? []) this.contentEl.createEl("p", { text: example, cls: "finition-dictionary-example" });
		}
		const footer = this.modalEl.createDiv({ cls: "modal-button-container finition-synonyms-footer" });
		const button = footer.createEl("button", { cls: "clickable-icon finition-synonyms-insert", attr: { "aria-label": "Insérer la liste en remarque", title: "Insérer la liste en remarque" } });
		setIcon(button, "message-square-plus");
		button.addEventListener("click", () => {
			const text = [this.word, this.description, ...this.rows.map(row => [row.label, row.text, ...(row.examples ?? [])].filter(Boolean).join("\n"))].filter(Boolean).join("\n\n");
			if (this.insertRemark(text)) this.close();
		});
	}
	onClose(): void {
		this.contentEl.empty();
		this.modalEl.querySelector(".finition-synonyms-footer")?.remove();
		this.restoreFocus();
	}
}
