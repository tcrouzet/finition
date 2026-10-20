import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { App, EditorPosition, MarkdownView } from "obsidian";
import { synonymContext, parseSynonyms, runSynonyms } from "../plugin/ai/synonyms";
import { splitIntoChunks } from "../plugin/ai/chunk";
import prompt from "../plugin/ai/system-prompt-synonymes.md";
import { DEFAULT_SETTINGS } from "../plugin/types";

type Request = { url: string; body: string; headers: Record<string, string> };
type Response = { status: number; json: unknown; text?: string };

export async function checkSynonyms(setHandler: (handler: (request: Request) => Response) => void, requests: Request[], notices: string[], modals: Array<{ close: () => void }>): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const equal = (actual: unknown, expected: unknown, label: string) => check(JSON.stringify(actual) === JSON.stringify(expected), `${label} : ${JSON.stringify(actual)}`);
	const text = "Premier.\n\nLe pas rapide.\n\nDernier.";
	const from = text.indexOf("rapide");
	const to = from + "rapide".length;
	equal(synonymContext(text, from, to), "Premier.\n\nLe pas **rapide**.\n\nDernier.", "Contexte central");
	equal(synonymContext(text, 0, 7), "**Premier**.\n\nLe pas rapide.\n\n", "Premier paragraphe");
	equal(synonymContext(text, text.indexOf("Dernier"), text.length - 1), "Le pas rapide.\n\n**Dernier**.", "Dernier paragraphe");
	const padding = "Hors contexte.\n\n";
	equal(synonymContext(`${padding}${text}\n\nHors contexte.`, from + padding.length, to + padding.length), "Premier.\n\nLe pas **rapide**.\n\nDernier.\n\n", "Seulement les paragraphes voisins");
	equal(synonymContext("Un œil vif.", 3, 6), "Un **œil** vif.", "Sélection Unicode");
	const crlf = text.replace(/\n/g, "\r\n");
	equal(synonymContext(crlf, crlf.indexOf("rapide"), crlf.indexOf("rapide") + 6), "Premier.\r\n\r\nLe pas **rapide**.\r\n\r\nDernier.", "Paragraphes CRLF");
	equal(splitIntoChunks(crlf, 0).length, 3, "Bornes des paragraphes CRLF");
	for (const source of [text, crlf, "\n\nUn paragraphe.\n \n\nDeuxième.\n\n"]) {
		for (const size of [0, 10, 1000]) equal(splitIntoChunks(source, size).map((chunk) => chunk.text).join(""), source, "Découpage sans perte");
	}
	equal(parseSynonyms("Introduction\n- vif\n* véloce\n• prompt\n- VIF\n- \n"), ["vif", "véloce", "prompt"], "Liste et dédoublonnage");
	let rejected = false;
	try { synonymContext(text, 3, 3); } catch { rejected = true; }
	check(rejected, "Une sélection vide est acceptée");
	const view = new EditorView({ parent: document.body.createDiv(), state: EditorState.create({ doc: text, selection: { anchor: to, head: from } }) });
	const position = (offset: number): EditorPosition => {
		const line = view.state.doc.lineAt(offset);
		return { line: line.number - 1, ch: offset - line.from };
	};
	const offset = (pos: EditorPosition) => view.state.doc.line(pos.line + 1).from + pos.ch;
	const editor = {
		getValue: () => view.state.doc.toString(),
		getSelection: () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
		listSelections: () => view.state.selection.ranges.map((range) => ({ anchor: position(range.anchor), head: position(range.head) })),
		getCursor: (which: "from" | "to") => position(view.state.selection.main[which]),
		posToOffset: offset, offsetToPos: position,
		replaceRange: (insert: string, from: EditorPosition, to: EditorPosition) => view.dispatch({ changes: { from: offset(from), to: offset(to), insert } }),
		setSelection: (anchor: EditorPosition, head: EditorPosition) => view.dispatch({ selection: { anchor: offset(anchor), head: offset(head) } }),
		focus: () => view.focus(),
	};
	const markdown = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { editor, file: { path: "test.md" } });
	let active: MarkdownView | null = markdown;
	const app = { workspace: { getActiveViewOfType: () => active } } as unknown as App;
	const settings = { ...DEFAULT_SETTINGS, aiModel: "claude-test", aiApiKey: "test-anthropic", openaiApiKey: "test-openai", aiMaxTokens: 1234 };
	setHandler(() => ({ status: 200, json: { content: [{ type: "text", text: "- vif\n- véloce" }] } }));
	const before = requests.length;
	await runSynonyms(app, settings);
	check(requests.length === before + 1, "Une liste courte déclenche plusieurs appels");
	const anthropic = requests.at(-1)!;
	const body = JSON.parse(anthropic.body) as { model: string; max_tokens: number; system: string; messages: Array<{ role: string; content: string }> };
	equal(anthropic.url, "https://api.anthropic.com/v1/messages", "Fournisseur Claude");
	equal(anthropic.headers["x-api-key"], "test-anthropic", "Clé Claude");
	equal(body, { model: settings.aiModel, max_tokens: 1234, system: prompt, messages: [{ role: "user", content: "Premier.\n\nLe pas **rapide**.\n\nDernier." }] }, "Requête avec prompt dédié et sélection inversée");
	const list = document.querySelector<HTMLElement>(".finition-synonyms")!;
	check(list?.querySelectorAll("li").length === 2, "Propositions absentes");
	{
		const modal = list.closest<HTMLElement>(".modal")!;
		const footer = modal.querySelector<HTMLElement>(".finition-synonyms-footer")!;
		check(footer && modal.lastElementChild === footer, "Bouton de remarque absent du pied de fenêtre");
		const insert = footer.querySelector<HTMLButtonElement>("button")!;
		check(insert.getAttribute("aria-label") === "Insérer la liste en remarque" && insert.dataset.icon === "message-square-plus" && !insert.textContent, "Icône de remarque sans nom accessible ou encore accompagnée de texte");
		check(!list.querySelector('[aria-label^="Copier "]') && modal.querySelectorAll(".finition-synonyms-insert").length === 1, "Plusieurs boutons de remarque dans la liste");
		const rows = Array.from(list.querySelectorAll("li"));
		equal(rows[0].getBoundingClientRect().top, rows[1].getBoundingClientRect().top, "Les mots ne sont pas disposés sur une ligne compacte");
		const choice = rows[0].querySelector<HTMLButtonElement>("button")!;
		choice.focus();
		check(document.activeElement === choice && getComputedStyle(choice).outlineStyle === "solid", `Focus : actif=${document.activeElement === choice}, clavier=${choice.matches(":focus-visible")}, contour=${getComputedStyle(choice).outlineStyle}, accent=${getComputedStyle(choice).getPropertyValue("--interactive-accent")}`);
		insert.focus();
		check(document.activeElement === insert, "Icône de remarque inaccessible au clavier");
		const title = modal.querySelector("h2")!;
		const bounds = modal.getBoundingClientRect();
		const pointer = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y }));
		pointer(title, "pointerdown", bounds.left + 10, bounds.top + 10);
		pointer(document, "pointermove", bounds.left + 60, bounds.top + 50);
		const moved = modal.getBoundingClientRect();
		equal([moved.left - bounds.left, moved.top - bounds.top], [50, 40], "Déplacement de la fenêtre par son titre");
		pointer(document, "pointermove", innerWidth * 2, innerHeight * 2);
		const clamped = modal.getBoundingClientRect();
		check(clamped.left >= 0 && clamped.top >= 0 && clamped.right <= innerWidth && clamped.bottom <= innerHeight, "La fenêtre sort de l’écran");
		pointer(document, "pointerup", 0, 0);
		pointer(document, "pointermove", 0, 0);
		equal(modal.getBoundingClientRect().toJSON(), clamped.toJSON(), "Le déplacement continue après relâchement");
		pointer(title, "pointerdown", clamped.left + 10, clamped.top + 10);
		pointer(document, "pointermove", -innerWidth, -innerHeight);
		equal([modal.getBoundingClientRect().left, modal.getBoundingClientRect().top], [0, 0], "Reprise du déplacement et limites supérieures");
		pointer(document, "pointercancel", 0, 0);
		pointer(document, "pointermove", 100, 100);
		equal([modal.getBoundingClientRect().left, modal.getBoundingClientRect().top], [0, 0], "Annulation du déplacement");
		equal(view.state.doc.toString(), text, "La consultation ne modifie pas la note");
		list.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.click();
		equal(view.state.doc.toString(), text.replace("rapide", "vif"), "Remplacement de la seule sélection");
		equal(editor.getSelection(), "vif", "Le synonyme remplacé reste sélectionné");
		check(view.hasFocus, "Le remplacement ne rend pas le focus à la note");
		check(!document.querySelector(".finition-synonyms"), "La liste reste ouverte après remplacement");
	}
	const reset = () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: from, head: to } });
	reset();
	await runSynonyms(app, settings);
	// Obsidian réinitialise son champ interne selection à l’ouverture.
	Reflect.set(modals.at(-1)!, "selection", null);
	document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!.click();
	equal(editor.getValue(), "Premier.\n\nLe pas rapide.\n\n%%\nSynonymes IA — rapide\n\n- vif, véloce\n%%\n\nDernier.", "Liste IA après le paragraphe sélectionné");
	check(editor.getSelection() === "rapide" && view.hasFocus && !document.querySelector(".finition-synonyms"), "La remarque perd la sélection ou laisse la fenêtre ouverte");
	reset();
	await runSynonyms(app, settings);
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.focus();
	modals.at(-1)!.close();
	equal(editor.getValue(), text, "Fermer sans choix ne modifie pas la note");
	equal(editor.getSelection(), "rapide", "Fermer sans choix conserve la sélection");
	check(view.hasFocus, "Fermer sans choix ne réactive pas la sélection");
	view.dispatch({ selection: { anchor: text.length, head: text.indexOf("Le") } });
	setHandler(() => ({ status: 200, json: { content: [{ type: "text", text: "- d’un pas vif" }] } }));
	await runSynonyms(app, settings);
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.focus();
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.click();
	equal(editor.getValue(), "Premier.\n\nd’un pas vif", "Remplacement d’une sélection sur plusieurs paragraphes");
	equal(editor.getSelection(), "d’un pas vif", "La section remplacée reste sélectionnée");
	check(view.hasFocus, "La section remplacée n’est pas active");
	reset();
	for (const source of ["Un pas rapide.\nSur deux lignes.", "Un pas rapide.\nSur deux lignes.\n", "Un pas rapide.\nSur deux lignes.\n \nSuite."]) {
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor: 13, head: 7 } });
		await runSynonyms(app, settings);
		document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!.click();
		equal(editor.getValue(), source.replace("Sur deux lignes.", "Sur deux lignes.\n\n%%\nSynonymes IA — rapide\n\n- d’un pas vif\n%%" + (source.endsWith("Sur deux lignes.") ? "\n" : "")), "Remarque après un paragraphe multiligne, avec ou sans suivant");
		equal(editor.getSelection(), "rapide", "Sélection inversée conservée après remarque");
	}
	reset();
	view.dispatch({ selection: { anchor: text.indexOf("Le"), head: text.length } });
	await runSynonyms(app, settings);
	document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!.click();
	check(editor.getValue().startsWith(text + "\n\n%%\n") && editor.getValue().endsWith("- d’un pas vif\n%%\n"), "Une sélection sur plusieurs paragraphes insère avant sa fin");
	equal(editor.getSelection(), text.slice(text.indexOf("Le")), "Sélection sur plusieurs paragraphes conservée");
	reset();
	setHandler(() => ({ status: 200, json: { content: [{ type: "text", text: "- 100%%% sûr" }] } }));
	await runSynonyms(app, settings);
	document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!.click();
	check(editor.getValue().includes("100%\u200b%\u200b% sûr") && editor.getValue().split("%%").length === 3, "Un résultat ferme prématurément la remarque");
	reset();
	settings.aiModel = "gpt-test";
	setHandler(() => ({ status: 200, json: { choices: [{ message: { content: "- prompt" } }] } }));
	await runSynonyms(app, settings);
	const openai = requests.at(-1)!;
	const openaiBody = JSON.parse(openai.body) as { model: string; messages: Array<{ role: string; content: string }> };
	equal(openai.url, "https://api.openai.com/v1/chat/completions", "Fournisseur OpenAI");
	equal(openai.headers.Authorization, "Bearer test-openai", "Clé OpenAI");
	equal(openaiBody.model, settings.aiModel, "Modèle configuré");
	equal(openaiBody.messages, [{ role: "system", content: prompt }, { role: "user", content: synonymContext(text, from, to) }], "Prompt OpenAI");
	view.dispatch({ changes: { from: 0, insert: "Modification. " } });
	const changed = view.state.doc.toString();
	document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!.click();
	equal(editor.getValue(), changed, "Refus d’insérer dans une note modifiée");
	check(notices.at(-1)?.includes("changé"), "Refus d’insertion sans explication");
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.click();
	equal(view.state.doc.toString(), changed, "Refus d’écraser une note modifiée");
	const closing = document.querySelector<HTMLElement>(".finition-synonyms")!.closest<HTMLElement>(".modal")!;
	closing.querySelector("h2")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
	const translation = closing.style.translate;
	modals.at(-1)!.close();
	document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, buttons: 1, clientX: 100, clientY: 100 }));
	equal(closing.style.translate, translation, "Écouteurs de déplacement conservés après fermeture");
	reset();
	await runSynonyms(app, settings);
	active = null;
	document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!.click();
	equal(editor.getValue(), text, "Refus d’insérer dans une note inactive");
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.click();
	equal(view.state.doc.toString(), text, "Refus d’écraser une note inactive");
	const elsewhere = document.body.createEl("button");
	elsewhere.focus();
	modals.at(-1)!.close();
	check(document.activeElement === elsewhere, "Fermer une note inactive vole le focus");
	elsewhere.remove();
	active = markdown;
	reset();
	setHandler(() => {
		view.dispatch({ changes: { from: 0, insert: "Modification pendant la recherche. " } });
		return { status: 200, json: { choices: [{ message: { content: "- prompt" } }] } };
	});
	await runSynonyms(app, settings);
	const duringRequest = editor.getValue();
	document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!.click();
	equal(editor.getValue(), duringRequest, "Refus d’insérer après modification pendant la requête IA");
	modals.at(-1)!.close();
	reset();
	setHandler(() => ({ status: 401, json: { error: { message: "Erreur simulée" } }, text: "Erreur simulée" }));
	await runSynonyms(app, settings);
	check(notices.at(-1)?.includes("Erreur simulée"), "Erreur API masquée");
	check(!document.querySelector(".finition-synonyms"), "Une erreur ouvre une liste");
	setHandler(() => ({ status: 200, json: { choices: [{ message: { content: "Aucune liste." } }] } }));
	await runSynonyms(app, settings);
	check(notices.at(-1)?.includes("Aucun synonyme"), "Une réponse sans puces est acceptée");
	const calls = requests.length;
	for (const text of ["[rapide](https://example.org)", "https://example.org/rapide", "![rapide](image.png)", "[[Note|rapide]]", "<a href='https://example.org'>rapide</a>", "Un [mot](https://example.org) rapide."]) {
		const from = text.startsWith("Un ") ? 0 : text.indexOf("rapide");
		const to = text.startsWith("Un ") ? text.length : from + 6;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: from, head: to } });
		await runSynonyms(app, settings);
		check(requests.length === calls && notices.at(-1)?.includes("hors des liens") && editor.getValue() === text, "Une recherche IA soumet une URL ou un libellé de lien");
	}
	reset();
	settings.openaiApiKey = "";
	await runSynonyms(app, settings);
	check(requests.length === calls, "Appel sans clé API");
	view.dispatch({ selection: { anchor: 0 } });
	await runSynonyms(app, settings);
	check(requests.length === calls, "Appel sans sélection");
	view.destroy();
}
