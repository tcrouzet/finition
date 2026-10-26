import * as assert from "node:assert/strict";
import type { Plugin } from "obsidian";
import type { EditorState, StateField, TransactionSpec } from "@codemirror/state";
import type { DecorationSet, EditorView } from "@codemirror/view";
import type { AnalysisNavigation } from "../plugin/ui/analysis-navigation";
import type { FinitionSettings } from "../plugin/types";
import type { addLeftSidebarToggle } from "../plugin/ui/left-sidebar-toggle";

export async function checkDocumentNavigation(Navigation: typeof AnalysisNavigation, State: typeof EditorState, defaults: FinitionSettings, focus: StateField<DecorationSet>, sidebarToggle: typeof addLeftSidebarToggle): Promise<void> {
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
	parent.prepend(size);
	const [, back, count, forward] = children;
	assert.deepEqual(children, [size, back, count, forward, music], "L’ordre doit être taille, flèche gauche, nombre de surlignages, flèche droite, musique");
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
	const turn = () => new Promise<void>(resolve => setTimeout(resolve, 5));
	editor.dispatch({ selection: { anchor: 12 } });
	navigation.update(view, [], true); await turn();
	assert.equal(editor.state.field(focus).size, 0, "Aucun repère ne doit être créé sans occurrence disponible");
	navigation.update(view, marks.slice(0, 2), true); await turn();
	assert.equal(editor.state.field(focus).iter().from, 10, "La première occurrence disponible doit être repérée avant la fin de l’analyse");
	assert.ok(back.disabled && forward.disabled, "Les flèches ne doivent pas parcourir une liste encore provisoire");
	navigation.update(view, [marks[0], marks[1], { ...marks[1], from: 12, to: 13 }, marks[2]], false);
	await turn();
	assert.equal(editor.state.field(focus).iter().from, 10, "La fin du traitement ne doit pas remplacer le repère initial par une nouvelle occurrence plus proche");
	assert.equal(editor.state.selection.main.head, 12, "Le repérage initial ne doit pas déplacer le curseur");
	forward.dispatchEvent(new Event("click"));
	assert.equal(editor.state.selection.main.head, 12, "La flèche doit partir du repère initial");
	editor.dispatch({ selection: { anchor: 0 } });
	plugin.settings.mode = "formes";
	navigation.update(view, marks, false); await turn();
	assert.equal(editor.state.field(focus).iter().from, 2, "Au début du document, la première occurrence doit être marquée");
	editor.dispatch({ selection: { anchor: 0 } });
	navigation.update(view, marks, false); await turn();
	assert.equal(editor.state.field(focus).size, 0, "Une actualisation ne doit pas réimposer une sélection déjà initialisée");
	assert.ok(!back.hidden && !forward.hidden && !count.hidden, "Le nombre de surlignages doit apparaître entre les deux flèches");
	assert.equal(count.textContent, "3");
	assert.equal(back.getAttribute("aria-label"), "Occurrence précédente");
	assert.equal(forward.getAttribute("aria-label"), "Occurrence suivante");
	forward.dispatchEvent(new Event("click"));
	assert.equal(editor.state.selection.main.head, 2, "La flèche droite doit atteindre le prochain surlignage");
	assert.ok(focused, "La navigation doit redonner le focus à l’éditeur");
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
	assert.ok(back.disabled && forward.disabled, "Une analyse en cours ne doit déclencher aucune navigation");
	assert.equal(editor.state.selection.main.head, 2);
	assert.equal(count.textContent, "…");
	navigation.update(view, [], false);
	assert.ok(back.disabled && forward.disabled, "Une analyse vide doit afficher zéro et désactiver les flèches");
	assert.equal(count.textContent, "0");
	for (const mode of ["repetition", "hinges", "formes", "copules"] as const) {
		plugin.settings.mode = mode;
		const grouped = marks.map((mark, index) => ({ ...mark, to: mark.from + 2, lemma: index === 1 ? "autre" : "sélection" }));
		editor.dispatch({ selection: { anchor: 2, head: 4 } });
		navigation.update(view, grouped, false);
		forward.dispatchEvent(new Event("click"));
		assert.equal(editor.state.selection.main.head, 20, `${mode} : la flèche doit sauter les autres groupes après une sélection de texte`);
		forward.dispatchEvent(new Event("click"));
		assert.equal(editor.state.selection.main.head, 2, `${mode} : la navigation doit boucler dans le même groupe`);
		back.dispatchEvent(new Event("click"));
		assert.equal(editor.state.selection.main.head, 20, `${mode} : la flèche précédente doit rester dans le groupe pointé`);
		editor.dispatch({ selection: { anchor: 10 } });
		forward.dispatchEvent(new Event("click"));
		assert.equal(editor.state.selection.main.head, 10, `${mode} : un groupe isolé ne doit pas rejoindre une autre catégorie`);
	}
	plugin.settings.mode = "repetition";
	plugin.settings.repetitionCountDisplay = "percent";
	navigation.update(view, marks, false, 7);
	assert.equal(count.textContent, "42,9 %", "Le compteur des répétitions ne rapporte pas les mots répétés au total");
	assert.equal(count.title, "3 mots répétés sur 7 mots analysés");
	navigation.update(view, [], false, 0);
	assert.equal(count.textContent, "0 %", "Le pourcentage d’une note vide est invalide");
	plugin.settings.repetitionCountDisplay = "count";
	navigation.update(view, marks, false, 7);
	assert.equal(count.textContent, "3", "Le choix Nombre ne restaure pas le compteur habituel");
	editor.dispatch({ selection: { anchor: 12 } });
	plugin.settings.mode = "none";
	navigation.updateGrammalecte(view, marks);
	await turn();
	assert.equal(editor.state.field(focus).iter().from, 10, "Les corrections doivent aussi repérer initialement l’occurrence proche du curseur");
	editor.dispatch({ selection: { anchor: 0 } });
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
	let sidebarClicks = 0;
	const leftSplit = { collapsed: false, toggle() { this.collapsed = !this.collapsed; sidebarClicks++; } };
	let layoutReady = () => {};
	Object.assign(plugin.app.workspace, { onLayoutReady(callback: () => void) { layoutReady = callback; } });
	let refreshSidebar = () => {};
	assert.doesNotThrow(() => { refreshSidebar = sidebarToggle(plugin, parent as unknown as HTMLElement, () => plugin.settings.showLeftSidebarToggle); }, "Le chargement ne doit pas planter avant la création de la barre latérale");
	const sidebarButton = children[0];
	assert.ok(sidebarButton.hidden && sidebarButton.disabled, "Le bouton doit attendre la barre latérale sans bloquer le plugin");
	assert.doesNotThrow(() => sidebarButton.dispatchEvent(new Event("click")), "Un clic avant initialisation ne doit pas planter");
	Object.assign(plugin.app.workspace, { leftSplit });
	layoutReady();
	assert.equal(sidebarButton.hidden, false, "Le bouton de barre latérale doit être visible par défaut");
	assert.equal(sidebarButton.getAttribute("aria-expanded"), "true");
	assert.equal(sidebarButton.getAttribute("data-icon"), "sidebar-toggle-button-icon", "Le bouton doit réutiliser l’icône native d’Obsidian");
	const sidebarClick = new Event("click");
	let sidebarStopped = false;
	sidebarClick.stopPropagation = () => { sidebarStopped = true; };
	sidebarButton.dispatchEvent(sidebarClick);
	assert.ok(sidebarStopped && leftSplit.collapsed && sidebarClicks === 1, "Le bouton doit appeler le toggle natif sans ouvrir le menu musique");
	assert.equal(sidebarButton.getAttribute("aria-expanded"), "false");
	assert.equal(sidebarButton.getAttribute("data-icon"), "sidebar-toggle-button-icon", "Fermer la barre doit conserver l’icône native et changer son remplissage");
	sidebarButton.dispatchEvent(new Event("click"));
	assert.equal(leftSplit.collapsed, false, "Le second clic doit réafficher la barre latérale");
	assert.equal(sidebarButton.getAttribute("data-icon"), "sidebar-toggle-button-icon");
	leftSplit.collapsed = true; events.get("layout-change")!();
	assert.equal(sidebarButton.getAttribute("aria-expanded"), "false", "L’état doit suivre une fermeture native");
	assert.equal(sidebarButton.getAttribute("data-icon"), "sidebar-toggle-button-icon", "Une fermeture native doit conserver le dessin d’Obsidian");
	plugin.settings.showLeftSidebarToggle = false; refreshSidebar();
	assert.equal(sidebarButton.hidden, true, "Le réglage désactivé doit masquer le bouton");
	plugin.settings.showLeftSidebarToggle = true; refreshSidebar();
	assert.equal(sidebarButton.hidden, false);
	plugin.settings.mode = "hedging"; navigation.update(view, marks, false);
	navigation.destroy(); cleanup.forEach(dispose => dispose());
	await turn();
	assert.equal(editor.state.field(focus).size, 0, "Le déchargement doit annuler un repérage initial encore en attente");
	assert.equal(historyEvents.size, 0, "Le déchargement doit retirer l’écouteur d’historique");
	back.dispatchEvent(new Event("click"));
	assert.deepEqual(calls, ["back", "forward"], "Une flèche déchargée ne doit plus naviguer");
	sidebarButton.dispatchEvent(new Event("click"));
	assert.equal(sidebarClicks, 2, "Un bouton déchargé ne doit plus agir sur la barre latérale");
	leftSplit.collapsed = false; layoutReady();
	assert.equal(sidebarButton.getAttribute("aria-expanded"), "false", "Une restauration tardive ne doit plus modifier un bouton déchargé");
	process.stdout.write("Navigation unifiée : historique natif, compteur central, surlignages précédent/suivant, bouclage, catégories, corrections et arrêt vérifiés\n");
}
