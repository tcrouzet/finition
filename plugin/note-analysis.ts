import type { Text } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { editorInfoField, type TFile } from "obsidian";
import type { AIGroup } from "./ai/ai-extension";
import type { GrammalecteError } from "./modes/grammalecte";
import type { FinitionMode } from "./types";

export interface NoteAnalysis {
	mode: FinitionMode;
	aiGroups: AIGroup[];
	aiGroupsVersion: number;
	aiSourcePath: string | null;
	grammalecteErrors: GrammalecteError[];
	grammalecteErrorsVersion: number;
	document?: Text;
}

const emptyAnalysis = (): NoteAnalysis => ({ mode: "none", aiGroups: [], aiGroupsVersion: 0, aiSourcePath: null, grammalecteErrors: [], grammalecteErrorsVersion: 0 });

export class NoteAnalyses {
	private states = new WeakMap<Pick<TFile, "path">, NoteAnalysis>();
	private views = new WeakMap<EditorView, Pick<TFile, "path">>();
	private file: Pick<TFile, "path"> | null | undefined;
	private empty = emptyAnalysis();
	current = emptyAnalysis();

	activate(file: Pick<TFile, "path"> | null): NoteAnalysis {
		this.file = file;
		this.current = file ? this.states.get(file) ?? emptyAnalysis() : emptyAnalysis();
		if (file) this.states.set(file, this.current);
		return this.current;
	}

	forView(view: EditorView, update?: ViewUpdate): NoteAnalysis {
		const file = view.state.field(editorInfoField, false)?.file;
		if (!file) return this.empty;
		const changedNote = this.views.get(view) !== file;
		this.views.set(view, file);
		if (this.file === undefined) { this.file = file; this.states.set(file, this.current); }
		const state = this.states.get(file) ?? emptyAnalysis();
		this.states.set(file, state);
		if (state.aiSourcePath) state.aiSourcePath = file.path;
		if (!state.aiGroups.length && !state.grammalecteErrors.length) { state.document = undefined; return state; }
		const document = view.state.doc;
		// La navigation peut lire un autre volet avant qu’Obsidian y propage l’édition.
		if (state.document && !changedNote && !update?.docChanged) return state;
		if (state.document && state.document !== document && !state.document.eq(document)) {
			if (update?.docChanged && state.document.eq(update.startState.doc)) {
				state.aiGroups = state.aiGroups.map(group => ({ ...group, delFrom: update.changes.mapPos(group.delFrom, 1), delTo: update.changes.mapPos(group.delTo, -1) })).filter(group => group.delFrom <= group.delTo);
				state.grammalecteErrors = state.grammalecteErrors.map(error => ({ ...error, nStart: update.changes.mapPos(error.nStart, 1), nEnd: update.changes.mapPos(error.nEnd, -1) })).filter(error => error.nStart < error.nEnd);
			} else {
				// Un texte modifié hors de l’éditeur invalide les positions sauvegardées.
				state.aiGroups = [];
				state.aiSourcePath = null;
				state.grammalecteErrors = [];
			}
			state.aiGroupsVersion++;
			state.grammalecteErrorsVersion++;
		}
		state.document = document;
		return state;
	}
}
