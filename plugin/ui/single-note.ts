import type { Plugin, WorkspaceLeaf } from "obsidian";

export function registerSingleNote(plugin: Plugin, enabled: () => boolean): () => void {
	const workspace = plugin.app.workspace;
	let pending: number | null = null;
	let disposed = false;
	const schedule = () => {
		if (disposed || !enabled() || !workspace.layoutReady || pending !== null) return;
		// Laisser Obsidian terminer l’ouverture et l’activation avant de fermer l’ancien onglet.
		pending = window.setTimeout(() => {
			try {
				if (disposed || !enabled()) return;
				const notes: WorkspaceLeaf[] = [];
				workspace.iterateAllLeaves(leaf => {
					const root = leaf.getRoot();
					if (root !== workspace.leftSplit && root !== workspace.rightSplit && leaf.getViewState().type === "markdown") notes.push(leaf);
				});
				const keep = new Map([...new Set(notes.map(leaf => leaf.parent))].map(parent => [parent, workspace.getMostRecentLeaf(parent)]));
				for (const leaf of notes) {
					const visible = keep.get(leaf.parent);
					if (visible && visible !== leaf && visible.getViewState().type !== "empty") leaf.detach();
				}
			} finally {
				pending = null;
			}
		}, 0);
	};
	plugin.register(() => {
		disposed = true;
		if (pending !== null) window.clearTimeout(pending);
	});
	workspace.onLayoutReady(schedule);
	plugin.registerEvent(workspace.on("active-leaf-change", schedule));
	plugin.registerEvent(workspace.on("layout-change", schedule));
	return schedule;
}
