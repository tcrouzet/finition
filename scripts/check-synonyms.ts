import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { App, EditorPosition, MarkdownView } from "obsidian";
import { synonymContext, parseSynonyms, runSynonyms } from "../ai/synonyms";
import { splitIntoChunks } from "../ai/chunk";
import prompt from "../ai/system-prompt-synonymes.md";
import { DEFAULT_SETTINGS } from "../types";

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
	let copied = "";
	const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
	try {
		list.querySelector<HTMLButtonElement>('[aria-label="Copier vif"]')!.click();
		await Promise.resolve();
		equal(copied, "vif", "Copie du synonyme");
		const modal = list.closest<HTMLElement>(".modal")!;
		const footer = modal.querySelector<HTMLElement>(".finition-synonyms-footer")!;
		check(footer && modal.lastElementChild === footer, "Bouton de copie globale absent du pied de fenêtre");
		footer.querySelector("button")!.click();
		await Promise.resolve();
		equal(copied, "- vif\n- véloce", "Copie de toute la liste avec ses puces");
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
		equal(view.state.doc.toString(), text, "La copie ne modifie pas la note");
		list.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.click();
		equal(view.state.doc.toString(), text.replace("rapide", "vif"), "Remplacement de la seule sélection");
		check(!document.querySelector(".finition-synonyms"), "La liste reste ouverte après remplacement");
	} finally {
		if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
		else Reflect.deleteProperty(navigator, "clipboard");
	}
	const reset = () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: from, head: to } });
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
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
	try {
		document.querySelector<HTMLButtonElement>('[aria-label="Copier prompt"]')!.click();
		await Promise.resolve();
		check(notices.at(-1) === "Copie impossible.", "Échec du presse-papiers masqué");
		document.querySelector<HTMLButtonElement>(".finition-synonyms-footer button")!.click();
		await Promise.resolve();
		check(notices.at(-1) === "Copie impossible.", "Échec de la copie globale masqué");
	} finally {
		if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
		else Reflect.deleteProperty(navigator, "clipboard");
	}
	view.dispatch({ changes: { from: 0, insert: "Modification. " } });
	const changed = view.state.doc.toString();
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
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.click();
	equal(view.state.doc.toString(), text, "Refus d’écraser une note inactive");
	modals.at(-1)!.close();
	active = markdown;
	setHandler(() => ({ status: 401, json: { error: { message: "Erreur simulée" } }, text: "Erreur simulée" }));
	await runSynonyms(app, settings);
	check(notices.at(-1)?.includes("Erreur simulée"), "Erreur API masquée");
	check(!document.querySelector(".finition-synonyms"), "Une erreur ouvre une liste");
	setHandler(() => ({ status: 200, json: { choices: [{ message: { content: "Aucune liste." } }] } }));
	await runSynonyms(app, settings);
	check(notices.at(-1)?.includes("Aucun synonyme"), "Une réponse sans puces est acceptée");
	const calls = requests.length;
	settings.openaiApiKey = "";
	await runSynonyms(app, settings);
	check(requests.length === calls, "Appel sans clé API");
	view.dispatch({ selection: { anchor: 0 } });
	await runSynonyms(app, settings);
	check(requests.length === calls, "Appel sans sélection");
	view.destroy();
}
