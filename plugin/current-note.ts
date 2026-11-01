import { MarkdownView, Notice, type App } from "obsidian";

export function getCurrentNote(app: App): MarkdownView | null {
	const active = app.workspace.getActiveViewOfType(MarkdownView);
	if (active?.editor) return active;
	const recent = app.workspace.getMostRecentLeaf?.()?.view;
	return recent instanceof MarkdownView && recent.editor ? recent : null;
}

export function requireCurrentNote(app: App): MarkdownView | null {
	const view = getCurrentNote(app);
	if (!view) new Notice("Finition : aucune note accessible. Ouvre une note pour lancer cette commande.");
	return view;
}
