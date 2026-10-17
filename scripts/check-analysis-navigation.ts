import { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { App, MarkdownView } from "obsidian";
import FinitionPlugin from "../main";
import { DEFAULT_SETTINGS, FinitionMode, Highlight } from "../types";

export async function checkAnalysisNavigation(menuOpened: () => number): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const turn = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
	const waitFor = async (condition: () => boolean, message: string) => {
		for (let attempt = 0; attempt < 20; attempt++) {
			if (condition()) return;
			await turn();
		}
		throw new Error(message);
	};
	const plugin = new FinitionPlugin({} as App, { id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.0.0", description: "", author: "" });
	const host = plugin as unknown as { saved: unknown; extensions: Extension[]; cleanup: Array<() => void> };
	host.saved = { ...DEFAULT_SETTINGS, mode: "none", debounceMs: 0 };
	let active: MarkdownView | null = null;
	plugin.app = { workspace: {
		getActiveViewOfType: () => active,
		iterateAllLeaves: (visit: (leaf: { view: MarkdownView }) => void) => { if (active) visit({ view: active }); },
		on: () => ({}),
	} } as unknown as App;
	await plugin.onload();
	const parent = document.body.createDiv();
	const text = "Introduction.\n\nIl semblerait que tout change. Il semblerait que rien ne bouge.";
	const view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions: host.extensions }) });
	active = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { editor: { cm: view } });
	const counter = document.querySelector<HTMLElement>(".finition-analysis-count");
	const next = document.querySelector<HTMLButtonElement>(".finition-next-occurrence");
	check(counter && next, "Compteur et flèche absents");
	const activate = async (mode: FinitionMode, expected: number, first: number) => {
		document.querySelector<HTMLElement>("#result")!.dataset.stage = mode;
		view.dispatch({ selection: { anchor: view.state.doc.length } });
		await plugin.setMode(mode);
		document.querySelector<HTMLElement>("#result")!.dataset.stage = `${mode}: mode activé`;
		await waitFor(() => counter!.textContent === String(expected) && view.state.selection.main.head === first && view.hasFocus, `Activation ${mode} : compteur ou première occurrence incorrects`);
	};
	await activate("hedging", 2, text.indexOf("Il semblerait"));
	next!.click();
	check(view.state.selection.main.head === text.lastIndexOf("Il semblerait"), "La flèche ne rejoint pas l’occurrence suivante");
	next!.click();
	check(view.state.selection.main.head === text.indexOf("Il semblerait"), "La flèche ne boucle pas vers la première occurrence");
	check(menuOpened() === 0, "La flèche ouvre aussi le menu des modes");
	check(view.state.doc.toString() === text, "La navigation a modifié le texte");
	view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Un texte sans locution." } });
	await waitFor(() => counter!.textContent === "0" && next!.disabled, "Le compteur reste périmé après modification");
	const replace = (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
	const stereotype = "Préambule. Il serrait les poings. Elle serrait les poings.";
	replace(stereotype);
	await activate("stereotype", 2, stereotype.indexOf("serrait"));
	replace("Le chat dort. Le chien court. Le vent souffle.");
	await activate("burstiness", 3, 0);
	const ternary = "Introduction.\n\nUn rire sec, maigre, tordu.";
	for (const [word, category] of Object.entries({ introduction: "nom", un: "déterminant", rire: "nom|verbe", sec: "adjectif|nom", maigre: "adjectif|nom", tordu: "participe|adjectif" })) plugin.wordCategoryCache.set(word, category);
	replace(ternary);
	await activate("ternary", 1, ternary.indexOf("Un rire"));
	await plugin.setMode("ternary");
	await waitFor(() => counter!.hidden && next!.hidden, "Les contrôles restent visibles quand le mode est désactivé");
	check(getComputedStyle(counter!).display === "none" && getComputedStyle(next!).display === "none", "Les contrôles masqués occupent encore la barre d’état");
	await plugin.setMode("hedging");
	await waitFor(() => counter!.textContent === "0", "Le mode vide ne revient pas à zéro");
	const internal = plugin as unknown as {
		analysisNavigation: { requestFirst: () => void };
		updateAnalysisHighlights: (view: EditorView, highlights: Highlight[], pending: boolean) => void;
	};
	const ranges = [{ from: 2, to: 4, lemma: "fixture", colorIndex: 0 }];
	view.dispatch({ selection: { anchor: view.state.doc.length } });
	internal.updateAnalysisHighlights(view, ranges, true);
	internal.analysisNavigation.requestFirst();
	await turn();
	check(counter!.textContent === "…" && next!.disabled && view.state.selection.main.head === view.state.doc.length, "Un résultat provisoire déclenche la navigation");
	internal.updateAnalysisHighlights(view, ranges, false);
	await waitFor(() => view.state.selection.main.head === 2, "La résolution asynchrone ne rejoint pas la première occurrence");
	const other = new EditorView({ parent: document.body.createDiv(), state: EditorState.create({ doc: "Autre note." }) });
	view.dispatch({ selection: { anchor: view.state.doc.length } });
	internal.analysisNavigation.requestFirst();
	active = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { editor: { cm: other } });
	internal.updateAnalysisHighlights(view, ranges, false);
	plugin.updateStatusBarIcon();
	await turn();
	check(view.state.selection.main.head === view.state.doc.length, "Une navigation différée déplace le curseur d’une note inactive");
	check(counter!.textContent !== "1", "Une note inactive écrase le compteur actif");
	active = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { editor: { cm: view } });
	await plugin.setMode("hedging");
	const misspelled = "Une fote. Une autre fote.";
	replace(misspelled);
	const firstError = misspelled.indexOf("fote"), lastError = misspelled.lastIndexOf("fote");
	plugin.grammalecteErrors = [firstError, lastError].map(nStart => ({ nStart, nEnd: nStart + 4, sType: "orthographe", sMessage: "Orthographe", sRuleId: "test", aSuggestions: ["faute"], sValue: "fote" }));
	plugin.grammalecteErrorsVersion++;
	plugin.refreshAllEditors();
	await waitFor(() => counter!.textContent === "2" && !next!.hidden && !next!.disabled, "Grammalecte : compteur et flèche absents");
	check(next!.getAttribute("aria-label") === "Faute suivante", "Grammalecte : flèche sans libellé adapté");
	view.dispatch({ selection: { anchor: 0 } });
	next!.click();
	check(view.state.selection.main.head === firstError && view.hasFocus, "Grammalecte : première faute inaccessible");
	next!.click();
	check(view.state.selection.main.head === lastError, "Grammalecte : faute suivante inaccessible");
	next!.click();
	check(view.state.selection.main.head === firstError, "Grammalecte : retour à la première faute absent");
	check(menuOpened() === 0 && view.state.doc.toString() === misspelled, "Grammalecte : navigation modifie le texte ou ouvre le menu");
	active = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { editor: { cm: other } });
	plugin.updateStatusBarIcon();
	check(next!.hidden, "Grammalecte : navigation proposée dans une note non analysée");
	active = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { editor: { cm: view } });
	plugin.updateStatusBarIcon();
	check(!next!.hidden && counter!.textContent === "2", "Grammalecte : navigation perdue au retour dans la note");
	const error = view.dom.querySelector<HTMLElement>(".finition-grammalecte-spelling")!;
	error.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
	document.querySelector<HTMLButtonElement>(".finition-grammalecte-popup-suggestions button")!.click();
	check(view.state.doc.toString() === "Une faute. Une autre fote.", "Grammalecte : correction non appliquée");
	await waitFor(() => counter!.textContent === "1", "Grammalecte : compteur périmé après correction");
	next!.click();
	check(view.state.selection.main.head === view.state.doc.toString().indexOf("fote"), "Grammalecte : positions périmées après correction");
	view.dom.querySelector<HTMLElement>(".finition-grammalecte-spelling")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
	document.querySelector<HTMLButtonElement>(".finition-grammalecte-popup-ignore")!.click();
	await waitFor(() => next!.hidden || next!.disabled, "Grammalecte : navigation toujours active sans faute");
	check(!view.dom.querySelector(".finition-grammalecte-spelling"), "Grammalecte : faute ignorée toujours soulignée");
	active = null;
	plugin.updateStatusBarIcon();
	check(counter!.hidden && next!.hidden, "Les contrôles restent visibles sans éditeur");
	plugin.onunload();
	for (const cleanup of host.cleanup) cleanup();
	view.destroy();
	other.destroy();
}
