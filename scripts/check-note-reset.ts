import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import type { EventRef, Plugin } from "obsidian";

export async function checkNoteReset(): Promise<void> {
	const compiled = await build({ entryPoints: ["plugin/ui/note-reset.ts"], bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"] });
	const notices: string[] = [], module = { exports: {} };
	runInNewContext(compiled.outputFiles[0].text, { module, require: (name: string) => {
		assert.equal(name, "obsidian");
		return { Notice: class { constructor(message: string) { notices.push(message); } } };
	} });
	const { registerNoteReset } = module.exports as typeof import("../plugin/ui/note-reset");
	const first = { path: "premiere.md" }, second = { path: "seconde.md" };
	let active: typeof first | null = first;
	const events = new Map<string, () => void>();
	const refs: EventRef[] = [];
	const plugin = {
		app: { workspace: { getActiveFile: () => active, on: (event: string, callback: () => void) => { events.set(event, callback); return { event } as unknown as EventRef; } } },
		registerEvent: (ref: EventRef) => refs.push(ref),
	} as unknown as Pick<Plugin, "app" | "registerEvent">;
	let resets = 0, rejectReset = false;
	registerNoteReset(plugin, async () => { resets++; if (rejectReset) throw new Error("Stockage indisponible"); });
	assert.equal(resets, 0, "L’inscription ne doit pas réinitialiser la note déjà active");
	assert.equal(refs.length, 2, "Les événements doivent être nettoyés par le cycle de vie du plugin");
	const fire = (event: string) => { const callback = events.get(event); assert.ok(callback, event); callback(); };
	fire("active-leaf-change"); fire("file-open");
	assert.equal(resets, 0, "Un changement de volet ou une réouverture de la même note ne doit pas effacer l’analyse");
	active = second;
	fire("file-open");
	assert.equal(resets, 1, "Une nouvelle note dans le même onglet doit déclencher le reset");
	fire("active-leaf-change"); fire("file-open");
	assert.equal(resets, 1, "Une même navigation ne doit pas déclencher plusieurs resets");
	active = first;
	fire("active-leaf-change"); fire("file-open");
	assert.equal(resets, 2, "Changer d’onglet doit déclencher le reset");
	first.path = "renommee.md";
	fire("file-open");
	assert.equal(resets, 2, "Renommer la note ne doit pas effacer son analyse");
	active = null;
	fire("file-open"); fire("active-leaf-change");
	assert.equal(resets, 3, "Fermer la dernière note doit réinitialiser l’analyse");
	rejectReset = true; active = second;
	fire("file-open");
	await new Promise(resolve => setImmediate(resolve));
	assert.ok(notices.at(-1)?.includes("Stockage indisponible"), "Un échec de sauvegarde ne doit pas devenir un rejet non géré");
	process.stdout.write("Reset automatique : même onglet, changement d’onglet, événements répétés, renommage, fermeture et erreurs vérifiés\n");
}

if (process.argv[1]?.endsWith("check-note-reset.ts")) void checkNoteReset();
