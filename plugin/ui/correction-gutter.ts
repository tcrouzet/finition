import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { NoteAnalysis } from "../note-analysis";

type CorrectionState = Pick<NoteAnalysis, "aiGroups" | "aiGroupsVersion" | "aiSourcePath" | "grammalecteErrors" | "grammalecteErrorsVersion">;
interface CorrectionHost extends CorrectionState {
	getNoteAnalysis?: (view: EditorView, update?: ViewUpdate) => CorrectionState;
}

export function correctionGutter(host: CorrectionHost) {
	return ViewPlugin.fromClass(class {
		private readonly margin: HTMLDivElement;
		private disposed = false;
		private geometry = "";
		private readonly scroll = () => this.measure();

		constructor(private readonly view: EditorView) {
			this.margin = view.dom.createDiv();
			this.margin.className = "finition-correction-margin";
			this.margin.setAttribute("aria-hidden", "true");
			view.scrollDOM.addEventListener("scroll", this.scroll, { passive: true });
			this.measure();
		}
		update(update: ViewUpdate): void {
			host.getNoteAnalysis?.(this.view, update);
			this.measure();
		}
		private measure(): void {
			this.view.requestMeasure({ key: this, read: view => {
				if (this.disposed) return [];
				const spans = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".finition-ai-del, .finition-ai-ins, .finition-grammalecte-spelling, .finition-grammalecte-grammar"));
				if (!spans.length) return [];
				const editor = view.dom.getBoundingClientRect(), viewport = view.scrollDOM.getBoundingClientRect();
				const top = Math.max(0, editor.top, viewport.top), bottom = Math.min(view.dom.ownerDocument.defaultView?.innerHeight ?? editor.bottom, editor.bottom, viewport.bottom);
				const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"));
				const left = Math.max(0, Math.min(...lines.map(line => line.getBoundingClientRect().left)) - editor.left - 8) / view.scaleX;
				const fragments = spans.flatMap(span => Array.from(span.getClientRects())).filter(rect => rect.height > 0 && rect.bottom > top && rect.top < bottom).sort((a, b) => a.top - b.top);
				const rows: Array<{ top: number; bottom: number; left: number }> = [];
				for (const rect of fragments) {
					const start = (Math.max(top, rect.top) - editor.top) / view.scaleY, end = (Math.min(bottom, rect.bottom) - editor.top) / view.scaleY;
					const previous = rows[rows.length - 1];
					if (previous && start < previous.bottom - 1) previous.bottom = Math.max(previous.bottom, end);
					else rows.push({ top: start, bottom: end, left });
				}
				return rows;
			}, write: rows => {
				const geometry = JSON.stringify(rows);
				if (this.disposed || geometry === this.geometry) return;
				this.geometry = geometry;
				this.margin.replaceChildren(...rows.map(row => {
					const bar = createDiv();
					bar.className = "finition-correction-line";
					bar.style.top = `${row.top}px`;
					bar.style.left = `${row.left}px`;
					bar.style.height = `${row.bottom - row.top}px`;
					return bar;
				}));
			} });
		}
		destroy(): void {
			this.disposed = true;
			this.view.scrollDOM.removeEventListener("scroll", this.scroll);
			this.margin.remove();
		}
	});
}
