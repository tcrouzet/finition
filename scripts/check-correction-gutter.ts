import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { finitionAIExtension } from "../plugin/ai/ai-extension";
import { NoteAnalyses } from "../plugin/note-analysis";
import { correctionGutter } from "../plugin/ui/correction-gutter";
import { finitionGrammalecteExtension } from "../plugin/grammalecte-extension";
import type FinitionPlugin from "../plugin/main";

export async function checkCorrectionGutter(): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const source = "Une fote.\nUne ligne correcte.\nEncore une errer.\nDernière ligne.";
	const file = { path: "corrections.md" }, otherFile = { path: "autre.md" };
	const analyses = new NoteAnalyses();
	const analysis = analyses.activate(file);
	analysis.aiSourcePath = file.path;
	analysis.aiGroups = [{ id: 0, delFrom: 4, delTo: 8, delText: "fote", insText: "faute" }];
	analysis.grammalecteErrors = [{ nStart: source.indexOf("errer"), nEnd: source.indexOf("errer") + 5, sRuleId: "test", sType: "orthographe", sMessage: "Faute", aSuggestions: ["erreur"] }];
	const host = { ...analysis, settings: { grammalecteColorIndex: 0 }, settingsVersion: 0, updateGrammalecteHighlights() {}, getNoteAnalysis: (view: EditorView, update?: import("@codemirror/view").ViewUpdate) => analyses.forView(view, update) };
	const create = (file: { path: string }) => {
		const state = EditorState.create({ doc: source, extensions: [editorInfoField, EditorView.lineWrapping, finitionAIExtension(host), finitionGrammalecteExtension(host as unknown as FinitionPlugin), correctionGutter(host)] });
		Object.assign(state.field(editorInfoField), { file });
		return new EditorView({ state, parent: document.body.createDiv() });
	};
	const view = create(file), other = create(otherFile);
	view.dom.scrollIntoView();
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
		check(!view.dom.querySelector(".cm-gutters"), "Le repère de correction modifie la mise en page de l’éditeur");
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
		const wrapped = "Une fote. " + "Une suite correcte sans erreur. ".repeat(18);
		view.dom.classList.add("finition-test-correction-wrap");
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: wrapped } });
		analysis.aiGroups = [{ id: 4, delFrom: 4, delTo: 8, delText: "fote", insText: "Une correction qui occupe plusieurs lignes. ".repeat(3) }];
		analysis.aiGroupsVersion++;
		view.dispatch({});
		const verifyRows = async () => {
			for (let frame = 0; frame < 4; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
			const line = view.contentDOM.querySelector<HTMLElement>(".cm-line")!.getBoundingClientRect();
			const fragments = Array.from(view.dom.querySelectorAll<HTMLElement>(".finition-ai-del, .finition-ai-ins")).flatMap(span => Array.from(span.getClientRects()));
			check(bars().length > 1, "Une correction repliée sur plusieurs lignes n’a qu’un repère de paragraphe");
			for (const bar of bars()) {
				const rect = bar.getBoundingClientRect();
				check(rect.height < line.height / 2 && rect.height <= 30, "Un repère couvre le paragraphe au lieu d’une ligne visuelle");
				check(rect.right <= view.coordsAtPos(0)!.left && fragments.some(fragment => Math.abs(fragment.top - rect.top) < 2), "Un repère n’est pas dans la marge de la ligne fautive");
			}
			for (const fragment of fragments) check(bars().some(bar => Math.abs(bar.getBoundingClientRect().top - fragment.top) < 2), "Une ligne visuelle de correction n’a pas son repère");
		};
		await verifyRows();
		view.dom.classList.add("finition-test-correction-wrap-wide");
		view.requestMeasure();
		await verifyRows();
		view.scrollDOM.classList.add("finition-test-correction-scroll");
		view.requestMeasure();
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		view.scrollDOM.scrollTop = 500;
		check(view.scrollDOM.scrollTop > 0, "Le scénario de marge ne déclenche pas le défilement");
		await waitForBars(0);
		view.scrollDOM.scrollTop = 0;
		for (let frame = 0; frame < 4; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		check(bars().length > 1, "Les repères ne suivent pas le retour vers les lignes corrigées après défilement");
		analysis.aiGroups = [];
		analysis.aiGroupsVersion++;
		view.dispatch({});
		await waitForBars(0);
	} finally { view.destroy(); other.destroy(); }
}
