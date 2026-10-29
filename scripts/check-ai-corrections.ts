import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { finitionAIExtension, type AIGroup } from "../plugin/ai/ai-extension";
import { protectLinks } from "../plugin/ai/protected-links";
import { cleanTypography } from "../plugin/ai/clean";
import { splitIntoChunks } from "../plugin/ai/chunk";
import { NoteAnalyses } from "../plugin/note-analysis";
import { diffToGroups } from "../plugin/ai/diff";
import { fixPunctuationSpacing, fixBlankLinesProtected } from "../plugin/modes/punctuation";
import { undo, redo } from "@codemirror/commands";

export async function checkAICorrectionLayout(): Promise<void> {
	const paragraph = "Cette demande est légitime. Je ne cesse de m’y plier, quand je renonce à publier le modèle neuronal et les dictionnaires. ".repeat(4);
	const source = Array.from({ length: 15 }, () => paragraph).join("\n\n");
	const host = { aiSourcePath: "source.md", aiGroups: [] as AIGroup[], aiGroupsVersion: 0 };
	const state = EditorState.create({ doc: source, extensions: [editorInfoField, EditorView.lineWrapping, finitionAIExtension(host)] });
	Object.assign(state.field(editorInfoField), { file: { path: "source.md" } });
	const parent = document.body.createDiv();
	parent.className = "markdown-source-view mod-cm6 is-live-preview finition-test-ai-layout";
	const view = new EditorView({ parent, state });
	parent.scrollIntoView();
	const settle = async () => { for (let i = 0; i < 4; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); };
	try {
		await settle();
		host.aiGroups = [
			{ id: 0, delFrom: 10, delTo: 17, delText: source.slice(10, 17), insText: "Une proposition de correction bien plus longue, qui occupe plusieurs lignes.\n\nUn nouveau paragraphe. " },
			{ id: 1, delFrom: paragraph.length + 30, delTo: paragraph.length + 38, delText: source.slice(paragraph.length + 30, paragraph.length + 38), insText: "Une seconde proposition très longue. ".repeat(15) },
			{ id: 2, delFrom: paragraph.length - 1, delTo: paragraph.length, delText: " ", insText: "." },
		];
		host.aiGroupsVersion++;
		view.dispatch({});
		await settle();
		if (!view.dom.querySelector(".finition-ai-ins")) throw new Error("La correction longue n’est pas rendue dans le scénario de mise en page");
		for (const line of Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"))) {
			const position = view.posAtDOM(line), block = view.lineBlockAt(position), rect = line.getBoundingClientRect();
			if (line.querySelector(".finition-ai-ins") && rect.height < 30) throw new Error("Une ligne de correction est traitée comme un paragraphe vide par le thème");
			if (Math.abs(rect.height - block.height) > 2) throw new Error(`Hauteur IA incohérente : DOM=${rect.height}, CodeMirror=${block.height}, position=${position}`);
		}
		const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"));
		for (let i = 1; i < lines.length; i++) if (lines[i - 1].getBoundingClientRect().bottom > lines[i].getBoundingClientRect().top + 1) throw new Error("Les paragraphes de correction IA se chevauchent");
		if (view.state.doc.toString() !== source) throw new Error("La prévisualisation multilignes modifie la note");
		host.aiGroups = splitIntoChunks(source, 0).flatMap(chunk => {
			const revised = chunk.text.replaceAll("demande", "requête motivée").replaceAll("cesse", "m’arrête").replaceAll("légitime", "justifiée").replaceAll("modèle neuronal", "modèle\n\nlocal").replaceAll("dictionnaires", "ouvrages de référence");
			return protectLinks(source, chunk.start, chunk.end).diff(revised).map(group => ({ ...group, delFrom: chunk.start + group.delFrom, delTo: chunk.start + group.delTo }));
		}).map((group, id) => ({ ...group, id }));
		host.aiGroupsVersion++;
		view.dispatch({});
		for (const top of [0, 1200, 3000, 0]) {
			view.scrollDOM.scrollTop = top;
			await settle();
			const visible = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"));
			if (!view.dom.querySelector(".finition-ai-ins")) throw new Error(`Les suggestions disparaissent après le défilement : ${top}, plage ${view.viewport.from}–${view.viewport.to}`);
			for (let index = 0; index < visible.length; index++) {
				const rect = visible[index].getBoundingClientRect();
				if (Math.abs(rect.height - view.lineBlockAt(view.posAtDOM(visible[index])).height) > 2) throw new Error("Les mesures des paragraphes divergent après un lot de corrections");
				if (index && visible[index - 1].getBoundingClientRect().bottom > rect.top + 1) throw new Error("Les nombreux paragraphes corrigés se chevauchent");
			}
		}
		if (view.state.doc.toString() !== source) throw new Error("L’affichage d’un lot de corrections modifie la note");
	} finally { view.destroy(); parent.remove(); }
}

export function checkAICorrections(): void {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const multiline = "Début.\n\nUn mot\nsur deux lignes.\n\nFin.";
	for (const [from, to, replacement, expectedLines] of [
		[multiline.indexOf("Un"), multiline.indexOf("lignes.") + 7, "Autre texte.", [3, 4]],
		[7, 7, "Ajout.", [2]],
		[7, 8, null, [1]],
	] as const) {
		const host = { aiSourcePath: "lignes.md", aiGroups: [{ id: 0, delFrom: from, delTo: to, delText: multiline.slice(from, to), insText: replacement }] as AIGroup[], aiGroupsVersion: 0 };
		const state = EditorState.create({ doc: multiline, extensions: [editorInfoField, finitionAIExtension(host)] });
		Object.assign(state.field(editorInfoField), { file: { path: host.aiSourcePath } });
		const parent = document.body.createDiv(), view = new EditorView({ parent, state });
		const decoratedLines = () => Array.from(view.contentDOM.querySelectorAll(".cm-line.finition-ai-line"), line => view.state.doc.lineAt(view.posAtDOM(line)).number);
		try {
			check(JSON.stringify(decoratedLines()) === JSON.stringify(expectedLines), "Les classes de hauteur ne ciblent pas les lignes contenant une correction");
			view.dom.querySelector<HTMLElement>(".finition-ai-reject")!.click();
			check(decoratedLines().length === 0, "Une ligne conserve la hauteur des corrections après refus");
			check(undo(view) && JSON.stringify(decoratedLines()) === JSON.stringify(expectedLines), "Annuler ne restaure pas les classes de hauteur des corrections");
			check(view.state.doc.toString() === multiline, "Les classes de ligne modifient la note");
		} finally { view.destroy(); parent.remove(); }
	}
	const source = "Un inutile texte. Une fote.";
	const firstFile = { path: "première.md" }, otherFile = { path: "autre.md" }, analyses = new NoteAnalyses();
	const saved = analyses.activate(firstFile);
	Object.assign(saved, { aiSourcePath: firstFile.path, aiGroups: [{ id: 0, delFrom: 22, delTo: 26, delText: "fote", insText: "faute" }] });
	const runtime = { ...saved, getNoteAnalysis: (view: EditorView, update?: import("@codemirror/view").ViewUpdate) => analyses.forView(view, update) };
	const initial = EditorState.create({ doc: source, extensions: [editorInfoField, finitionAIExtension(runtime)] });
	Object.assign(initial.field(editorInfoField), { file: firstFile });
	const parent = document.body.createDiv(), reused = new EditorView({ parent, state: initial });
	try {
		for (const [file, text] of [[otherFile, "Une autre note."], [firstFile, source]] as const) {
			analyses.activate(file);
			Object.assign(reused.state.field(editorInfoField), { file });
			reused.dispatch({});
			check(!reused.dom.querySelector("[data-finition-ai-group]"), "Le chargement transitoire affiche les corrections sur le mauvais texte");
			reused.dispatch({ changes: { from: 0, to: reused.state.doc.length, insert: text } });
		}
		check(saved.aiGroups.length === 1 && reused.dom.querySelector(".finition-ai-del")?.textContent === "fote" && reused.dom.querySelector(".finition-ai-ins")?.textContent === "faute", "Le retour dans la note ne réaffiche pas les corrections IA");
	} finally { reused.destroy(); parent.remove(); }
	for (const [kind, end, insertion, applied] of [
		["insertion", 3, "joli ", "Un joli inutile texte. Une fote."],
		["replacement", 11, "joli ", "Un joli texte. Une fote."],
		["deletion", 11, null, "Un texte. Une fote."],
	] as const) for (const action of ["reject", "red", "green", "keyboard-red", "keyboard-green"]) {
		if (kind === "insertion" && action.endsWith("red") || kind === "deletion" && action.endsWith("green")) continue;
		const groups: AIGroup[] = [
			{ id: 0, delFrom: 3, delTo: end, delText: source.slice(3, end), insText: insertion },
			{ id: 1, delFrom: source.indexOf("fote"), delTo: source.indexOf("fote") + 4, delText: "fote", insText: "faute" },
		];
		const host = { aiSourcePath: "source.md", aiGroups: groups, aiGroupsVersion: 0 };
		const state = EditorState.create({ doc: source, extensions: [editorInfoField, finitionAIExtension(host)] });
		Object.assign(state.field(editorInfoField), { file: { path: "source.md" } });
		const view = new EditorView({ parent: document.body.createDiv(), state });
		try {
			check(view.state.doc.toString() === source, "L’affichage modifie le document");
			const find = <T extends HTMLElement>(cls: string) => view.dom.querySelector<T>(`.${cls}[data-finition-ai-group="0"]`);
			const reject = find<HTMLButtonElement>("finition-ai-reject");
			const green = find<HTMLElement>("finition-ai-ins"), red = find<HTMLElement>("finition-ai-del");
			check(!!reject && view.dom.querySelectorAll('button[data-finition-ai-group="0"]').length === 1 && !view.dom.querySelector(".finition-ai-accept"), "Seule la poubelle doit accompagner la suggestion");
			check(reject!.tagName === "BUTTON" && reject!.getAttribute("aria-label") === "Refuser la correction" && reject!.dataset.icon === "trash-2", "Le refus n’a pas de poubelle accessible");
			check((green ?? red)!.compareDocumentPosition(reject!) & Node.DOCUMENT_POSITION_FOLLOWING, "La poubelle doit suivre le passage concerné");
			const control = action === "reject" ? reject! : action.endsWith("red") ? red! : green!;
			if (control.tagName === "BUTTON") {
				control.focus();
				check(document.activeElement === control, "Action IA inaccessible au clavier");
			}
			if (action.startsWith("keyboard")) {
				check(control.getAttribute("role") === "button" && control.tabIndex === 0, "La zone colorée est inaccessible au clavier");
				control.focus();
				check(document.activeElement === control, "Impossible de placer le focus sur la correction colorée");
				control.dispatchEvent(new KeyboardEvent("keydown", { key: action.endsWith("red") ? "Enter" : " ", bubbles: true, cancelable: true }));
			} else control.click();
			const expected = action === "reject" ? source : applied;
			check(view.state.doc.toString() === expected, `Mauvaise action ${action} pour ${kind}`);
			check(host.aiGroups.length === 1 && !view.dom.querySelector('[data-finition-ai-group="0"]'), "La correction traitée reste affichée");
			view.dom.querySelector<HTMLElement>('.finition-ai-ins[data-finition-ai-group="1"]')!.click();
			check(view.state.doc.toString() === expected.replace("fote", "faute"), "Les corrections suivantes perdent leur position");
			check(host.aiGroups.length === 0 && !view.dom.querySelector("[data-finition-ai-group]"), "Une suggestion validée reste affichée");
		} finally { view.destroy(); }
	}
	const host = { aiSourcePath: "source.md", aiGroups: [
		{ id: 0, delFrom: 3, delTo: 11, delText: "inutile ", insText: "joli " },
		{ id: 1, delFrom: source.indexOf("fote"), delTo: source.indexOf("fote") + 4, delText: "fote", insText: "faute" },
	], aiGroupsVersion: 0 };
	const state = EditorState.create({ doc: source, extensions: [editorInfoField, finitionAIExtension(host)] });
	Object.assign(state.field(editorInfoField), { file: { path: "source.md" } });
	const view = new EditorView({ parent: document.body.createDiv(), state });
	try {
		view.dispatch({ changes: { from: 11, to: source.indexOf("fote"), insert: "" } });
		check(view.dom.querySelectorAll(".finition-ai-reject").length === 2, "Deux corrections devenues adjacentes perdent leurs poubelles");
		view.dom.querySelector<HTMLElement>('.finition-ai-ins[data-finition-ai-group="0"]')!.click();
		view.dom.querySelector<HTMLElement>('.finition-ai-ins[data-finition-ai-group="1"]')!.click();
		check(view.state.doc.toString() === "Un joli faute." && host.aiGroups.length === 0, "Les actions perdent leur position après rapprochement des corrections");
	} finally { view.destroy(); }
	for (const apply of [true, false]) {
		const source = "Elle l’embrassait, à Paris, tous les jours.";
		const revised = "Elle l’embrassait; à Paris; tous les jours!";
		const host = { aiSourcePath: "source.md", aiGroups: protectLinks(source).diff(revised).map((group, id) => ({ ...group, id })), aiGroupsVersion: 0 };
		const state = EditorState.create({ doc: source, extensions: [editorInfoField, finitionAIExtension(host)] });
		Object.assign(state.field(editorInfoField), { file: { path: "source.md" } });
		const view = new EditorView({ parent: document.body.createDiv(), state });
		try {
			for (const span of Array.from(view.dom.querySelectorAll(".finition-ai-del, .finition-ai-ins"))) check(!/\p{L}/u.test(span.textContent ?? ""), "Une correction de ponctuation recolore le mot voisin");
			for (const group of [...host.aiGroups]) {
				const cls = apply ? group.insText ? "finition-ai-ins" : "finition-ai-del" : "finition-ai-reject";
				view.dom.querySelector<HTMLElement>(`.${cls}[data-finition-ai-group="${group.id}"]`)!.click();
			}
			check(view.state.doc.toString() === (apply ? cleanTypography(revised) : source), "La validation ou le refus de ponctuation modifie le texte voisin");
		} finally { view.destroy(); }
	}
	for (const accept of [true, false]) {
		const source = "---\ntitle: secret!\n---\n#secret\n\n– Bonjour! «oui»... 27 ans [lien](https://example.org).\n\n\nSuite.\n";
		const fixed = fixBlankLinesProtected(fixPunctuationSpacing(source));
		const groups = diffToGroups(source, fixed).map((group, id) => ({ ...group, id }));
		check(groups.length > 0 && groups.every(group => !/\p{L}/u.test(group.delText + (group.insText ?? ""))), "La ponctuation proposée englobe des mots inchangés");
		const host = { aiSourcePath: "ponctuation.md", aiGroups: groups, aiGroupsVersion: 0 };
		const state = EditorState.create({ doc: source, extensions: [editorInfoField, finitionAIExtension(host)] });
		Object.assign(state.field(editorInfoField), { file: { path: host.aiSourcePath } });
		const parent = document.body.createDiv(), view = new EditorView({ parent, state });
		try {
			const originalGroups = JSON.stringify(groups);
			for (const group of [...host.aiGroups]) {
				const selector = !accept ? ".finition-ai-reject" : group.insText ? ".finition-ai-ins" : ".finition-ai-del";
				const target = view.dom.querySelector<HTMLElement>(`${selector}[data-finition-ai-group="${group.id}"]`);
				check(target, "Une proposition de ponctuation n’a pas de contrôle de validation"); target!.click();
			}
			check(view.state.doc.toString() === (accept ? fixed : source) && host.aiGroups.length === 0, "La validation individuelle de la ponctuation altère le texte");
			for (let operation = 0; operation < groups.length; operation++) check(undo(view), "L’annulation d’une correction de ponctuation est perdue");
			check(view.state.doc.toString() === source && JSON.stringify(host.aiGroups) === originalGroups, "Annuler ne restaure pas les propositions de ponctuation");
			for (let operation = 0; operation < groups.length; operation++) check(redo(view), "Le rétablissement d’une correction de ponctuation est perdu");
			check(view.state.doc.toString() === (accept ? fixed : source) && host.aiGroups.length === 0, "Rétablir ne rejoue pas les décisions de ponctuation");
		} finally { view.destroy(); parent.remove(); }
	}
}
