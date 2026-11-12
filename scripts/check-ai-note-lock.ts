import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { editorInfoField } from "obsidian";
import { finitionAIExtension } from "../plugin/ai/ai-extension";
import { lockAINote } from "../plugin/ai/note-lock";

export function checkAINoteLock(): void {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const host = { aiGroups: [{ id: 0, delFrom: 4, delTo: 8, delText: "fote", insText: "faute" }], aiGroupsVersion: 0, aiSourcePath: "note.md" };
	const external = new Compartment();
	const state = EditorState.create({ doc: "Une fote.", extensions: [editorInfoField, external.of([]), finitionAIExtension(host)] });
	Object.assign(state.field(editorInfoField), { file: { path: host.aiSourcePath } });
	const parent = document.body.createDiv(), view = new EditorView({ parent, state });
	let destroyed = false;
	try {
		view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
		const source = view.state.doc.toString(), release = lockAINote(view);
		check(view.state.readOnly && view.contentDOM.getAttribute("contenteditable") === "false", "La note reste éditable pendant l’analyse IA");
		for (const event of ["input.type", "input.paste", "delete.backward"]) {
			view.dispatch({ changes: { from: 0, to: 1, insert: "X" }, annotations: Transaction.userEvent.of(event) });
			check(view.state.doc.toString() === source, `Le verrou laisse passer ${event}`);
		}
		undo(view);
		check(view.state.doc.toString() === source, "Annuler modifie la note pendant l’analyse");
		for (const selector of [".finition-ai-ins", ".finition-ai-del", ".finition-ai-reject"]) view.dom.querySelector<HTMLElement>(selector)!.click();
		check(view.state.doc.toString() === source && host.aiGroups.length === 1, "Une suggestion reste modifiable pendant l’analyse");
		release();
		check(!view.state.readOnly && view.contentDOM.getAttribute("contenteditable") === "true" && !view.dom.hasAttribute("aria-busy"), "La fin de l’analyse ne déverrouille pas la note");
		const nextRelease = lockAINote(view); release();
		check(view.state.readOnly, "La fin d’une ancienne analyse déverrouille la suivante");
		nextRelease();
		view.dom.querySelector<HTMLElement>(".finition-ai-ins")!.click();
		check(view.state.doc.toString() === "Une faute.!" && host.aiGroups.length === 0, "Une correction ne fonctionne plus après déverrouillage");
		view.dispatch({ effects: external.reconfigure(EditorState.readOnly.of(true)) });
		lockAINote(view)();
		check(view.state.readOnly, "Déverrouiller Finition retire le verrou d’une autre extension");
		const closedRelease = lockAINote(view);
		view.destroy(); destroyed = true; closedRelease();
		check(!view.dom.hasAttribute("aria-busy"), "Fermer la vue conserve le verrou IA");
	} finally { if (!destroyed) view.destroy(); parent.remove(); }
}
