import { RangeSet, RangeSetBuilder, type Text } from "@codemirror/state";
import { gutter, GutterMarker, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type { NoteAnalysis } from "../note-analysis";

type CorrectionState = Pick<NoteAnalysis, "aiGroups" | "aiGroupsVersion" | "aiSourcePath" | "grammalecteErrors" | "grammalecteErrorsVersion">;
interface CorrectionHost extends CorrectionState {
	getNoteAnalysis?: (view: EditorView, update?: ViewUpdate) => CorrectionState;
}

class CorrectionLine extends GutterMarker {
	elementClass = "finition-correction-line";
}
const marker = new CorrectionLine();
const emptyMarkers = RangeSet.of<GutterMarker>([]);

export function correctionGutter(host: CorrectionHost) {
	const markers = ViewPlugin.fromClass(class {
		ranges = emptyMarkers;
		private document: Text | undefined;
		private analysis: CorrectionState | undefined;
		private aiVersion = -1;
		private spellingVersion = -1;

		constructor(view: EditorView) { this.refresh(view); }
		update(update: ViewUpdate): void { this.refresh(update.view, update); }
		private refresh(view: EditorView, update?: ViewUpdate): void {
			const analysis = host.getNoteAnalysis?.(view, update) ?? host;
			const document = view.state.doc;
			if (document === this.document && analysis === this.analysis && analysis.aiGroupsVersion === this.aiVersion && analysis.grammalecteErrorsVersion === this.spellingVersion) return;
			this.document = document;
			this.analysis = analysis;
			this.aiVersion = analysis.aiGroupsVersion;
			this.spellingVersion = analysis.grammalecteErrorsVersion;
			const lines = new Set<number>();
			const add = (from: number, to: number) => {
				if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > document.length) return;
				const first = document.lineAt(from).number, last = document.lineAt(Math.max(from, to - 1)).number;
				for (let number = first; number <= last; number++) lines.add(document.line(number).from);
			};
			if (analysis.aiSourcePath === view.state.field(editorInfoField, false)?.file?.path) {
				for (const group of analysis.aiGroups) if (group.insText || group.delFrom < group.delTo) add(group.delFrom, group.delTo);
			}
			for (const error of analysis.grammalecteErrors) if (error.nStart < error.nEnd) add(error.nStart, error.nEnd);
			const builder = new RangeSetBuilder<GutterMarker>();
			for (const position of [...lines].sort((a, b) => a - b)) builder.add(position, position, marker);
			this.ranges = builder.finish();
		}
	});
	return [markers, gutter({ class: "finition-correction-gutter", markers: view => view.plugin(markers)?.ranges ?? emptyMarkers })];
}
