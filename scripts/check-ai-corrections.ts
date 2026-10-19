import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { finitionAIExtension } from "../plugin/ai/ai-extension";
import { protectLinks } from "../plugin/ai/protected-links";

export function checkAICorrections(): void {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const source = "Un inutile texte. Une fote.";
	for (const accept of [true, false]) {
		const host = { aiSourcePath: "source.md", aiGroups: protectLinks(source).diff("Un texte. Une faute.").map((group, id) => ({ ...group, id })), aiGroupsVersion: 0 };
		const state = EditorState.create({ doc: source, extensions: [editorInfoField, finitionAIExtension(host)] });
		Object.assign(state.field(editorInfoField), { file: { path: "source.md" } });
		const view = new EditorView({ parent: document.body.createDiv(), state });
		try {
			const button = view.dom.querySelector<HTMLButtonElement>(".finition-ai-delete");
			check(button?.tagName === "BUTTON" && button.getAttribute("aria-label") === "Valider la suppression", "Suppression IA sans bouton de validation accessible");
			check(button!.dataset.icon === "check", "La suppression ne propose pas de coche");
			const rgb = getComputedStyle(button!).color.match(/\d+/gu)!.map(Number);
			check(rgb[1] > rgb[0] && rgb[1] > rgb[2], "La coche de validation n’est pas verte");
			button!.focus();
			check(document.activeElement === button, "Validation IA inaccessible au clavier");
			(accept ? button! : view.dom.querySelector<HTMLElement>(".finition-ai-del")!).click();
			check(view.state.doc.toString() === (accept ? "Un texte. Une fote." : source), "La coche ou le refus rouge applique une mauvaise suppression");
			check(host.aiGroups.length === 1 && !view.dom.querySelector(".finition-ai-delete"), "La suppression validée ou refusée reste affichée");
			view.dom.querySelector<HTMLElement>(".finition-ai-ins")!.click();
			check(view.state.doc.toString() === (accept ? "Un texte. Une faute." : "Un inutile texte. Une faute."), "Les suggestions suivantes perdent leur position après suppression");
			check(host.aiGroups.length === 0 && !view.dom.querySelector(".finition-ai-del, .finition-ai-ins"), "Une suggestion validée reste affichée");
		} finally { view.destroy(); }
	}
}
