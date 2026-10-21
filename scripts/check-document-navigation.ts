import * as assert from "node:assert/strict";
import type { Plugin } from "obsidian";
import type { EditorState, StateField, TransactionSpec } from "@codemirror/state";
import type { DecorationSet, EditorView } from "@codemirror/view";
import type { AnalysisNavigation } from "../plugin/ui/analysis-navigation";
import type { FinitionSettings } from "../plugin/types";

export async function checkDocumentNavigation(Navigation: typeof AnalysisNavigation, State: typeof EditorState, defaults: FinitionSettings, focus: StateField<DecorationSet>): Promise<void> {
	class Control extends EventTarget {
		hidden = false; disabled = false; title = ""; textContent = "";
		private attributes = new Map<string, string>();
		setAttribute(name: string, value: string) { this.attributes.set(name, value); }
		getAttribute(name: string) { return this.attributes.get(name); }
		setText(text: string) { this.textContent = text; }
	}
	const size = new Control(), music = new Control();
	const children = [size, music];
	const cleanup: Array<() => void> = [];
	const events = new Map<string, () => void>();
	const historyEvents = new Map<string, () => void>();
	const calls: string[] = [];
	const history = {
		backHistory: [] as unknown[], forwardHistory: [] as unknown[],
		async back() { calls.push("back"); }, async forward() { calls.push("forward"); },
	};
	const first = { history, on(event: string, callback: () => void) { historyEvents.set(event, callback); return event; }, offref(event: string) { historyEvents.delete(event); } };
	let active: typeof first | null = first;
	let connected = false, focused = false;
	const editor = {
		state: State.create({ doc: "012345678901234567890123456789", extensions: [focus] }),
		dom: { get isConnected() { return connected; } },
		dispatch(transaction: TransactionSpec) { this.state = this.state.update(transaction).state; },
		focus() { focused = true; },
	};
	const view = editor as unknown as EditorView;
	const parent = {
		createEl() { const button = new Control(); children.push(button); return button; },
		createSpan() { const count = new Control(); children.push(count); return count; },
		prepend(...controls: Control[]) { for (const control of controls) children.splice(children.indexOf(control), 1); children.unshift(...controls); },
	};
	const plugin = {
		settings: { ...defaults, mode: "none" },
		app: { workspace: { getMostRecentLeaf: () => active, getActiveViewOfType: () => ({ editor: { cm: view } }), on(event: string, callback: () => void) { events.set(event, callback); } } },
		register(callback: () => void) { cleanup.push(callback); }, registerEvent() {},
		registerDomEvent(element: EventTarget, name: string, callback: EventListener) { element.addEventListener(name, callback); cleanup.push(() => element.removeEventListener(name, callback)); },
	} as unknown as Plugin & { settings: FinitionSettings };
	const navigation = new Navigation(plugin, parent as unknown as HTMLElement);
	const [back, count, forward] = children;
	assert.deepEqual(children.slice(3), [size, music], "Les flèches et leur compteur doivent précéder la taille et la musique, sans ancien contrôle à droite");
	assert.ok(back.hidden && forward.hidden, "Les flèches doivent être masquées sans historique");
	history.backHistory.push({}); events.get("file-open")!();
	assert.ok(!back.hidden && forward.hidden, "Seule la flèche précédente doit apparaître quand un retour existe");
	const down = new Event("mousedown", { cancelable: true }); back.dispatchEvent(down);
	assert.ok(down.defaultPrevented, "Le clic sur une flèche ne doit pas déplacer le focus avant la navigation");
	let stopped = false;
	const click = new Event("click");
	click.stopPropagation = () => { stopped = true; };
	back.dispatchEvent(click); await Promise.resolve();
	assert.ok(stopped, "Le clic sur une flèche ne doit pas ouvrir le menu musique");
	assert.deepEqual(calls, ["back"], "La flèche doit appeler une seule fois la navigation native précédente");
	history.backHistory.length = 0; history.forwardHistory.push({});
	assert.ok(historyEvents.has("history-change"), "L’historique natif doit être suivi"); historyEvents.get("history-change")!();
	assert.ok(back.hidden && !forward.hidden, "Les flèches doivent s’actualiser après un retour natif");
	forward.dispatchEvent(new Event("click")); await Promise.resolve();
	assert.deepEqual(calls, ["back", "forward"], "La flèche suivante doit appeler la navigation native suivante");
	connected = true; plugin.settings.mode = "hedging";
	const marks = [2, 10, 20].map(from => ({ from, to: from + 1, lemma: "test", colorIndex: 0 }));
	navigation.update(view, marks, false);
	assert.ok(!back.hidden && !forward.hidden && !count.hidden, "Le nombre de surlignages doit apparaître entre les deux flèches");
	assert.equal(count.textContent, "3");
	assert.equal(back.getAttribute("aria-label"), "Occurrence précédente");
	assert.equal(forward.getAttribute("aria-label"), "Occurrence suivante");
	forward.dispatchEvent(new Event("click"));
	assert.ok(editor.state.selection.main.head === 2 && focused, "La flèche droite doit atteindre le prochain surlignage");
	assert.equal(editor.state.field(focus).size, 1, "La navigation doit marquer visuellement l’occurrence atteinte");
	assert.equal(editor.state.field(focus).iter().from, 2);
	assert.equal(editor.state.field(focus).iter().to, 3);
	back.dispatchEvent(new Event("click"));
	assert.equal(editor.state.selection.main.head, 20, "La flèche gauche doit boucler vers le dernier surlignage");
	assert.equal(editor.state.field(focus).size, 1, "Un seul repère de navigation doit rester actif");
	assert.equal(editor.state.field(focus).iter().from, 20);
	back.dispatchEvent(new Event("click"));
	assert.equal(editor.state.selection.main.head, 10, "La flèche gauche doit atteindre le surlignage précédent");
	navigation.update(view, [marks[0], marks[2]], false);
	back.dispatchEvent(new Event("click"));
	assert.equal(editor.state.selection.main.head, 2, "La navigation arrière doit respecter la catégorie sélectionnée");
	assert.equal(count.textContent, "2");
	navigation.update(view, marks, true); forward.dispatchEvent(new Event("click"));
	assert.ok(back.disabled && forward.disabled && editor.state.selection.main.head === 2, "Une analyse en cours ne doit déclencher aucune navigation");
	assert.equal(count.textContent, "…");
	navigation.update(view, [], false);
	assert.ok(back.disabled && forward.disabled, "Une analyse vide doit afficher zéro et désactiver les flèches");
	assert.equal(count.textContent, "0");
	plugin.settings.mode = "none";
	navigation.updateGrammalecte(view, marks);
	assert.equal(back.getAttribute("aria-label"), "Faute précédente");
	assert.equal(forward.getAttribute("aria-label"), "Faute suivante");
	back.dispatchEvent(new Event("click"));
	assert.equal(editor.state.selection.main.head, 20, "La navigation arrière doit fonctionner sur les corrections");
	assert.equal(editor.state.field(focus).iter().from, 20, "La correction atteinte doit aussi être marquée");
	editor.dispatch({ selection: { anchor: 0 } });
	assert.equal(editor.state.field(focus).size, 0, "Déplacer manuellement le curseur doit effacer le repère");
	forward.dispatchEvent(new Event("click"));
	editor.dispatch({ changes: { from: 0, insert: "😀" } });
	assert.equal(editor.state.field(focus).size, 0, "La saisie doit effacer le repère pour éviter une plage périmée");
	assert.deepEqual(calls, ["back", "forward"], "La navigation des surlignages ne doit jamais parcourir l’historique des documents");
	navigation.updateGrammalecte(view, []); navigation.refresh();
	assert.ok(count.hidden && back.hidden && !forward.hidden && forward.getAttribute("aria-label") === "Document suivant", "Après désactivation, les mêmes flèches doivent reprendre la navigation native");
	active = null; events.get("active-leaf-change")!();
	assert.ok(back.hidden && forward.hidden && !historyEvents.size, "Quitter le volet doit masquer les flèches et retirer son écouteur");
	active = first; events.get("active-leaf-change")!();
	Reflect.deleteProperty(first, "history"); events.get("layout-change")!();
	assert.ok(back.hidden && forward.hidden, "Un historique natif indisponible doit masquer les flèches sans erreur");
	navigation.destroy(); cleanup.forEach(dispose => dispose());
	assert.equal(historyEvents.size, 0, "Le déchargement doit retirer l’écouteur d’historique");
	back.dispatchEvent(new Event("click"));
	assert.deepEqual(calls, ["back", "forward"], "Une flèche déchargée ne doit plus naviguer");
	process.stdout.write("Navigation unifiée : historique natif, compteur central, surlignages précédent/suivant, bouclage, catégories, corrections et arrêt vérifiés\n");
}
