import * as assert from "node:assert/strict";
import type { Plugin, WorkspaceLeaf, WorkspaceParent } from "obsidian";
import type { registerSingleNote } from "../plugin/ui/single-note";

export async function checkSingleNote(register: typeof registerSingleNote): Promise<void> {
	let enabled = false;
	let ready = false;
	const left = {}, right = {}, main = {}, popout = {};
	const group = {}, split = {}, floating = {};
	const visible = new Map<object, Leaf>();
	const events = new Map<string, () => void>();
	const cleanup: Array<() => void> = [];
	let layoutReady = () => {};
	interface Leaf { parent: object; root: object; type: string; closed: boolean }
	const leaves: Leaf[] = [];
	const note = (parent = group, root = main, type = "markdown") => {
		const leaf = { parent, root, type, closed: false };
		leaves.push(leaf);
		return leaf;
	};
	const plugin = {
		app: { workspace: {
			get layoutReady() { return ready; }, leftSplit: left, rightSplit: right,
			onLayoutReady(callback: () => void) { layoutReady = callback; },
			on(event: string, callback: () => void) { events.set(event, callback); return event; },
			getMostRecentLeaf(parent: WorkspaceParent) { return visible.get(parent); },
			iterateAllLeaves(visit: (leaf: WorkspaceLeaf) => void) {
				for (const leaf of leaves.filter(leaf => !leaf.closed)) visit(Object.assign(leaf, {
					getRoot: () => leaf.root,
					getViewState: () => ({ type: leaf.type }),
					detach: () => { leaf.closed = true; events.get("layout-change")!(); },
				}) as unknown as WorkspaceLeaf);
			},
		} },
		register(callback: () => void) { cleanup.push(callback); },
		registerEvent() {},
	} as unknown as Plugin;
	const old = note(), current = note(), stray = note();
	visible.set(group, current);
	const schedule = register(plugin, () => enabled);
	const turn = () => new Promise<void>(resolve => setTimeout(resolve, 5));
	schedule(); await turn();
	assert.ok(!old.closed && !stray.closed, "Option désactivée : une note a été fermée");
	enabled = true;
	schedule(); await turn();
	assert.ok(!old.closed, "Le nettoyage ne doit pas modifier un espace de travail en cours de restauration");
	ready = true;
	layoutReady(); await turn();
	assert.ok(old.closed && stray.closed && !current.closed, "Les notes cachées doivent fermer, la note affichée doit rester");
	const splitOld = note(split), splitCurrent = note(split);
	visible.set(split, splitCurrent);
	const floatingOld = note(floating, popout), floatingCurrent = note(floating, popout);
	visible.set(floating, floatingCurrent);
	const sidebarLeft = note({}, left), sidebarRight = note({}, right), canvas = note(group, main, "canvas");
	events.get("layout-change")!(); await turn();
	assert.ok(splitOld.closed && floatingOld.closed && !splitCurrent.closed && !floatingCurrent.closed, "Le nettoyage doit conserver les notes visibles des volets et fenêtres séparés");
	assert.ok(!sidebarLeft.closed && !sidebarRight.closed && !canvas.closed, "Un panneau latéral ou une vue non Markdown a été fermé");
	const next = note(); visible.set(group, next);
	events.get("active-leaf-change")!(); await turn();
	assert.ok(current.closed && !next.closed, "La navigation doit fermer la note quittée sans fermer la nouvelle");
	const empty = note(group, main, "empty"); visible.set(group, empty);
	events.get("layout-change")!(); await turn();
	assert.ok(!next.closed, "Un nouvel onglet vide ne doit pas fermer la note précédente avant son ouverture");
	visible.set(group, next);
	const pending = note();
	schedule(); enabled = false; await turn();
	assert.ok(!pending.closed, "Désactiver l’option doit annuler le nettoyage en attente");
	enabled = true; schedule(); cleanup.forEach(dispose => dispose()); await turn();
	layoutReady(); await turn();
	assert.ok(!pending.closed, "Le déchargement doit annuler le nettoyage et les rappels différés");
	process.stdout.write("Une seule note ouverte : option, restauration, navigation, volets, fenêtres, panneaux et arrêt vérifiés\n");
}
