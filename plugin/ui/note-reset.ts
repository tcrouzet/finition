import { Notice, type Plugin } from "obsidian";

export function registerNoteReset(plugin: Pick<Plugin, "app" | "registerEvent">, reset: () => Promise<void>): void {
	const workspace = plugin.app.workspace;
	let currentFile = workspace.getActiveFile();
	const changed = () => {
		const file = workspace.getActiveFile();
		if (file === currentFile) return;
		currentFile = file;
		void reset().catch(error => new Notice(`Reset : ${error instanceof Error ? error.message : String(error)}`));
	};
	plugin.registerEvent(workspace.on("active-leaf-change", changed));
	plugin.registerEvent(workspace.on("file-open", changed));
}
