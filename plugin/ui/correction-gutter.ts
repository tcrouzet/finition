import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { NoteAnalysis } from "../note-analysis";
import { editorInfoField, setIcon } from "obsidian";
import { paragraphPreviewRanges, toggleParagraphPreview } from "../ai/paragraph-preview";

type CorrectionState = Pick<NoteAnalysis, "aiGroups" | "aiGroupsVersion" | "aiSourcePath">;
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
			view.scrollDOM.addEventListener("scroll", this.scroll, { passive: true });
			this.measure();
		}
		update(update: ViewUpdate): void {
			host.getNoteAnalysis?.(this.view, update);
			this.measure();
		}
		private measure(): void {
			this.view.requestMeasure({ key: this, read: view => {
				const rows: Array<{ top: number; bottom: number; left: number }> = [];
				const eyes: Array<{ from: number; to: number; top: number; left: number }> = [];
				if (this.disposed) return { rows, eyes };
				const spans = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".finition-ai-del, .finition-ai-ins, .finition-grammalecte-spelling, .finition-grammalecte-grammar"));
				const editor = view.dom.getBoundingClientRect(), viewport = view.scrollDOM.getBoundingClientRect();
				const top = Math.max(0, editor.top, viewport.top), bottom = Math.min(view.dom.ownerDocument.defaultView?.innerHeight ?? editor.bottom, editor.bottom, viewport.bottom);
				const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"));
				const left = Math.max(0, Math.min(...lines.map(line => line.getBoundingClientRect().left)) - editor.left - 8) / view.scaleX;
				const fragments = spans.flatMap(span => Array.from(span.getClientRects())).filter(rect => rect.height > 0 && rect.bottom > top && rect.top < bottom).sort((a, b) => a.top - b.top);
				for (const rect of fragments) {
					const start = (Math.max(top, rect.top) - editor.top) / view.scaleY, end = (Math.min(bottom, rect.bottom) - editor.top) / view.scaleY;
					const previous = rows[rows.length - 1];
					if (previous && start < previous.bottom - 1) previous.bottom = Math.max(previous.bottom, end);
					else rows.push({ top: start, bottom: end, left });
				}
				const analysis = host.getNoteAnalysis?.(view) ?? host;
				if (analysis.aiSourcePath && view.state.field(editorInfoField, false)?.file?.path === analysis.aiSourcePath) {
					for (const range of paragraphPreviewRanges(view.state.doc, analysis.aiGroups)) {
						if (!view.visibleRanges.some(visible => range.anchor >= visible.from && range.anchor <= visible.to)) continue;
						const coords = view.coordsAtPos(range.anchor);
						if (coords && coords.top >= top && coords.top < bottom) eyes.push({ from: range.from, to: range.to, top: (coords.top - editor.top) / view.scaleY, left: Math.max(0, left - 24) });
					}
				}
				return { rows, eyes };
			}, write: layout => {
				const geometry = JSON.stringify(layout);
				if (this.disposed || geometry === this.geometry) return;
				this.geometry = geometry;
				this.margin.replaceChildren(...layout.rows.map(row => {
					const bar = createDiv();
					bar.className = "finition-correction-line";
					bar.setAttribute("aria-hidden", "true");
					bar.style.top = `${row.top}px`;
					bar.style.left = `${row.left}px`;
					bar.style.height = `${row.bottom - row.top}px`;
					return bar;
				}), ...layout.eyes.map(eye => {
					const button = createEl("button", { cls: "clickable-icon finition-ai-preview-toggle", attr: { type: "button", "aria-label": "Voir le paragraphe corrigé", title: "Voir le paragraphe corrigé" } });
					button.dataset.finitionAiPreviewFrom = String(eye.from);
					button.dataset.finitionAiPreviewTo = String(eye.to);
					button.style.top = `${eye.top}px`;
					button.style.left = `${eye.left}px`;
					setIcon(button, "eye");
					button.onmousedown = event => event.preventDefault();
					button.onclick = event => {
						const analysis = host.getNoteAnalysis?.(this.view) ?? host;
						if (analysis.aiSourcePath !== this.view.state.field(editorInfoField, false)?.file?.path) return;
						this.view.focus();
						toggleParagraphPreview(this.view, analysis, eye.from, eye.to);
						event.preventDefault();
					};
					return button;
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
