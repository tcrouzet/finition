import { Text } from "@codemirror/state";
import { MarkdownView, type App, type TFile } from "obsidian";
import { getCurrentNote } from "./current-note";

export class CorrectionNote {
	readonly file: TFile | null;
	readonly text: string;
	readonly document: Text;

	constructor(private app: App, view: MarkdownView) {
		this.file = view.file;
		this.text = view.editor.getValue();
		this.document = Text.of(this.text.split("\n"));
	}

	findView(): MarkdownView | null {
		if (!this.file) return null;
		const current = getCurrentNote(this.app);
		if (current?.file === this.file) return current;
		let found: MarkdownView | null = null;
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof MarkdownView && leaf.view.file === this.file) found = leaf.view;
		});
		return found;
	}

	async unchanged(): Promise<boolean> {
		const view = this.findView();
		if (view) return view.editor.getValue() === this.text;
		if (!this.file) return false;
		try {
			const saved = await this.app.vault.read(this.file);
			return (this.findView()?.editor.getValue() ?? saved) === this.text;
		}
		catch { return false; }
	}
}
