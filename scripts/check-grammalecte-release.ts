import type { App } from "obsidian";
import type FinitionPlugin from "../main";
import type { GrammalecteEngine } from "../plugin/modes/grammalecte";
import { checkCorrectionScope } from "./check-finition-corrector";
import { resourceFixture } from "./check-linguistic-resources";

export async function checkGrammalecteRelease(Plugin: typeof FinitionPlugin): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const fixture = await resourceFixture();
	const app = { vault: { adapter: fixture.adapter } } as unknown as App;
	const plugin = new Plugin(app, { id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.0.0", description: "", author: "", dir: "release" });
	const internal = plugin as unknown as { ensureGrammalecteEngine: () => Promise<GrammalecteEngine> };
	await plugin.loadSettings();
	check(!plugin.hasLinguisticResources, "Une installation vide doit rester désactivée");
	plugin.settings.resourcePacks = fixture.revisions;
	await plugin.loadLinguisticResources();
	check(plugin.hasLinguisticResources, "Les ressources installées ne sont pas reconnues");
	const variants = "Un nénuphar, un nénufar, un oignon, un ognon, un événement, un évènement, un coût et un cout.";
	const references = new Map<string, string>();
	for (const dictionary of ["fr-classic", "fr-reform"] as const) {
		plugin.settings.grammalecteDictionary = dictionary;
		const engine = await internal.ensureGrammalecteEngine();
		try {
			references.set(dictionary, JSON.stringify(await engine.parse(variants)));
			await checkCorrectionScope(engine);
			const errors = await engine.parse("Une fote.");
			check(errors.some(error => error.sType === "orthographe" && error.sValue === "fote"), `Release ${dictionary} : faute non détectée`);
			const corrected = await engine.parse("Une faute.");
			check(!corrected.some(error => error.sType === "orthographe"), `Release ${dictionary} : correction refusée`);
			const categories = await engine.getCategories(["maison"]);
			check(categories.maison?.includes("nom"), `Release ${dictionary} : catégories indisponibles`);
			const [first, second] = await Promise.all([engine.parse("Une fote."), engine.parse("Une faute.")]);
			check(first.some(error => error.sValue === "fote") && !second.some(error => error.sType === "orthographe"), "Requêtes Grammalecte concurrentes mélangées");
		} finally {
			engine.destroy();
		}
	}
	check(references.get("fr-classic") !== references.get("fr-reform"), "Le texte témoin ne distingue pas les deux dictionnaires");
	const engine = await internal.ensureGrammalecteEngine();
	try {
		for (const dictionary of ["fr-classic", "fr-reform", "fr-classic"] as const) {
			plugin.settings.grammalecteDictionary = dictionary;
			await internal.ensureGrammalecteEngine();
			check(JSON.stringify(await engine.parse(variants)) === references.get(dictionary), "Le changement de variante conserve le dictionnaire précédent");
		}
		const replaced = engine.ensureReady("fr-reform").then(() => false, () => true);
		await engine.ensureReady("fr-classic");
		check(await replaced && JSON.stringify(await engine.parse(variants)) === references.get("fr-classic"), "Une initialisation remplacée écrase ou détruit le dernier dictionnaire");
	} finally { engine.destroy(); }
}
