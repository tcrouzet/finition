import { Notice, type EventRef, type Events, type Plugin, type WorkspaceLeaf } from "obsidian";

type HistoryLeaf = WorkspaceLeaf & {
	history?: {
		backHistory: unknown[];
		forwardHistory: unknown[];
		back(): Promise<void>;
		forward(): Promise<void>;
	};
};

export function addDocumentNavigation(plugin: Pick<Plugin, "app" | "register" | "registerEvent" | "registerDomEvent">, buttons: HTMLButtonElement[], analysisActive: () => boolean): () => void {
	const workspace = plugin.app.workspace;
	let leaf: HistoryLeaf | null = null;
	let historyEvent: EventRef | null = null;
	let disposed = false;
	(["back", "forward"] as const).forEach((direction, index) => {
		const button = buttons[index];
		plugin.registerDomEvent(button, "click", event => {
			if (analysisActive()) return;
			event.stopPropagation();
			refresh();
			const history = leaf?.history;
			if (disposed || button.hidden || !history) return;
			void history[direction]().then(refresh, () => { if (!disposed) new Notice("Navigation impossible."); refresh(); });
		});
	});
	function refresh(): void {
		if (disposed) return;
		const active: HistoryLeaf | null = workspace.getMostRecentLeaf();
		if (active !== leaf) {
			if (historyEvent) leaf?.offref(historyEvent);
			leaf = active;
			// L’historique natif et son événement ne font pas partie de l’API typée publique.
			historyEvent = leaf ? (leaf as Events).on("history-change", refresh) : null;
		}
		const history = leaf?.history;
		if (analysisActive()) return;
		for (const [index, label] of ["Document précédent", "Document suivant"].entries()) {
			buttons[index].setAttribute("aria-label", label);
			buttons[index].title = label;
			buttons[index].disabled = false;
		}
		buttons[0].hidden = !history?.backHistory?.length || typeof history.back !== "function";
		buttons[1].hidden = !history?.forwardHistory?.length || typeof history.forward !== "function";
	}
	plugin.register(() => {
		disposed = true;
		if (historyEvent) leaf?.offref(historyEvent);
	});
	plugin.registerEvent(workspace.on("active-leaf-change", refresh));
	plugin.registerEvent(workspace.on("file-open", refresh));
	plugin.registerEvent(workspace.on("layout-change", refresh));
	refresh();
	return refresh;
}
