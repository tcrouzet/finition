import { EditorView } from "@codemirror/view";
import { MarkdownView, Plugin, setIcon } from "obsidian";
import type { FinitionMode, FinitionRuntime, Highlight } from "../types";

interface AnalysisSnapshot {
	doc: EditorView["state"]["doc"];
	mode: FinitionMode | "grammalecte";
	highlights: Pick<Highlight, "from">[];
	pending: boolean;
}

export class AnalysisNavigation {
	private snapshots = new WeakMap<EditorView, AnalysisSnapshot>();
	private grammalecteSnapshots = new WeakMap<EditorView, AnalysisSnapshot>();
	private first: { view: EditorView; mode: FinitionMode } | null = null;
	private disposed = false;
	private count: HTMLSpanElement;
	private next: HTMLButtonElement;

	constructor(private plugin: Pick<Plugin, "app" | "registerDomEvent"> & Pick<FinitionRuntime, "settings">, parent: HTMLElement) {
		this.count = parent.createSpan({ cls: "finition-analysis-count", attr: { "aria-live": "polite", title: "Occurrences surlignées" } });
		this.next = parent.createEl("button", {
			cls: "clickable-icon finition-next-occurrence",
			attr: { type: "button", "aria-label": "Occurrence suivante", title: "Occurrence suivante" },
		});
		setIcon(this.next, "chevron-down");
		plugin.registerDomEvent(this.next, "click", (event) => {
			event.stopPropagation();
			const view = this.activeView();
			const snapshot = this.current(view);
			if (!view || !snapshot || snapshot.pending || !snapshot.highlights.length) return;
			const position = view.state.selection.main.head;
			const highlight = snapshot.highlights.find(({ from }) => from > position) ?? snapshot.highlights[0];
			this.goTo(view, highlight.from);
		});
		this.refresh();
	}

	update(view: EditorView, highlights: Highlight[], pending: boolean): void {
		if (this.disposed) return;
		this.snapshots.set(view, { doc: view.state.doc, mode: this.plugin.settings.mode, highlights, pending });
		this.refresh();
	}

	updateGrammalecte(view: EditorView, highlights: Pick<Highlight, "from">[]): void {
		if (this.disposed) return;
		this.grammalecteSnapshots.set(view, { doc: view.state.doc, mode: "grammalecte", highlights, pending: false });
		this.refresh();
	}

	requestFirst(): void {
		const view = this.activeView();
		this.first = view ? { view, mode: this.plugin.settings.mode } : null;
		this.refresh();
	}

	refresh(): void {
		if (this.disposed) return;
		const view = this.activeView();
		const snapshot = this.current(view);
		const mode = snapshot?.mode ?? this.plugin.settings.mode;
		const enabled = !!view && mode !== "none" && mode !== "tic-ia";
		const ready = snapshot && !snapshot.pending;
		const label = mode === "grammalecte" ? "Faute suivante" : "Occurrence suivante";
		this.count.title = mode === "grammalecte" ? "Fautes Grammalecte" : "Occurrences surlignées";
		this.next.setAttribute("aria-label", label);
		this.next.title = label;
		this.count.hidden = this.next.hidden = !enabled;
		this.count.setText(enabled ? ready ? String(snapshot.highlights.length) : "…" : "");
		this.next.disabled = !enabled || !ready || snapshot.highlights.length === 0;
		if (this.first && this.first.mode !== mode) this.first = null;
		if (enabled && ready && this.first?.view === view) {
			this.first = null;
			const from = snapshot.highlights[0]?.from;
			if (from !== undefined) queueMicrotask(() => {
				if (!this.disposed && this.activeView() === view && this.current(view) === snapshot) this.goTo(view, from);
			});
		}
	}

	destroy(): void {
		this.disposed = true;
		this.first = null;
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

	private goTo(view: EditorView, from: number): void {
		view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
		view.focus();
	}
}
