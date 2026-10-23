import { Plugin, setIcon } from "obsidian";

export function addLeftSidebarToggle(plugin: Pick<Plugin, "app" | "register" | "registerDomEvent" | "registerEvent">, parent: HTMLElement, enabled: () => boolean): () => void {
	const button = parent.createEl("button", { cls: "clickable-icon finition-left-sidebar-toggle", attr: { type: "button" } });
	parent.prepend(button);
	setIcon(button, "sidebar-toggle-button-icon");
	let disposed = false;
	plugin.register(() => { disposed = true; });
	const refresh = () => {
		if (disposed) return;
		const sidebar = plugin.app.workspace.leftSplit;
		button.hidden = !enabled() || !sidebar;
		button.disabled = !sidebar;
		if (!sidebar) return;
		const label = `${sidebar.collapsed ? "Afficher" : "Masquer"} la barre latérale gauche`;
		button.title = label;
		button.setAttribute("aria-label", label);
		button.setAttribute("aria-expanded", String(!sidebar.collapsed));
	};
	plugin.registerDomEvent(button, "mousedown", event => event.preventDefault());
	plugin.registerDomEvent(button, "click", event => {
		event.stopPropagation();
		plugin.app.workspace.leftSplit?.toggle();
		refresh();
	});
	plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
	plugin.app.workspace.onLayoutReady(refresh);
	refresh();
	return refresh;
}
