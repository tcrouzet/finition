import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { finitionAIExtension } from "../plugin/ai/ai-extension";
import { NoteAnalyses } from "../plugin/note-analysis";
import { correctionGutter } from "../plugin/ui/correction-gutter";

export async function checkCorrectionGutter(): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const source = "Une fote.\nUne ligne correcte.\nEncore une errer.\nDernière ligne.";
	const file = { path: "corrections.md" }, otherFile = { path: "autre.md" };
	const analyses = new NoteAnalyses();
	const analysis = analyses.activate(file);
	analysis.aiSourcePath = file.path;
	analysis.aiGroups = [{ id: 0, delFrom: 4, delTo: 8, delText: "fote", insText: "faute" }];
	analysis.grammalecteErrors = [{ nStart: source.indexOf("errer"), nEnd: source.indexOf("errer") + 5, sRuleId: "test", sType: "orthographe", sMessage: "Faute", aSuggestions: ["erreur"] }];
	const host = { ...analysis, getNoteAnalysis: (view: EditorView, update?: import("@codemirror/view").ViewUpdate) => analyses.forView(view, update) };
	const create = (file: { path: string }) => {
		const state = EditorState.create({ doc: source, extensions: [editorInfoField, finitionAIExtension(host), correctionGutter(host)] });
		Object.assign(state.field(editorInfoField), { file });
		return new EditorView({ state, parent: document.body.createDiv() });
	};
	const view = create(file), other = create(otherFile);
	const bars = () => Array.from(view.dom.querySelectorAll<HTMLElement>(".finition-correction-line"));
	const waitForBars = async (count: number) => {
		for (let frame = 0; frame < 60; frame++) {
			if (bars().length === count) return;
			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		}
		throw new Error(`Marge : ${count} repères attendus, ${bars().length} trouvés`);
	};
	try {
		await waitForBars(2);
		check(!other.dom.querySelector(".finition-correction-line"), "Une autre note hérite des repères d’erreur");
		check(bars().every(bar => getComputedStyle(bar).borderLeftWidth === "2px"), "Le repère vertical n’est pas visible");
		const rgb = getComputedStyle(bars()[0]).borderLeftColor.match(/\d+/gu)!.map(Number);
		check(rgb[0] > rgb[1] && rgb[0] > rgb[2], "Le repère de correction doit être rouge");
		view.dom.querySelector<HTMLElement>(".finition-ai-ins")!.click();
		await waitForBars(1);
		check(view.state.doc.toString().startsWith("Une faute."), "Le repère disparaît sans validation de la correction");
		analysis.grammalecteErrors = [];
		analysis.grammalecteErrorsVersion++;
		view.dispatch({});
		await waitForBars(0);
		const end = view.state.doc.line(2).to, last = view.state.doc.line(4).from;
		analysis.aiGroups = [
			{ id: 1, delFrom: 0, delTo: end, delText: view.state.doc.sliceString(0, end), insText: "Texte revu." },
			{ id: 2, delFrom: 0, delTo: 0, delText: "", insText: "Ajout " },
			{ id: 3, delFrom: last, delTo: last, delText: "", insText: "Autre " },
		];
		analysis.aiGroupsVersion++;
		view.dispatch({});
		await waitForBars(3);
		check(bars().length === 3, "Les corrections multilignes, ajouts ou doublons produisent de mauvais repères");
		analysis.aiGroups = [];
		analysis.aiGroupsVersion++;
		view.dispatch({});
		await waitForBars(0);
	} finally { view.destroy(); other.destroy(); }
}
