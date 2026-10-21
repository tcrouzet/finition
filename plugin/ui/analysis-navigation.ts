import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { MarkdownView, Plugin, setIcon } from "obsidian";
import type { FinitionMode, FinitionRuntime, Highlight } from "../types";
import { addDocumentNavigation } from "./document-navigation";

export const setNavigationFocus = StateEffect.define<Pick<Highlight, "from" | "to"> | null>();
export const navigationFocus = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, transaction) {
		if (transaction.docChanged || transaction.selection) value = Decoration.none;
		for (const effect of transaction.effects) if (effect.is(setNavigationFocus)) {
			const range = effect.value;
			value = range && range.from >= 0 && range.to <= transaction.newDoc.length && range.from < range.to
				? Decoration.set([Decoration.mark({ class: "finition-navigation-focused" }).range(range.from, range.to)])
				: Decoration.none;
		}
		return value;
	},
	provide: field => EditorView.decorations.from(field),
});

interface AnalysisSnapshot {
	doc: EditorView["state"]["doc"];
	mode: FinitionMode | "grammalecte";
	highlights: Pick<Highlight, "from" | "to">[];
	pending: boolean;
}

export class AnalysisNavigation {
	private snapshots = new WeakMap<EditorView, AnalysisSnapshot>();
	private grammalecteSnapshots = new WeakMap<EditorView, AnalysisSnapshot>();
	private disposed = false;
	private count: HTMLSpanElement;
	private previous: HTMLButtonElement;
	private next: HTMLButtonElement;
	private analysisActive = false;
	private refreshDocuments: () => void;

	constructor(private plugin: Pick<Plugin, "app" | "registerDomEvent" | "register" | "registerEvent"> & Pick<FinitionRuntime, "settings">, parent: HTMLElement) {
		this.count = parent.createSpan({ cls: "finition-analysis-count", attr: { "aria-live": "polite", title: "Occurrences surlignées" } });
		[this.previous, this.next] = (["previous", "next"] as const).map(direction => {
			const button = parent.createEl("button", {
				cls: `clickable-icon finition-document-navigation finition-${direction}-occurrence`,
				attr: { type: "button" },
			});
			setIcon(button, direction === "previous" ? "arrow-left" : "arrow-right");
			plugin.registerDomEvent(button, "mousedown", event => event.preventDefault());
			plugin.registerDomEvent(button, "click", event => {
				event.stopPropagation();
				if (!this.analysisActive) return;
				const view = this.activeView();
				const snapshot = this.current(view);
				if (!view || !snapshot || snapshot.pending || !snapshot.highlights.length) return;
				const position = view.state.selection.main.head;
				const highlights = direction === "next" ? snapshot.highlights : [...snapshot.highlights].reverse();
				const highlight = highlights.find(({ from }) => direction === "next" ? from > position : from < position) ?? highlights[0];
				this.goTo(view, highlight);
			});
			return button;
		});
		parent.prepend(this.previous, this.count, this.next);
		this.refreshDocuments = addDocumentNavigation(plugin, [this.previous, this.next], () => this.analysisActive);
		this.refresh();
	}

	update(view: EditorView, highlights: Highlight[], pending: boolean): void {
		if (this.disposed) return;
		this.snapshots.set(view, { doc: view.state.doc, mode: this.plugin.settings.mode, highlights, pending });
		this.refresh();
	}

	updateGrammalecte(view: EditorView, highlights: Pick<Highlight, "from" | "to">[]): void {
		if (this.disposed) return;
		this.grammalecteSnapshots.set(view, { doc: view.state.doc, mode: "grammalecte", highlights, pending: false });
		this.refresh();
	}

	refresh(): void {
		if (this.disposed) return;
		const view = this.activeView();
		const snapshot = this.current(view);
		const mode = snapshot?.mode ?? this.plugin.settings.mode;
		const enabled = this.analysisActive = !!view && mode !== "none" && mode !== "tic-ia";
		const ready = snapshot && !snapshot.pending;
		this.count.title = mode === "grammalecte" ? "Fautes Grammalecte" : "Occurrences surlignées";
		this.count.hidden = !enabled;
		this.count.setText(enabled ? ready ? String(snapshot.highlights.length) : "…" : "");
		if (!enabled) { this.refreshDocuments(); return; }
		for (const [button, label] of [[this.previous, mode === "grammalecte" ? "Faute précédente" : "Occurrence précédente"], [this.next, mode === "grammalecte" ? "Faute suivante" : "Occurrence suivante"]] as const) {
			button.setAttribute("aria-label", label);
			button.title = label;
			button.hidden = false;
			button.disabled = !ready || snapshot.highlights.length === 0;
		}
	}

	destroy(): void {
		this.disposed = true;
	}

	private activeView(): EditorView | undefined {
		const markdown = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const view = (markdown?.editor as { cm?: EditorView } | undefined)?.cm;
		return view?.dom.isConnected ? view : undefined;
	}

	private current(view: EditorView | undefined): AnalysisSnapshot | undefined {
		const grammalecte = view ? this.grammalecteSnapshots.get(view) : undefined;
		if (this.plugin.settings.mode === "none" && grammalecte?.doc === view?.state.doc && grammalecte?.highlights.length) return grammalecte;
		const snapshot = view ? this.snapshots.get(view) : undefined;
		return snapshot?.doc === view?.state.doc && snapshot?.mode === this.plugin.settings.mode ? snapshot : undefined;
	}

	private goTo(view: EditorView, highlight: Pick<Highlight, "from" | "to">): void {
		view.dispatch({ selection: { anchor: highlight.from }, effects: [EditorView.scrollIntoView(highlight.from, { y: "center" }), setNavigationFocus.of(highlight)] });
		view.focus();
	}
}
