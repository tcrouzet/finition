import { Compartment, EditorState, StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

const slots = new WeakMap<EditorView, Compartment>();

export function lockAINote(view: EditorView): () => void {
	const slot = slots.get(view) ?? new Compartment();
	slots.set(view, slot);
	let active = true;
	const clear = () => { view.dom.classList.remove("finition-ai-busy"); view.dom.removeAttribute("aria-busy"); };
	const extensions = [
		EditorState.readOnly.of(true), EditorView.editable.of(false),
		EditorState.transactionFilter.of(transaction => transaction.isUserEvent("undo") || transaction.isUserEvent("redo") || transaction.docChanged && (transaction.isUserEvent("input") || transaction.isUserEvent("delete")) ? [] : transaction),
		ViewPlugin.define(() => ({ destroy() { active = false; clear(); } })),
	];
	view.dispatch({ effects: slot.get(view.state) === undefined ? StateEffect.appendConfig.of(slot.of(extensions)) : slot.reconfigure(extensions) });
	view.dom.classList.add("finition-ai-busy");
	view.dom.setAttribute("aria-busy", "true");
	return () => {
		if (!active) return;
		active = false;
		clear();
		view.dispatch({ effects: slot.reconfigure([]) });
	};
}
