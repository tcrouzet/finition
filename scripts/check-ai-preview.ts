import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, undoDepth } from "@codemirror/commands";
import { editorInfoField } from "obsidian";
import { finitionAIExtension, type AIGroup } from "../plugin/ai/ai-extension";
import { correctedParagraph } from "../plugin/ai/paragraph-preview";
import { protectLinks } from "../plugin/ai/protected-links";
import { correctionGutter } from "../plugin/ui/correction-gutter";

export async function checkAIPreview(): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
	const create = (source: string, revised: string) => {
		const host = { aiSourcePath: "aperçu.md", aiGroupsVersion: 0, aiGroups: protectLinks(source).diff(revised).map((group, id) => ({ ...group, id })) };
		const state = EditorState.create({ doc: source, extensions: [editorInfoField, EditorView.lineWrapping, finitionAIExtension(host), correctionGutter(host)] });
		Object.assign(state.field(editorInfoField), { file: { path: host.aiSourcePath } });
		const parent = document.body.createDiv();
		parent.className = "markdown-source-view mod-cm6 is-live-preview finition-test-ai-preview";
		const view = new EditorView({ parent, state });
		parent.scrollIntoView();
		const click = (selector: string) => {
			const target = view.dom.querySelector<HTMLElement>(selector);
			check(target, `Contrôle absent : ${selector}`);
			target!.click();
		};
		return { host, view, click, destroy() { view.destroy(); parent.remove(); } };
	};
	const source = "  Une fote.\n\nUne errer.\n\nTexte intact.\n";
	const fixture = create(source, "Une faute.\n\nUne erreur.\n\nTexte intact.");
	const { view, host, click } = fixture;
	const eye = ".finition-ai-preview-toggle", tooltip = ".finition-ai-paragraph-preview";
	try {
		await frame(); await frame();
		check(host.aiGroups.length === 2 && view.dom.querySelectorAll(".finition-ai-reject").length === 2, "Les blancs de tête produisent une poubelle isolée");
		check(view.dom.querySelectorAll(eye).length === 2, "Chaque paragraphe corrigé doit avoir un œil");
		const button = view.dom.querySelector<HTMLElement>(eye)!, rect = button.getBoundingClientRect(), start = view.coordsAtPos(2)!;
		check(!!button.closest(".finition-correction-margin") && !view.contentDOM.contains(button), "L’œil reste inséré dans le texte au lieu de la marge");
		check(rect.right <= start.left && Math.abs(rect.top - start.top) < 2 && getComputedStyle(button).pointerEvents === "auto" && !button.closest('[aria-hidden="true"]'), "L’œil n’est pas accessible dans la marge en haut du paragraphe");
		const before = JSON.stringify(host.aiGroups), depth = undoDepth(view.state);
		click(eye); await frame(); await frame();
		check(view.dom.querySelector(tooltip)?.textContent === "  Une faute.", "L’aperçu ne montre pas le paragraphe corrigé");
		view.dispatch({ selection: { anchor: source.length } }); await frame();
		check(view.dom.querySelector(tooltip)?.textContent === "  Une faute.", "Un rafraîchissement sans modification referme immédiatement l’aperçu");
		check(view.state.doc.toString() === source && JSON.stringify(host.aiGroups) === before && undoDepth(view.state) === depth, "L’aperçu modifie le texte, les suggestions ou l’historique");
		click(eye); await frame();
		check(!view.dom.querySelector(tooltip), "Un second clic ne ferme pas l’aperçu");
		click(eye); await frame();
		view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		await frame();
		check(!view.dom.querySelector(tooltip), "Échap ne ferme pas l’aperçu");
		click('.finition-ai-reject[data-finition-ai-group="0"]'); await frame();
		check(view.dom.querySelectorAll(eye).length === 1 && view.state.doc.toString() === source, "Refuser ne retire pas uniquement l’œil du paragraphe concerné");
		click(eye); await frame(); await frame();
		check(view.dom.querySelector(tooltip)?.textContent === "Une erreur.", "L’autre œil conserve un aperçu périmé");
		click('.finition-ai-ins[data-finition-ai-group="1"]'); await frame();
		check(view.state.doc.toString() === source.replace("errer", "erreur") && !view.dom.querySelector(eye) && !view.dom.querySelector(tooltip), "Accepter ne ferme pas l’aperçu et son œil");
		check(undo(view), "Annuler la correction est impossible"); await frame(); await frame();
		check(host.aiGroups.length === 1 && !!view.dom.querySelector(eye), "Annuler ne restaure pas l’œil et la suggestion");
	} finally { fixture.destroy(); }
	const longSource = "Début. " + "Une suite tranquille. ".repeat(24) + "Une fote.";
	const long = create(longSource, longSource.replace("fote", "faute"));
	try {
		await frame(); await frame();
		const button = long.view.dom.querySelector<HTMLElement>(eye)!;
		check(button && Math.abs(button.getBoundingClientRect().top - long.view.coordsAtPos(0)!.top) < 2 && button.getBoundingClientRect().bottom < long.view.coordsAtPos(longSource.length)!.top, "L’œil ne reste pas en haut d’un paragraphe sur plusieurs lignes");
		long.click(eye); await frame(); await frame();
		check(long.view.dom.querySelector(tooltip)?.textContent === longSource.replace("fote", "faute"), "L’aperçu d’un long paragraphe est incomplet");
		Object.assign(long.view.state.field(editorInfoField), { file: { path: "autre.md" } });
		long.view.dispatch({}); await frame(); await frame();
		check(!long.view.dom.querySelector(eye) && !long.view.dom.querySelector(tooltip), "L’œil ou l’aperçu fuit dans une autre note");
	} finally { long.destroy(); }
	for (const [text, revised, expectedGlyph] of [
		["Avant.\n\n\nSuite.", "Avant.\n\nSuite.", "¶"],
		["25 tonnes.", "25 tonnes.", "·"],
	]) {
		const whitespace = create(text, revised);
		try {
			await frame();
			const mark = whitespace.view.dom.querySelector<HTMLElement>(".finition-ai-del, .finition-ai-ins");
			const trash = whitespace.view.dom.querySelector(".finition-ai-reject");
			check(mark?.textContent === expectedGlyph && trash?.closest(".cm-line") === mark.closest(".cm-line"), "La poubelle d’un blanc n’est pas associée à un signe visible");
			if (expectedGlyph === "¶") check(mark!.closest(".cm-line")?.textContent?.startsWith("Avant."), "Le retour supprimé flotte en tête de paragraphe");
			mark!.click();
			check(whitespace.host.aiGroups.length === 0 && whitespace.view.state.doc.toString() === (expectedGlyph === "¶" ? revised : "25\u00a0tonnes."), "Le signe de blanc ne valide pas la correction réelle");
			check(undo(whitespace.view) && whitespace.view.state.doc.toString() === text && whitespace.host.aiGroups.length === 1, "Annuler perd une correction de blanc");
			whitespace.click(".finition-ai-reject");
			check(whitespace.view.state.doc.toString() === text && whitespace.host.aiGroups.length === 0, "Refuser une correction de blanc modifie la note");
		} finally { whitespace.destroy(); }
	}
	const textDocument = EditorState.create({ doc: "Avant fote.\n\nAprès stable." }).doc;
	const group: AIGroup = { id: 0, delFrom: 6, delTo: 19, delText: textDocument.sliceString(6, 19), insText: "faute et " };
	for (const [from, to] of [[0, 13], [13, textDocument.length]]) check(correctedParagraph(textDocument, [group], from, to) === "Avant faute et stable.", "L’aperçu tronque une correction qui traverse deux paragraphes");
	check(correctedParagraph(textDocument, [{ id: 0, delFrom: 0, delTo: textDocument.length, delText: textDocument.toString(), insText: null }], 0, textDocument.length) === "", "L’aperçu ne gère pas un paragraphe supprimé");
}
