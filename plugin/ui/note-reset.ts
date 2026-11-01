import { Notice, type Plugin, type TFile } from "obsidian";
import { getCurrentNote } from "../current-note";

export function registerNoteReset(plugin: Pick<Plugin, "app" | "registerEvent">, reset: (file: TFile | null) => Promise<void>): void {
	const workspace = plugin.app.workspace;
	let currentFile = getCurrentNote(plugin.app)?.file ?? null;
	const changed = () => {
		const file = getCurrentNote(plugin.app)?.file ?? null;
		if (file === currentFile) return;
		currentFile = file;
		void reset(file).catch(error => new Notice(`Reset : ${error instanceof Error ? error.message : String(error)}`));
	};
	plugin.registerEvent(workspace.on("active-leaf-change", changed));
	plugin.registerEvent(workspace.on("file-open", changed));
}
