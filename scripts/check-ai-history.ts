import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { historyKeymap, redo, undo } from "@codemirror/commands";
import { editorInfoField, Platform } from "obsidian";
import { finitionAIExtension, type AIGroup } from "../plugin/ai/ai-extension";
import { resetCorrectionHistory } from "../plugin/ai/correction-history";
import { NoteAnalyses } from "../plugin/note-analysis";

export function checkAIHistory(): void {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const source = "Une fote et une errer.";
	const create = (groups: AIGroup[], text = source) => {
		const file = { path: "historique.md" }, analyses = new NoteAnalyses();
		const analysis = analyses.activate(file);
		Object.assign(analysis, { aiGroups: groups, aiSourcePath: file.path });
		const host = { ...analysis, getNoteAnalysis: (view: EditorView, update?: import("@codemirror/view").ViewUpdate) => analyses.forView(view, update) };
		const state = EditorState.create({ doc: text, extensions: [editorInfoField, keymap.of(historyKeymap), finitionAIExtension(host)] });
		Object.assign(state.field(editorInfoField), { file });
		const parent = document.body.createDiv(), view = new EditorView({ parent, state });
		const click = (action: string, id = 0) => view.dom.querySelector<HTMLElement>(`.finition-ai-${action}[data-finition-ai-group="${id}"]`)!.click();
		return { view, analysis, click, destroy() { view.destroy(); parent.remove(); } };
	};
	for (const kind of ["insertion", "replacement", "deletion"]) for (const action of ["accept", "reject"]) {
		const group = { id: 0, delFrom: 4, delTo: kind === "insertion" ? 4 : 8, delText: kind === "insertion" ? "" : "fote", insText: kind === "deletion" ? null : kind === "insertion" ? "petite " : "faute" };
		const fixture = create([group]), { view, analysis, click } = fixture;
		try {
			click(action);
			const resolved = view.state.doc.toString();
			for (let cycle = 0; cycle < 2; cycle++) {
				check(undo(view), `Annuler indisponible : ${kind}, ${action}`);
				check(view.state.doc.toString() === source && JSON.stringify(analysis.aiGroups) === JSON.stringify([group]), "Annuler ne restaure pas le texte et la suggestion");
				check(!!view.dom.querySelector(".finition-ai-accept"), "La suggestion annulée ne réapparaît pas");
				check(redo(view), "Rétablir indisponible");
				check(view.state.doc.toString() === resolved && analysis.aiGroups.length === 0, "Rétablir ne rejoue pas la décision");
			}
		} finally { fixture.destroy(); }
	}
	const groups = [{ id: 0, delFrom: 4, delTo: 8, delText: "fote", insText: "faute" }, { id: 1, delFrom: 16, delTo: 21, delText: "errer", insText: "erreur" }];
	for (const action of ["accept", "reject"]) {
		const fixture = create(groups), { view, analysis, click } = fixture;
		try {
			click(action);
			const resolved = view.state.doc.toString(), mac = Platform.isMacOS;
			check(view.hasFocus, "Le clic ne rend pas le clavier à l’éditeur");
			view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", keyCode: 90, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }));
			check(view.state.doc.toString() === source && analysis.aiGroups.length === 2, "Le raccourci standard n’annule pas une décision IA");
			view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: mac ? "Z" : "y", code: mac ? "KeyZ" : "KeyY", keyCode: mac ? 90 : 89, metaKey: mac, ctrlKey: !mac, shiftKey: mac, bubbles: true, cancelable: true }));
			check(view.state.doc.toString() === resolved && analysis.aiGroups.length === 1, "Le raccourci standard ne rétablit pas une décision IA");
		} finally { fixture.destroy(); }
	}
	for (const recorded of [true, false]) {
		const fixture = create(groups), { view, analysis, click } = fixture;
		try {
			const typedAt = Date.now();
			click("accept");
			view.dispatch({ changes: recorded ? { from: 9, insert: " vite" } : { from: 0, insert: "Hier, " }, annotations: recorded ? [Transaction.time.of(typedAt), Transaction.userEvent.of("input.type")] : Transaction.addToHistory.of(false) });
			if (recorded) check(undo(view) && view.state.doc.toString() === source.replace("fote", "faute"), "Annuler saute la saisie manuelle");
			check(undo(view), "Annuler la correction après une édition est impossible");
			const prefix = recorded ? "" : "Hier, ";
			check(view.state.doc.toString() === prefix + source, "L’annulation perd la saisie ou le texte original");
			check(analysis.aiGroups[0].delFrom === prefix.length + 4 && analysis.aiGroups[1].delFrom === prefix.length + 16, "Les positions des suggestions ne suivent pas l’historique");
			check(redo(view) && view.state.doc.toString() === prefix + source.replace("fote", "faute"), "Rétablir décale une correction");
			if (recorded) check(redo(view) && view.state.doc.toString() === source.replace("fote", "faute vite"), "Rétablir perd la saisie manuelle");
		} finally { fixture.destroy(); }
	}
	const fixture = create(groups), other = create([]);
	try {
		fixture.click("reject");
		check(!undo(other.view) && other.analysis.aiGroups.length === 0, "L’historique d’une note fuit dans une autre");
		check(undo(fixture.view), "Le retour vers l’historique de la première note échoue");
		fixture.click("accept");
		check(!redo(fixture.view), "Une nouvelle décision conserve une branche redo obsolète");
		resetCorrectionHistory(fixture.analysis);
		fixture.analysis.aiGroups = [{ id: 99, delFrom: 17, delTo: 22, delText: "errer", insText: "erreur" }];
		fixture.analysis.aiGroupsVersion++;
		fixture.view.dispatch({});
		check(undo(fixture.view), "Reset supprime l’historique habituel du texte");
		check(fixture.analysis.aiGroups.length === 1 && fixture.analysis.aiGroups[0].id === 99, "Une ancienne analyse réapparaît après Reset");
	} finally { fixture.destroy(); other.destroy(); }
}
