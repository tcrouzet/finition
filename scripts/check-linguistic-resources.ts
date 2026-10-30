import type { App, DataAdapter } from "obsidian";
import type FinitionPlugin from "../main";
import { FinitionSettingTab } from "../plugin/settings-tab";
import { resourceAssetName, resourceFiles, resourceSource, resourceEngines, resourcePacks, grammarFiles } from "../plugin/linguistic-files";
import { dictionaryFile, personalDictionaryPath, personalDictionaryFile } from "../plugin/lexicon/shared";
import type { ResourcePack } from "../plugin/linguistic-files";
import { LinguisticResources, parseResourceManifest, resourceHash } from "../plugin/linguistic-resources";

export async function resourceFixture(seed = true) {
	const input = document.querySelector<HTMLInputElement>("#neural-files")!;
	if (!input.files?.length) await new Promise(resolve => input.addEventListener("change", resolve, { once: true }));
	const files = new Map(Array.from(input.files!).map(file => [file.name, file]));
	const writes = new Map<string, ArrayBuffer>();
	const directories = new Set<string>();
	const removedRoots = new Set<string>();
	const revisions: Partial<Record<ResourcePack, string>> = {};
	const readSource = async (name: string) => {
		const file = files.get(name);
		if (!file) throw new Error(`Ressource du test absente : ${name}`);
		return file.arrayBuffer();
	};
	for (const engine of resourcePacks) revisions[engine] = await resourceHash(await readSource(`${engine}-resources.json`));
	const source = (path: string) => {
		if ([...removedRoots].some(root => path === root || path.startsWith(root + "/"))) return undefined;
		const privateFile = /\/Antidote\/model\/(pack\.json|electra\/(?:model\.json|weights\.bin|tokenizer\.json|labels\.json))$/u.exec(path);
		if (seed && privateFile) return files.get(`private-${privateFile[1].replace(/\//gu, "__")}`);
		if (seed && path.endsWith("/" + personalDictionaryPath)) return files.get(`private-${personalDictionaryFile}`);
		const match = /\/resources\/([^/]+)\/([a-f0-9]{64})\/(.+)$/u.exec(path);
		if (!seed || !match || !resourcePacks.some(engine => engine === match[1]) || revisions[match[1] as ResourcePack] !== match[2]) return undefined;
		return files.get(match[3] === "resources.json" ? `${match[1]}-resources.json` : resourceAssetName(match[1] as ResourcePack, match[3]));
	};
	const readBinary = async (path: string) => {
			const bytes = writes.get(path);
			if (bytes) return bytes.slice(0);
			const file = source(path);
			if (!file) throw new Error(`ENOENT : ${path}`);
			return file.arrayBuffer();
	};
	const adapter = {
		readBinary,
		async list(path: string) {
			const folders = new Set<string>();
			for (const name of writes.keys()) {
				if (!name.startsWith(path + "/")) continue;
				const suffix = name.slice(path.length + 1);
				if (suffix.includes("/")) folders.add(`${path}/${suffix.split("/")[0]}`);
			}
			return { folders: [...folders], files: [] };
		},
		async read(path: string) { return new TextDecoder().decode(await readBinary(path)); },
		async stat(path: string) {
			const size = writes.get(path)?.byteLength ?? source(path)?.size;
			return size === undefined ? null : { type: "file", size, mtime: 0, ctime: 0 };
		},
		async exists(path: string) { return writes.has(path) || Boolean(source(path)) || directories.has(path); },
		async mkdir(path: string) { directories.add(path); },
		async writeBinary(path: string, data: ArrayBuffer) { writes.set(path, data.slice(0)); },
		async remove(path: string) { if (!writes.delete(path)) throw new Error(`ENOENT : ${path}`); },
		async rmdir(path: string, recursive: boolean) {
			if (!recursive) throw new Error("Le dossier du modèle doit être supprimé récursivement");
			for (const name of writes.keys()) if (name.startsWith(path + "/")) writes.delete(name);
			for (const name of directories) if (name === path || name.startsWith(path + "/")) directories.delete(name);
			removedRoots.add(path);
		},
	} as unknown as DataAdapter;
	return { adapter, revisions, readSource, writes };
}

export async function checkLinguisticInstallation(Plugin: typeof FinitionPlugin, getMenu: () => Array<{ title: string; titleNode?: DocumentFragment; disabled: boolean; checked: boolean; click: () => Promise<void> }>, setHandler: (handler: (request: { url: string; method?: string; body?: string }) => Promise<{ status: number; arrayBuffer: ArrayBuffer }>) => void): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const missing = (item: ReturnType<typeof getMenu>[number] | undefined) => Boolean(item?.titleNode?.querySelector(".finition-resource-required"));
	check(resourceEngines.join("|") === "grammalecte|finition-corrector", "Catalogue des moteurs locaux incorrect");
	check(Object.values(resourceFiles).flat().every(file => /\.(?:json|bin|txt|md)$/u.test(file)), "Le téléchargement contient autre chose que des données");
	check(resourceFiles["finition-corrector"].every(file => !file.startsWith("electra/")), "Un modèle privé serait distribué");
	check(resourcePacks.every(engine => resourceFiles[engine].every(file => resourceSource(engine, file).startsWith(file.endsWith(".bin") ? "scripts/neural/" : "resources/"))), "Données publiques et binaires de préparation mélangés");
	const fixture = await resourceFixture(false);
	const plugin = new Plugin({ vault: { adapter: fixture.adapter }, workspace: { iterateAllLeaves() {}, getActiveViewOfType: () => null } } as unknown as App, { id: "finition", name: "Finition", version: "0.4.3", minAppVersion: "1.0.0", description: "", author: "", dir: "test-plugin" });
	const openedTabs: string[] = [];
	Object.assign(plugin.app, { setting: { open() {}, openTabById(id: string) { openedTabs.push(id); } } });
	const internal = plugin as unknown as { showModeMenu: (event: MouseEvent) => void };
	await plugin.loadSettings();
	await plugin.saveData({ ...plugin.settings, spellingEngine: "removed-engine", resourcePacks: { grammalecte: fixture.revisions.grammalecte, "removed-engine": "0".repeat(64) } });
	await plugin.loadSettings();
	check(plugin.settings.spellingEngine === "grammalecte" && Object.keys(plugin.settings.resourcePacks).join("|") === "grammalecte" && plugin.settings.resourcePacks.grammalecte === fixture.revisions.grammalecte, "Ancien moteur non migré ou ressources conservées perdues");
	const migrated = await plugin.loadData() as { spellingEngine: string; resourcePacks: Record<string, string> };
	check(migrated.spellingEngine === "grammalecte" && !("removed-engine" in migrated.resourcePacks), "Migration des anciens réglages non persistée");
	await plugin.loadLinguisticResources();
	const menus = () => {
		internal.showModeMenu(new MouseEvent("click"));
		const items = getMenu().filter(item => ["Tricolons", "Structure"].includes(item.title));
		check(items.length === 2, "Un mode linguistique manque dans le menu");
		return items;
	};
	internal.showModeMenu(new MouseEvent("click"));
	check(!getMenu().some(item => item.title === "Structure"), "Structure est visible sans mode debug");
	plugin.settings.debugMode = true;
	check(menus().every(item => missing(item) && !item.disabled), "Installation vide : menus actifs");
	check(["Répétitions", "Stéréotypes", "Copules"].every(title => missing(getMenu().find(item => item.title === title))), "Un surlignage lexical est disponible sans dictionnaire");
	for (const mode of ["repetition", "stereotype", "copules"] as const) {
		await plugin.setMode(mode);
		check(plugin.settings.mode !== mode, "Un surlignage lexical s’active sans dictionnaire");
	}
	check(["Atténuations", "Monotonies", "Charnières"].every(title => !missing(getMenu().find(item => item.title === title))), "Une analyse sans lexique est grisée");
	const container = document.body.createDiv();
	const tab = new FinitionSettingTab(plugin.app, plugin);
	Object.assign(plugin, { settingsTab: tab });
	tab.containerEl = container;
	tab.update();
	const row = (name: string) => Array.from(container.querySelectorAll(".setting-item")).find(row => row.querySelector(".setting-item-name")?.textContent === name);
	const analysis = () => row("Moteur d’analyse")!.querySelector<HTMLSelectElement>("select")!;
	check(!container.querySelector('details[data-section="Dictionnaire"]'), "Une section Dictionnaire séparée subsiste");
	const correctionRows = Array.from(container.querySelectorAll('details[data-section="Corrections"] .setting-item-name')).map(row => row.textContent);
	check(correctionRows.indexOf("Moteur d’analyse") > correctionRows.indexOf("Charger un modèle neuronal") && correctionRows.indexOf("Correcteur neuronal par défaut") > correctionRows.indexOf("CamemBERT"), "Un sélecteur précède les ressources à charger");
	const corrector = () => row("Correcteur neuronal par défaut")!.querySelector<HTMLSelectElement>("select")!;
	const grammar = () => row("Grammalecte")!.querySelector<HTMLSelectElement>("select")!;
	const settled = async (condition: () => boolean) => {
		const deadline = performance.now() + 1000;
		while (!condition()) { check(performance.now() < deadline, "Les réglages de correction ne se stabilisent pas"); await new Promise(requestAnimationFrame); }
	};
	for (const [name, key] of [["Apostrophes validées automatiquement", "apostrophesAutoApply"], ["Autres ponctuations validées automatiquement", "punctuationAutoApply"]] as const) {
		const toggle = row(name)?.querySelector<HTMLInputElement>('input[type="checkbox"]');
		check(toggle && !toggle.checked, "Un interrupteur de validation indépendant manque ou est activé par défaut");
		toggle!.click();
		await settled(() => plugin.settings[key]);
		await plugin.loadSettings();
		check(plugin.settings[key] && plugin.settings.debugMode, "Le choix de validation ne persiste pas ou change le mode debug");
	}
	for (const [title, section] of [["Tricolons", "Corrections"], ["Synonymes", "Synonymes"], ["Étymologie", "Étymologie"], ["Citations", "Citations"]]) {
		internal.showModeMenu(new MouseEvent("click"));
		const item = getMenu().find(item => item.title === title)!;
		check(missing(item) && !item.disabled, "Une ressource absente doit rester grisée et cliquable");
		await item.click();
		await settled(() => Boolean(container.querySelector<HTMLDetailsElement>(`details[data-section="${section}"]`)?.open));
		check(openedTabs.at(-1) === "finition", "Le menu de téléchargement n’ouvre pas les réglages de Finition");
		check(container.querySelector(`details[data-section="${section}"] button`)?.textContent === "Charger", "La section ouverte ne propose pas de charger sa ressource");
	}
	const choose = async (value: string) => {
		const dropdown = value === "fr-classic" || value === "fr-reform" ? grammar : corrector;
		const select = dropdown();
		select.value = value;
		select.dispatchEvent(new Event("change"));
		await settled(() => !dropdown().disabled && dropdown().value === value);
	};
	check(analysis().disabled && analysis().options.length === 0, "Un dictionnaire d’analyse absent est sélectionnable");
	check(corrector().options.length === 0 && corrector().disabled && grammar().options.length === 0 && grammar().disabled && !row("Moteur linguistique") && !row("Modèle neuronal"), "Des correcteurs absents sont proposés dans les réglages");
	check(row("Grammalecte")?.querySelector("button")?.textContent === "Charger", "Le chargement de Grammalecte est absent");
	for (const [name, href] of [["Grammalecte", "https://grammalecte.net/"], ["CamemBERT", "https://huggingface.co/almanach/camembertv2-base"]]) {
		const link = row(name)?.querySelector<HTMLAnchorElement>("a");
		check(link?.href === href && link.textContent === "Documentation" && link.parentElement?.textContent === "Documentation", "Le lien de documentation est absent ou accompagné de commentaires");
	}


	const engines = () => {
		internal.showModeMenu(new MouseEvent("click"));
		const titles = getMenu().map(item => item.title);
		check(!titles.includes("Corrections") && !titles.includes("Ortho-typo IA") && titles.slice(titles.indexOf("Grammalecte"), titles.indexOf("Grammalecte") + 3).join("|") === "Grammalecte|Neuronal|Corrections IA", "La section ne contient pas les trois correcteurs attendus");
		const items = getMenu().filter(item => ["Grammalecte", "Neuronal"].includes(item.title));
		check(items.length === 2, "Choix des deux moteurs absent du menu musique");
		return items;
	};
	check(engines().every(item => missing(item) && !item.disabled && !item.checked), "Moteur absent sélectionnable dans le menu musique");
	await engines().find(item => item.title === "Neuronal")!.click();
	check(plugin.settings.spellingEngine === "grammalecte" && !plugin.settings.spellingNeural, "Un moteur absent peut être activé");
	await plugin.setMode("ternary");
	check(plugin.settings.mode !== "ternary", "Tricolons activé sans dictionnaire");
	let requests = 0;
	let spinnerVisible = true;
	const prefix = "https://github.com/tcrouzet/finition/releases/download/resources-0.4.3/";
	setHandler(async request => {
		requests++;
		if (!document.querySelector('.notice .finition-correction-spinner[data-icon="loader-circle"]')) spinnerVisible = false;
		check(request.url.startsWith(prefix) && request.method === "GET" && !request.body, "Le téléchargement transmet des données ou utilise une source inattendue");
		return { status: 200, arrayBuffer: await fixture.readSource(request.url.slice(prefix.length)) };
	});
	check(row("Dictionnaire Finition")?.querySelector("button")?.textContent === "Charger", "Le chargement indépendant du dictionnaire manque");
	row("Dictionnaire Finition")!.querySelector<HTMLButtonElement>("button")!.click();
	await settled(() => row("Dictionnaire Finition")?.querySelector<HTMLButtonElement>("button")?.textContent === "Recharger" && !row("Dictionnaire Finition")?.querySelector<HTMLButtonElement>("button")?.disabled);
	check(requests === 3 && plugin.hasLexicon && !plugin.hasLinguisticResources, "Le dictionnaire seul installe un correcteur ou reste indisponible");
	internal.showModeMenu(new MouseEvent("click"));
	check(["Répétitions", "Stéréotypes"].every(title => !missing(getMenu().find(item => item.title === title))), "Les surlignages lexicaux restent grisés après installation");
	check(menus().every(item => missing(item) && !item.disabled), "Le dictionnaire seul active les analyses syntaxiques");
	check(plugin.lexicon.size === 0, "Les analyses lexicales sont chargées avant leur utilisation");
	requests = 0;
	row("Grammalecte")!.querySelector<HTMLButtonElement>("button")!.click();
	await settled(() => row("Grammalecte")?.querySelector<HTMLButtonElement>("button")?.textContent === "Recharger" && !grammar().disabled);
	check(spinnerVisible, "La roue disparaît pendant le téléchargement des réglages");
	check(!document.querySelector(".notice .finition-correction-spinner"), "La roue reste affichée après le téléchargement");
	check(Array.from(analysis().options).map(option => option.text).join("|") === "Grammalecte", "Un moteur d’analyse non installé est proposé");
	check(requests === 7 && plugin.hasLinguisticResources, "Téléchargement incomplet, dictionnaire téléchargé deux fois ou moteur inactif");
	check(Array.from(grammar().options).map(option => option.text).join("|") === "Classique|Réforme 1990" && grammar().value === "fr-classic" && corrector().disabled, "Les deux variantes installées de Grammalecte sont absentes");
	await choose("fr-reform");
	await plugin.loadSettings();
	check(plugin.settings.spellingEngine === "grammalecte" && plugin.settings.grammalecteDictionary === "fr-reform", "La variante Réforme 1990 n’est pas persistée");
	await choose("fr-classic");
	await plugin.loadSettings();
	check(plugin.settings.grammalecteDictionary === "fr-classic", "Le retour au dictionnaire classique n’est pas persisté");

	check(menus().every(item => !missing(item) && !item.disabled), "Installation réussie : menus encore grisés");
	check(!missing(engines().find(item => item.title === "Grammalecte")) && missing(engines().find(item => item.title === "Neuronal")), "Disponibilité des moteurs du menu incorrecte");
	await plugin.setMode("ternary");
	check(plugin.settings.mode === "ternary", "Tricolons reste inaccessible avec un dictionnaire");
	await plugin.setSpellingEngine("finition-corrector");
	check(plugin.settings.mode === "ternary" && plugin.settings.analysisEngine === "grammalecte" && menus().every(item => !missing(item) && !item.disabled), "Changer de correcteur désactive le dictionnaire d’analyse ou Tricolons");
	const missingAnalysis = await plugin.setAnalysisEngine("finition-corrector").then(() => false, () => true);
	check(missingAnalysis && plugin.settings.analysisEngine === "grammalecte", "Un dictionnaire d’analyse absent peut être sélectionné");
	await plugin.setSpellingEngine("grammalecte");
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check(plugin.hasLinguisticResources, "Installation perdue après rechargement des réglages");
	const revision = plugin.settings.resourcePacks.grammalecte;
	const text = new TextDecoder().decode(await fixture.readSource("grammalecte-resources.json"));
	const manifest = parseResourceManifest(text, "grammalecte");
	const commonFile = manifest.files.find(file => file.path === dictionaryFile)!;
	const commonPath = `test-plugin/data/lexique/${commonFile.sha256}.json`;
	check(fixture.writes.has(commonPath), "Le lexique n’est pas stocké dans le cache partagé");
	let incompleteRejected = false;
	try { parseResourceManifest(JSON.stringify({ ...manifest, files: manifest.files.filter(file => file.path !== "MPL-2.0.txt") }), "grammalecte"); } catch { incompleteRejected = true; }
	check(incompleteRejected, "Un nouveau pack sans licence est accepté comme ancien pack");
	for (const bad of ["../escape.json", "/absolute", "phonet_data.json\u0000", "a/../../x", "\u202ex.js", ...manifest.files.flatMap(file => [`../${file.path}`, `${file.path}\u0000`, `${file.path}\\suffix`])]) {
		const changed = { ...manifest, files: manifest.files.map((file, index) => index === 0 ? { ...file, path: bad } : file) };
		let rejected = false;
		try { parseResourceManifest(JSON.stringify(changed), "grammalecte"); } catch { rejected = true; }
		check(rejected, `Chemin malveillant accepté : ${JSON.stringify(bad)}`);
	}
	const altered = { ...manifest, files: manifest.files.map((file, index) => index === 0 ? { ...file, sha256: "0".repeat(64) } : file) };
	setHandler(async request => ({ status: 200, arrayBuffer: request.url.endsWith("grammalecte-resources.json") ? new TextEncoder().encode(JSON.stringify(altered)).buffer : await fixture.readSource(request.url.slice(prefix.length)) }));
	const failure = await plugin.downloadLinguisticResources("grammalecte", () => {}).then(() => "", (error: unknown) => error instanceof Error ? error.message : String(error));
	check(failure.includes("altéré") && plugin.settings.resourcePacks.grammalecte === revision && plugin.hasLinguisticResources, "Un téléchargement altéré remplace l’installation valide");
	setHandler(async () => ({ status: 404, arrayBuffer: new ArrayBuffer(0) }));
	const unavailable = await plugin.downloadLinguisticResources("grammalecte", () => {}).then(() => "", (error: unknown) => error instanceof Error ? error.message : String(error));
	check(unavailable.includes("404") && plugin.hasLinguisticResources, "Une erreur réseau désactive le moteur installé");
	fixture.writes.delete(commonPath);
	await plugin.loadLinguisticResources();
	check(menus().every(item => missing(item) && !item.disabled), "Un pack incomplet laisse les modes actifs");
	check(!plugin.hasLexicon && plugin.lexicon.size === 0, "Un lexique absent reste actif ou en mémoire");
	check(engines().every(item => missing(item) && !item.disabled), "Un pack incomplet reste sélectionnable dans le menu musique");
	tab.update();
	check(corrector().options.length === 0 && corrector().disabled && grammar().options.length === 0 && grammar().disabled, "Un pack incomplet reste sélectionnable dans les réglages");
	check([...fixture.writes.keys()].every(path => path.startsWith("test-plugin/data/resources/") || path === commonPath), "Une installation écrit hors des caches de données autorisés");
	const previous = await resourceFixture(false);
	for (const file of ["resources.json", ...resourceFiles.grammalecte]) await previous.adapter.writeBinary(`previous-plugin/resources/grammalecte/${previous.revisions.grammalecte}/${file}`, await previous.readSource(file === "resources.json" ? "grammalecte-resources.json" : resourceAssetName("grammalecte", file)));
	const retained = new LinguisticResources(previous.adapter, "previous-plugin", "0.4.3");
	await retained.refresh(previous.revisions);
	check(retained.available("grammalecte") && (await retained.read("grammalecte", "phonet_data.json")).byteLength > 0, "Un pack téléchargé avant le déplacement n’est plus lisible");
	const complete = await resourceFixture();
	const choice = new Plugin({ vault: { adapter: complete.adapter }, workspace: { iterateAllLeaves() {}, getActiveViewOfType: () => null } } as unknown as App, { id: "finition", name: "Finition", version: "0.4.3", minAppVersion: "1.0.0", description: "", author: "", dir: "test-plugin" });
	await choice.loadSettings();
	choice.settings.resourcePacks = { ...complete.revisions };
	delete choice.settings.resourcePacks.lexique;
	await choice.loadLinguisticResources();
	check(choice.hasLexicon, "Un lexique déjà installé avec un correcteur n’est pas reconnu");
	tab.plugin = choice;
	tab.update();
	check(Array.from(corrector().options).map(option => option.value).join("|") === "finition-corrector|Antidote/model" && Array.from(corrector().options).map(option => option.text).join("|") === "CamemBERT|Antidote" && row("CamemBERT") && row("Antidote"), "La liste neuronale mélange Grammalecte ou perd le nom des modèles");
	check(Array.from(analysis().options).map(option => option.text).join("|") === "Grammalecte|Neuronal", "Le choix du dictionnaire d’analyse manque ou expose les modèles de correction");
	choice.wordCategoryCache.set("périmé", "nom");
	const generation = choice.wordCategoryCacheVersion;
	analysis().value = "finition-corrector";
	analysis().dispatchEvent(new Event("change"));
	await settled(() => choice.settings.analysisEngine === "finition-corrector" && choice.wordCategoryCacheVersion > generation);
	await choice.loadSettings();
	check(choice.settings.analysisEngine === "finition-corrector" && choice.settings.spellingEngine === "grammalecte" && choice.wordCategoryCache.size === 0, "Le choix d’analyse ne se sauvegarde pas indépendamment ou garde les anciennes catégories");
	await choose("finition-corrector");
	await choice.loadSettings();
	check(choice.settings.spellingEngine === "finition-corrector" && corrector().value === "finition-corrector", "Le correcteur neuronal par défaut CamemBERT n’est pas persisté");
	await choose("fr-reform");
	await choice.loadSettings();
	check(choice.settings.spellingEngine === "grammalecte" && choice.settings.grammalecteDictionary === "fr-reform", "Changer de moteur perd la variante Grammalecte");

	await choice.saveData({ ...choice.settings, analysisEngine: undefined, spellingEngine: "finition-corrector" });
	await choice.loadSettings();
	check(choice.settings.analysisEngine === "finition-corrector", "Une ancienne configuration perd son moteur d’analyse");
	await choice.setAnalysisEngine("grammalecte");
	await choice.setSpellingEngine("grammalecte");
	const choiceMenu = () => { (choice as unknown as { showModeMenu: (event: MouseEvent) => void }).showModeMenu(new MouseEvent("click")); return getMenu(); };
	check(choiceMenu().filter(item => ["Grammalecte", "Neuronal"].includes(item.title)).every(item => !item.disabled), "Moteur installé grisé");
	await choiceMenu().find(item => item.title === "Neuronal")!.click();
	await choice.loadSettings();
	check(choice.settings.spellingEngine === "finition-corrector" && choice.settings.spellingNeural && !choiceMenu().find(item => item.title === "Neuronal")?.checked, "Choix Neuronal non persisté ou coché sans suggestions");
	await choiceMenu().find(item => item.title === "Grammalecte")!.click();
	await choice.loadSettings();
	check(choice.settings.spellingEngine === "grammalecte" && !choiceMenu().find(item => item.title === "Grammalecte")?.checked && !choiceMenu().find(item => item.title === "Neuronal")?.checked, "Choix Grammalecte non persisté ou coché sans suggestions");
	for (const file of resourceFiles.grammalecte) await fixture.adapter.writeBinary(`legacy-plugin/${resourceSource("grammalecte", file)}`, await fixture.readSource(resourceAssetName("grammalecte", file)));
	const legacy = new LinguisticResources(fixture.adapter, "legacy-plugin", "0.4.3");
	await legacy.refresh({});
	check(legacy.available("grammalecte") && !legacy.available("finition-corrector"), "Les ressources locales existantes ne sont pas reconnues");
	check((await legacy.read("grammalecte", "phonet_data.json")).byteLength > 0, "Les ressources locales ne sont pas lisibles");
	const oldCatalogue = { ...manifest, version: 1, files: Object.values(grammarFiles).map(path => ({ path, bytes: 1, sha256: "a".repeat(64) })) };
	check(parseResourceManifest(JSON.stringify(oldCatalogue), "grammalecte").version === 1, "L’ancien format Grammalecte n’est plus lisible");
	const sharedFixture = await resourceFixture(false);
	const shared = new LinguisticResources(sharedFixture.adapter, "shared-plugin", "0.4.3");
	let dictionaryRequests = 0;
	setHandler(async request => {
		if (request.url.endsWith(resourceAssetName("grammalecte", dictionaryFile))) dictionaryRequests++;
		return { status: 200, arrayBuffer: await sharedFixture.readSource(request.url.slice(prefix.length)) };
	});
	const [grammarRevision, neuralRevision] = await Promise.all([shared.install("grammalecte", () => {}), shared.install("finition-corrector", () => {})]);
	await shared.refresh({ grammalecte: grammarRevision, "finition-corrector": neuralRevision });
	check(dictionaryRequests === 1, "Le dictionnaire commun est téléchargé deux fois");
	check([...sharedFixture.writes.keys()].filter(path => path.includes("/data/lexique/")).length === 1, "Le dictionnaire commun est copié pour chaque moteur");
	check(shared.available("grammalecte") && shared.available("finition-corrector"), "La déduplication désactive un moteur");
	check(await resourceHash(await shared.read("grammalecte", dictionaryFile)) === await resourceHash(await shared.read("finition-corrector", dictionaryFile)), "Les moteurs ne lisent pas le même dictionnaire");
	container.remove();
	console.error("Ressources : sélecteur de correcteur, variantes, absence, téléchargement, activation, rechargement, intégrité, chemins et échec réseau vérifiés");
}
