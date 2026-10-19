import type { App } from "obsidian";
import type FinitionPlugin from "../main";
import type { FinitionCorrectorEngine } from "../plugin/modes/finition-corrector";
import { NeuralModels, parseNeuralPack } from "../plugin/neural-models";
import { resourceFixture } from "./check-linguistic-resources";
import { FinitionSettingTab } from "../plugin/settings-tab";

export async function checkNeuralModels(Plugin: typeof FinitionPlugin): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const fixture = await resourceFixture();
	const root = "model-plugin";
	let weightReads = 0;
	const adapter = { ...fixture.adapter, async readBinary(path: string) {
		if (path.endsWith("weights.bin")) weightReads++;
		return fixture.adapter.readBinary(path);
	} };
	const models = new NeuralModels(adapter, root);
	await models.refresh();
	check(weightReads === 0 && models.options.length === 1, "Découverte absente ou chargement prématuré des poids");
	const read = models.reader("auto")!;
	check((await read("electra/weights.bin")).byteLength > 0, "Poids privés non chargés");
	const manifest = JSON.parse(await fixture.adapter.read(`${root}/Antidote/model/pack.json`)) as { files: Array<{ path: string; bytes: number; sha256: string }> };
	for (const value of [null, { ...manifest, version: 99 }, { ...manifest, architecture: "autre" }, { ...manifest, files: [] }, { ...manifest, name: "x\u0000" }, { ...manifest, description: 1 }, { ...manifest, description: "x\n" }, { ...manifest, description: "x".repeat(1001) }, { ...manifest, documentation: "javascript:alert(1)" }, { ...manifest, documentation: "file:///tmp/secret" }, { ...manifest, files: [...manifest.files, manifest.files[0]] }, { ...manifest, files: manifest.files.map((file, index) => index ? file : { ...file, path: "../code.js" }) }]) {
		let rejected = false;
		try { parseNeuralPack(JSON.stringify(value)); } catch { rejected = true; }
		check(rejected, "Catalogue neuronal invalide accepté");
	}
	check(await read("../secret").then(() => false, () => true), "Lecture hors pack autorisée");
	const original = await read("electra/labels.json");
	const corrupted = original.slice(0);
	new Uint8Array(corrupted)[0] ^= 1;
	fixture.writes.set(`${root}/Antidote/model/electra/labels.json`, corrupted);
	check(await read("electra/labels.json").then(() => false, () => true), "Empreinte altérée acceptée");
	fixture.writes.set(`${root}/Antidote/model/electra/labels.json`, original);
	const alternate = `${root}/helper/neural/models/alternate`;
	for (const file of manifest.files) fixture.writes.set(`${alternate}/${file.path}`, await read(file.path));
	const bytes = new TextEncoder().encode(JSON.stringify({ ...manifest, name: "Modèle de test" })).buffer;
	fixture.writes.set(`${alternate}/pack.json`, bytes);
	await models.refresh();
	check(models.options.length === 2 && models.options[1].name === "Modèle de test", "Modèle ajouté non découvert");
	const plugin = new Plugin({ vault: { adapter }, workspace: { iterateAllLeaves() {} } } as unknown as App,
		{ id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.0.0", description: "", author: "", dir: root });
	await plugin.loadSettings();
	plugin.settings.resourcePacks = fixture.revisions;
	await plugin.loadLinguisticResources();
	await plugin.setSpellingEngine("finition-corrector");
	const internal = plugin as unknown as { ensureSpellingEngine(): Promise<FinitionCorrectorEngine> };
	const engine = await internal.ensureSpellingEngine();
	let destroyed = false;
	const destroy = engine.destroy.bind(engine);
	engine.destroy = () => { destroyed = true; destroy(); };
	await plugin.setNeuralModel("helper/neural/models/alternate");
	await plugin.loadSettings();
	check(destroyed && plugin.settings.neuralModel === "helper/neural/models/alternate", "Changement de modèle non appliqué ou non persisté");
	await plugin.setNeuralModel("");
	const plain = await internal.ensureSpellingEngine();
	check(!plain.specializedEnabled && plain !== engine, "Ancien modèle spécialisé toujours actif");
	plain.neuralEnabled = true;
	check(!(await plain.parse("Je me demande ou il habite.")).some(error => error.sRuleId.startsWith("neural.electra")), "Modèle désactivé encore utilisé");
	plain.destroy();
	check(await plugin.setNeuralModel("../outside").then(() => false, () => true), "Modèle hors dossier accepté");
	check(plugin.settings.neuralModel === "", "Un choix invalide a remplacé le choix précédent");
	const container = document.body.createDiv();
	const tab = new FinitionSettingTab(plugin.app, plugin);
	tab.containerEl = container;
	tab.update();
	container.querySelector<HTMLDetailsElement>('details[data-section="Corrections"]')!.open = true;
	const row = (name: string) => Array.from(container.querySelectorAll(".setting-item")).find(row => row.querySelector(".setting-item-name")?.textContent === name);
	const select = () => row("Correcteur neuronal par défaut")!.querySelector<HTMLSelectElement>("select")!;
	const settled = async (condition: () => boolean) => {
		const deadline = performance.now() + 1000;
		while (!condition()) { check(performance.now() < deadline, "Les modèles neuronaux ne se stabilisent pas"); await new Promise(requestAnimationFrame); }
	};
	const pathInput = () => row("Charger un modèle neuronal")!.querySelector<HTMLInputElement>("input")!;
	check(!row("Correction contextuelle locale"), "Un interrupteur redondant permet encore de désactiver le modèle choisi");
	check(["Grammalecte", "Correcteur neuronal par défaut", "CamemBERT", "Charger un modèle neuronal"].every(name => row(name)?.closest("details")?.dataset.section === "Corrections") && !Array.from(container.querySelectorAll("summary")).some(heading => heading.textContent === "Neuronal"), "Les correcteurs doivent partager la section Corrections sans titre Neuronal");
	check(row("Antidote")?.textContent?.includes("Correction grammaticale française, modèle local.") && !row("Antidote")?.querySelector("a") && row("Antidote")?.querySelector("button")?.textContent === "Effacer", "Le modèle privé n’affiche pas son nom, sa description et Effacer sans lien");
	check(Array.from(select().options).some(option => option.value === "Antidote/model" && option.text === "Antidote"), "Le nom du modèle privé est absent du sélecteur");
	check(pathInput().getAttribute("aria-label") === "Chemin du modèle neuronal" && row("Charger un modèle neuronal")?.querySelector<HTMLAnchorElement>("a")?.href === "https://github.com/tcrouzet/finition/blob/main/doc/neural-model.md", "Le champ d’import ou le lien du format neuronal est absent");
	const personal = { ...manifest, name: "Personnel", description: "Modèle <b>français</b>", documentation: "https://example.org/modele" };
	const source = "imports/personnel";
	for (const file of manifest.files) fixture.writes.set(`${source}/${file.path}`, await read(file.path));
	fixture.writes.set(`${source}/pack.json`, new TextEncoder().encode(JSON.stringify(personal)).buffer);
	pathInput().value = source;
	pathInput().dispatchEvent(new Event("input"));
	check(plugin.settings.neuralModel === "", "Saisir un chemin change déjà le modèle");
	row("Charger un modèle neuronal")!.querySelector<HTMLButtonElement>("button")!.click();
	await settled(() => !select().disabled && Boolean(row("Personnel")));
	const imported = plugin.settings.neuralModel;
	check(/^Antidote\/models\/[a-f0-9]{64}$/u.test(imported) && select().value === imported && pathInput().value === "" && plugin.settings.spellingEngine === "finition-corrector", "L’import n’est pas copié, sélectionné ou activé");
	check(row("Personnel")?.querySelector("a")?.textContent === personal.description && row("Personnel")?.querySelector<HTMLAnchorElement>("a")?.href === personal.documentation && !row("Personnel")?.querySelector("b"), "Les métadonnées importées sont perdues ou interprètent du HTML");
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check(plugin.settings.neuralModel === imported && plugin.neuralModelOptions.some(model => model.id === imported), "Le modèle importé ne survit pas au rechargement");
	const previousCount = plugin.neuralModelOptions.length;
	await plugin.setNeuralModelPath(`${source}/pack.json`);
	check(plugin.neuralModelOptions.length === previousCount && plugin.settings.neuralModel === imported, "Réimporter le même modèle crée un doublon");
	const corruptedWeights = new Uint8Array(await fixture.adapter.readBinary(`${source}/electra/weights.bin`));
	corruptedWeights[0] ^= 1;
	fixture.writes.set(`${source}/electra/weights.bin`, corruptedWeights.buffer);
	check(await plugin.setNeuralModelPath(source).then(() => false, () => true) && plugin.settings.neuralModel === imported, "Un import altéré remplace le dernier modèle valide");
	const loaded = await internal.ensureSpellingEngine();
	check(loaded.specializedEnabled, "Le modèle importé n’est pas branché au moteur");
	loaded.destroy();
	for (const path of ["../hors-coffre", "/tmp/hors-coffre", "absent"]) check(await plugin.setNeuralModelPath(path).then(() => false, () => true) && plugin.settings.neuralModel === imported, "Un chemin neuronal invalide modifie le choix actif");
	const save = plugin.saveSettings.bind(plugin);
	plugin.saveSettings = async () => { throw new Error("Écriture impossible"); };
	check(await plugin.removeNeuralModel(imported).then(() => false, () => true) && plugin.settings.neuralModel === imported && await fixture.adapter.exists(`${root}/${imported}/pack.json`), "Un échec d’enregistrement efface le modèle");
	plugin.saveSettings = save;
	const remove = adapter.rmdir.bind(adapter);
	adapter.rmdir = async () => { throw new Error("Suppression impossible"); };
	check(await plugin.removeNeuralModel(imported).then(() => false, () => true) && plugin.settings.neuralModel === imported, "Une suppression échouée perd le modèle actif");
	adapter.rmdir = remove;
	const confirm = window.confirm.bind(window);
	try {
		window.confirm = () => false;
		tab.update();
		row("Personnel")!.querySelector<HTMLButtonElement>("button")!.click();
		check(await fixture.adapter.exists(`${root}/${imported}/pack.json`), "Annuler efface le modèle");
		window.confirm = () => true;
		row("Personnel")!.querySelector<HTMLButtonElement>("button")!.click();
		await settled(() => !select().disabled && !row("Personnel"));
		check(plugin.settings.neuralModel === "" && select().value === "finition-corrector" && !await fixture.adapter.exists(`${root}/${imported}/pack.json`) && await fixture.adapter.exists(`${source}/pack.json`) && await fixture.adapter.exists(`${root}/Antidote/model/pack.json`), "Effacer ne retire pas uniquement la copie ou ne revient pas au modèle public");
		fixture.writes.set(`${root}/Antidote/dictionnaires/temoin.json`, new TextEncoder().encode("{}").buffer);
		row("Antidote")!.querySelector<HTMLButtonElement>("button")!.click();
		await settled(() => !select().disabled && !row("Antidote"));
		check(!await fixture.adapter.exists(`${root}/Antidote/model/pack.json`) && await fixture.adapter.exists(`${root}/Antidote/dictionnaires/temoin.json`), "Effacer le modèle privé touche d’autres ressources privées");
	} finally { window.confirm = confirm; }
	check(await plugin.removeNeuralModel("../outside").then(() => false, () => true), "Suppression hors de la bibliothèque autorisée");
	await models.refresh();
	await models.remove("helper/neural/models/alternate");
	check(!await fixture.adapter.exists(`${alternate}/pack.json`), "Le modèle du nouveau dossier reste présent après suppression");
	container.remove();

}
