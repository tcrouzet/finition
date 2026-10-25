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
	highlights: Array<Pick<Highlight, "from" | "to"> & { lemma?: string }>;
	pending: boolean;
	initialized: boolean;
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
	private initialTimer: number | null = null;

	constructor(private plugin: Pick<Plugin, "app" | "registerDomEvent" | "register" | "registerEvent"> & Pick<FinitionRuntime, "settings" | "getNoteAnalysis">, parent: HTMLElement) {
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
				const selected = view.state.field(navigationFocus, false);
				const position = selected?.size ? selected.iter().from : view.state.selection.main.from;
				const group = snapshot.highlights.find(highlight => highlight.from <= position && position < highlight.to)?.lemma;
				const matches = group ? snapshot.highlights.filter(highlight => highlight.lemma === group) : snapshot.highlights;
				const highlights = direction === "next" ? matches : [...matches].reverse();
				const highlight = highlights.find(({ from }) => direction === "next" ? from > position : from < position) ?? highlights[0];
				snapshot.initialized = true;
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
		const previous = this.snapshots.get(view);
		const mode = this.mode(view);
		const initialized = previous?.initialized === true && previous.doc === view.state.doc && previous.mode === mode;
		this.snapshots.set(view, { doc: view.state.doc, mode, highlights, pending, initialized });
		this.refresh();
	}

	updateGrammalecte(view: EditorView, highlights: Pick<Highlight, "from" | "to">[]): void {
		if (this.disposed) return;
		const previous = this.grammalecteSnapshots.get(view);
		const initialized = highlights.length > 0 && previous?.initialized === true && previous.doc === view.state.doc;
		this.grammalecteSnapshots.set(view, { doc: view.state.doc, mode: "grammalecte", highlights, pending: false, initialized });
		this.refresh();
	}

	refresh(): void {
		if (this.disposed) return;
		const view = this.activeView();
		const snapshot = this.current(view);
		const mode = snapshot?.mode ?? this.mode(view);
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
		if (snapshot?.highlights.length && !snapshot.initialized && this.initialTimer === null) {
			// Les résultats arrivent aussi pendant une mise à jour CodeMirror : différer la décoration.
			this.initialTimer = window.setTimeout(() => this.selectInitial(), 0);
		}
	}

	destroy(): void {
		this.disposed = true;
		if (this.initialTimer !== null) window.clearTimeout(this.initialTimer);
	}

	private selectInitial(): void {
		this.initialTimer = null;
		if (this.disposed || !this.analysisActive) return;
		const view = this.activeView();
		const snapshot = this.current(view);
		if (!view || !snapshot || snapshot.initialized || !snapshot.highlights.length) return;
		const position = view.state.selection.main.head;
		const distance = (highlight: Pick<Highlight, "from" | "to">) => Math.max(highlight.from - position, position - highlight.to + 1, 0);
		const closest = snapshot.highlights.reduce((best, highlight) => distance(highlight) < distance(best) ? highlight : best);
		snapshot.initialized = true;
		view.dispatch({ effects: setNavigationFocus.of(closest) });
	}

	private activeView(): EditorView | undefined {
		const markdown = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const view = (markdown?.editor as { cm?: EditorView } | undefined)?.cm;
		return view?.dom.isConnected ? view : undefined;
	}

	private current(view: EditorView | undefined): AnalysisSnapshot | undefined {
		const mode = this.mode(view);
		const grammalecte = view ? this.grammalecteSnapshots.get(view) : undefined;
		if (mode === "none" && grammalecte?.doc === view?.state.doc && grammalecte?.highlights.length) return grammalecte;
		const snapshot = view ? this.snapshots.get(view) : undefined;
		return snapshot?.doc === view?.state.doc && snapshot?.mode === mode ? snapshot : undefined;
	}

	private mode(view: EditorView | undefined): FinitionMode {
		return view && this.plugin.getNoteAnalysis ? this.plugin.getNoteAnalysis(view).mode : this.plugin.settings.mode;
	}

	private goTo(view: EditorView, highlight: Pick<Highlight, "from" | "to">): void {
		view.dispatch({ selection: { anchor: highlight.from }, effects: [EditorView.scrollIntoView(highlight.from, { y: "center" }), setNavigationFocus.of(highlight)] });
		view.focus();
	}
}
