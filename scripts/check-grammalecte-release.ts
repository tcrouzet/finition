import type { App } from "obsidian";
import type FinitionPlugin from "../main";
import type { GrammalecteEngine } from "../modes/grammalecte";

export async function checkGrammalecteRelease(Plugin: typeof FinitionPlugin): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	let reads = 0;
	const app = { vault: { adapter: { read: async (path: string) => {
		reads++;
		throw new Error(`ENOENT : aucun fichier installé à ${path}`);
	} } } } as unknown as App;
	const plugin = new Plugin(app, { id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.0.0", description: "", author: "", dir: "release" });
	const internal = plugin as unknown as { ensureGrammalecteEngine: () => Promise<GrammalecteEngine> };
	for (const dictionary of ["fr-classic", "fr-reform"] as const) {
		plugin.settings.grammalecteDictionary = dictionary;
		const engine = await internal.ensureGrammalecteEngine();
		try {
			const errors = await engine.parse("Une fote.");
			check(errors.some(error => error.sType === "orthographe" && error.sValue === "fote"), `Release ${dictionary} : faute non détectée`);
			const corrected = await engine.parse("Une faute.");
			check(!corrected.some(error => error.sType === "orthographe"), `Release ${dictionary} : correction refusée`);
			const categories = await engine.getCategories(["maison"]);
			check(categories.maison?.includes("nom"), `Release ${dictionary} : catégories indisponibles`);
		} finally {
			engine.destroy();
		}
	}
	check(reads === 0, "Le moteur de la release lit encore des fichiers externes");
}
