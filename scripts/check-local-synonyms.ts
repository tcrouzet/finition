import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { FileSystemAdapter, MarkdownView, type App, type EditorPosition } from "obsidian";
import type FinitionPlugin from "../main";
import { resourceFixture } from "./check-linguistic-resources";
import { FinitionSettingTab } from "../plugin/settings-tab";

export async function checkLocalSynonyms(Plugin: typeof FinitionPlugin, getMenu: () => Array<{ title: string; disabled: boolean; click: () => Promise<void> }>, setHandler: (handler: (request: { url: string; method?: string; body?: string }) => Promise<{ status: number; arrayBuffer: ArrayBuffer }>) => void, requests: unknown[], notices: string[], modals: Array<{ close: () => void }>): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const fixture = await resourceFixture(false);
	const view = new EditorView({ parent: document.body.createDiv(), state: EditorState.create({ doc: "Un pas rapide.", selection: { anchor: 13, head: 7 } }) });
	const position = (offset: number): EditorPosition => { const line = view.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; };
	const offset = (pos: EditorPosition) => view.state.doc.line(pos.line + 1).from + pos.ch;
	const editor = {
		getValue: () => view.state.doc.toString(), getSelection: () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
		listSelections: () => view.state.selection.ranges.map(range => ({ anchor: position(range.anchor), head: position(range.head) })),
		getCursor: (which: "from" | "to") => position(view.state.selection.main[which]), posToOffset: offset, offsetToPos: position,
		replaceRange: (insert: string, from: EditorPosition, to: EditorPosition) => view.dispatch({ changes: { from: offset(from), to: offset(to), insert } }),
		setSelection: (anchor: EditorPosition, head: EditorPosition) => view.dispatch({ selection: { anchor: offset(anchor), head: offset(head) } }),
		focus: () => view.focus(),
	};
	const markdown = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { editor, file: { path: "test.md" } });
	let active: MarkdownView | null = markdown;
	const plugin = new Plugin({ vault: { adapter: fixture.adapter }, workspace: { getActiveViewOfType: () => active, iterateAllLeaves() {} } } as unknown as App, { id: "finition", name: "Finition", version: "0.4.3", minAppVersion: "1.0.0", description: "", author: "", dir: "test-plugin" });
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check(plugin.synonymDictionaryOptions.length === 0 && plugin.settings.synonymDictionaries.length === 0, "Des dictionnaires sont proposés avant installation");
	const container = document.body.createDiv();
	const tab = new FinitionSettingTab(plugin.app, plugin);
	tab.containerEl = container;
	const searchable = tab.getSettingDefinitions().flatMap(definition => [definition.name, ...(definition.aliases ?? [])]);
	check(["Compteur du document", "Grammalecte", "CamemBERT", "Clé API Anthropic", "Empan de répétition (caractères)", "Palette"].every(name => searchable.includes(name)), "Les paramètres ne sont pas indexés pour la recherche Obsidian");
	tab.update();
	const settingNames = Array.from(container.querySelectorAll(".setting-item-name")).map(row => row.textContent);
	check(settingNames.slice(0, 5).join("|") === "Compteur du document|Masquer le compteur de backlinks|Taille maximale de document analysé|Mode debug|Corrections" && !settingNames.includes("Mode actif"), "Mode debug doit suivre les réglages généraux et précéder Corrections, sans Mode actif");
	const expectedSections = "Corrections|Corrections IA|Synonymes|Définitions|Antonymes|Phonétique|Rimes|Répétitions|Cadence|Monotonie|Palette";
	check(Array.from(container.querySelectorAll(".setting-item-heading .setting-item-name")).map(heading => heading.textContent).join("|") === expectedSections, "Les sections sont mal ordonnées ou le titre Neuronal subsiste");
	const sections = Array.from(container.querySelectorAll<HTMLDetailsElement>("details"));
	check(sections.map(section => section.querySelector("summary")?.textContent).join("|") === expectedSections && sections.every(section => !section.open), "Toutes les sections de Corrections à Palette doivent être repliées par défaut");
	check(sections.every(section => section.querySelector("summary")!.checkVisibility() && !section.querySelector<HTMLElement>(".finition-settings-section-body")!.checkVisibility()), "Une section repliée cache son titre ou expose ses détails");
	for (const title of ["Corrections", "Corrections IA"]) container.querySelector<HTMLDetailsElement>(`details[data-section="${title}"]`)!.open = true;
	container.querySelector<HTMLDetailsElement>('details[data-section="Synonymes"]')!.open = true;
	sections.at(-1)!.open = true;
	tab.update();
	check(["Corrections", "Corrections IA", "Synonymes", "Palette"].every(title => container.querySelector<HTMLDetailsElement>(`details[data-section="${title}"]`)!.open) && !container.querySelector<HTMLDetailsElement>('details[data-section="Définitions"]')!.open, "Une actualisation referme les sections ouvertes ou ouvre leurs voisines");
	check(container.querySelector('details[data-section="Corrections"] select') && container.querySelector('details[data-section="Corrections IA"] input[type="password"]') && container.querySelector('details[data-section="Répétitions"] textarea') && container.querySelector('details[data-section="Cadence"] select') && container.querySelector('details[data-section="Monotonie"] input'), "Des réglages sont sortis de leur section pendant le réordonnancement");
	const debug = Array.from(container.querySelectorAll(".setting-item")).find(row => row.querySelector(".setting-item-name")?.textContent === "Mode debug")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
	check(!debug.checked, "Le mode debug est activé par défaut");
	debug.checked = true;
	debug.dispatchEvent(new Event("change"));
	await plugin.loadSettings();
	(plugin as unknown as { showModeMenu: (event: MouseEvent) => void }).showModeMenu(new MouseEvent("click"));
	check(plugin.settings.debugMode && getMenu().some(item => item.title === "Structure"), "L’interrupteur debug n’est pas persisté ou n’affiche pas Structure");
	debug.checked = false;
	debug.dispatchEvent(new Event("change"));
	await plugin.loadSettings();
	(plugin as unknown as { showModeMenu: (event: MouseEvent) => void }).showModeMenu(new MouseEvent("click"));
	check(!plugin.settings.debugMode && !getMenu().some(item => item.title === "Structure"), "Désactiver le mode debug ne masque pas Structure");
	tab.update = () => { container.empty(); (tab as unknown as { displaySynonyms: (container: HTMLElement) => void }).displaySynonyms(container); };
	tab.update();
	const select = () => container.querySelector<HTMLSelectElement>("select")!;
	const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
	const row = (name: string) => Array.from(container.querySelectorAll<HTMLElement>(".setting-item")).find(row => row.querySelector(".setting-item-name")?.textContent === name);
	const action = (name: string) => row(name)?.querySelector<HTMLButtonElement>("button");
	const settled = async (condition: () => boolean) => {
		const deadline = performance.now() + 1000;
		while (!condition()) { check(performance.now() < deadline, "Les réglages de synonymes ne se stabilisent pas"); await new Promise(requestAnimationFrame); }
	};
	check(select().options.length === 0 && select().disabled, "Le sélecteur vide propose un choix fictif");
	const pathInput = () => row("Charger un dictionnaire")!.querySelector<HTMLInputElement>('input[type="text"]')!;
	check(pathInput().getAttribute("aria-label") === "Chemin du dictionnaire JSON", "Le champ de chemin JSON est absent ou sans nom accessible");
	const formatLink = row("Charger un dictionnaire")!.querySelector<HTMLAnchorElement>("a")!;
	check(formatLink.textContent === "JSON au format Finition" && formatLink.href === "https://github.com/tcrouzet/finition/blob/main/doc/synonymes.md" && formatLink.parentElement?.textContent === formatLink.textContent, "Le lien vers la documentation du format est absent ou accompagné de commentaires");
	check(Array.from(container.querySelectorAll(".setting-item-name")).map(row => row.textContent).join("|") === "Synonymes|Dictionnaire|Finition|Charger un dictionnaire", "L’ordre des réglages de synonymes est incorrect");
	check(buttons().map(button => button.textContent).join("|") === "Charger|Charger|Parcourir…", "Des commandes de suppression sont présentes sans dictionnaire personnel");
	const menu = () => { (plugin as unknown as { showModeMenu: (event: MouseEvent) => void }).showModeMenu(new MouseEvent("click")); return getMenu(); };
	check(menu().find(item => item.title === "Synonymes")?.disabled, "Synonymes actif sans données");
	const beforeDownload = requests.length;
	const engine = plugin.settings.spellingEngine;
	const prefix = "https://github.com/tcrouzet/finition/releases/download/resources-0.4.3/";
	setHandler(async request => {
		check(request.url.startsWith(prefix) && request.method === "GET" && !request.body, "Téléchargement des synonymes inattendu");
		return { status: 200, arrayBuffer: await fixture.readSource(request.url.slice(prefix.length)) };
	});
	await plugin.downloadLinguisticResources("synonymes", () => {});
	check(requests.length === beforeDownload + 6 && plugin.hasSynonyms && plugin.settings.spellingEngine === engine, "Pack synonymes incomplet ou moteur modifié");
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check(plugin.hasSynonyms && !menu().find(item => item.title === "Synonymes")?.disabled && menu().some(item => item.title === "Synonymes IA"), "Choix locaux/IA absents après rechargement");
	tab.update();
	check(select().options.length === 1 && select().options[0].text === "Finition" && buttons()[0].textContent === "Recharger", "Finition installé manque dans le sélecteur");
	const offline = requests.length;
	setHandler(async () => { throw new Error("Réseau interdit pendant la recherche locale"); });
	await plugin.runSynonymsLocal();
	check(document.querySelector(".finition-synonyms")?.closest(".modal")?.querySelector("h2")?.textContent === "Synonymes", "Fenêtre locale absente");
	check(document.querySelector('[aria-label="Remplacer par véloce"]'), "Données publiques non utilisées");
	document.querySelector<HTMLButtonElement>('[aria-label="Remplacer par véloce"]')!.click();
	check(editor.getValue() === "Un pas véloce.", "Remplacement local incorrect");
	check(editor.getSelection() === "véloce" && view.hasFocus, "Le synonyme local remplacé n’est pas sélectionné et actif");
	const reset = () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Un pas rapide." }, selection: { anchor: 7, head: 13 } });
	reset();
	await plugin.runSynonymsLocal();
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.focus();
	modals.at(-1)!.close();
	check(editor.getValue() === "Un pas rapide." && editor.getSelection() === "rapide" && view.hasFocus, "Fermer les synonymes locaux sans choix perd la sélection active");
	reset();
	await plugin.runSynonymsLocal();
	view.dispatch({ changes: { from: 0, insert: "Autre. " } });
	const changed = editor.getValue();
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.click();
	check(editor.getValue() === changed && notices.at(-1)?.includes("changé"), "Une note modifiée est écrasée");
	modals.at(-1)!.close();
	reset();
	await plugin.runSynonymsLocal();
	active = null;
	document.querySelector<HTMLButtonElement>(".finition-synonym-replace")!.click();
	check(editor.getValue() === "Un pas rapide.", "Une note inactive est écrasée");
	modals.at(-1)!.close();
	active = markdown;
	for (const selection of [{ anchor: 7, head: 7 }, { anchor: 3, head: 13 }]) {
		view.dispatch({ selection });
		const item = menu().find(item => item.title === "Synonymes")!;
		check(!item.disabled, "Une sélection absente ou invalide grise Synonyme malgré le dictionnaire installé");
		const before = notices.length;
		await item.click();
		check(!document.querySelector(".finition-synonyms") && notices.length === before + 1 && notices.at(-1) === "Synonyme : sélectionne un seul mot." && editor.getValue() === "Un pas rapide.", "Le clic ne demande pas de sélectionner un mot ou modifie le texte");
	}
	for (const text of ["[rapide](https://example.org)", "https://example.org/rapide", "![rapide](image.png)", "[[Note|rapide]]", "<a href='https://example.org'>rapide</a>", "[rapide][ref]\n\n[ref]: https://example.org"]) {
		const from = text.indexOf("rapide");
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: from, head: from + 6 } });
		const before = requests.length;
		await plugin.runSynonymsLocal();
		check(!document.querySelector(".finition-synonyms") && requests.length === before && notices.at(-1)?.includes("hors des liens") && editor.getValue() === text, "Une recherche locale consulte ou modifie un mot dans un lien");
	}
	view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Un modèle." }, selection: { anchor: 3, head: 9 } });
	await plugin.runSynonymsLocal();
	const categories = Array.from(document.querySelectorAll<HTMLElement>(".finition-synonyms-category"));
	check(categories.map(heading => heading.textContent).join("|") === "Nom|Adjectif|Verbe|Nom ou adjectif", `Hiérarchie de modèle incorrecte : ${categories.map(heading => heading.textContent).join("|")}`);
	check(categories.every(heading => heading.tagName === "H3" && Number(getComputedStyle(heading).fontWeight) >= 600), "Sections grammaticales sans titres en gras");
	check(document.querySelectorAll(".finition-synonyms-section").length === 4, "Catégories non regroupées");
	const copyBounds = document.querySelector(".finition-synonyms-insert")!.getBoundingClientRect();
	check(copyBounds.top >= 0 && copyBounds.bottom <= innerHeight, "La longue liste masque le bouton de remarque");
	modals.at(-1)!.close();
	reset();
	const personal = { format: "finition-synonymes", version: 1, language: "fr", name: "Personnel", description: "Lexique <b>personnel</b>", documentation: "https://example.org/lexique", sources: [{ id: "local", name: "Local", license: "unspecified", url: "" }], groups: [
		{ category: "nom", label: "Partisan", sense: "Personne qui soutient une cause.", words: ["personnel", "fidèle", "mainteneur"], sources: ["local"], registers: [{ labels: ["rare"], words: ["mainteneur"] }] },
		{ category: "nom", label: "Représentant", sense: "Personne qui soutient une cause.", words: ["apôtre"], unmarked: ["apôtre"], registers: [{ labels: ["rare"], words: ["apôtre"] }], sources: ["local"] },
		{ category: "nom", label: "Protecteur", sense: "Personne qui protège.", words: ["personnel", "gardien", "obstineur", "obstineux"], sources: ["local"], registers: [{ labels: ["québec"], words: ["obstineur"] }, { labels: ["québec", "familier"], words: ["obstineux"] }] },
	], index: { rapide: [0, 1, 2] } };
	await fixture.adapter.writeBinary("dictionnaires/prive.json", new TextEncoder().encode(JSON.stringify(personal)).buffer);
	tab.update();
	pathInput().value = "dictionnaires/prive.json";
	pathInput().dispatchEvent(new Event("input"));
	check(plugin.settings.synonymDictionaryPath === "", "Saisir un chemin change le dictionnaire actif avant chargement");
	action("Charger un dictionnaire")!.click();
	await settled(() => !select().disabled && plugin.settings.synonymDictionaryPath !== "");
	check(pathInput().value === "", "Le chemin n’est pas vidé après import");
	const importedPath = plugin.settings.synonymDictionaryPath;
	check(/^test-plugin\/data\/synonymes-[a-f0-9]{64}\/data\.json$/u.test(importedPath), "Le dictionnaire personnel n’est pas copié dans data");
	check(new TextDecoder().decode(await fixture.adapter.readBinary(importedPath)) === JSON.stringify(personal), "La copie du dictionnaire a changé ses données");
	fixture.writes.set("dictionnaires/prive.json", new TextEncoder().encode("{}").buffer);
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check(plugin.settings.synonymDictionaryPath === importedPath && plugin.hasSynonyms, "La copie personnelle n’est pas persistée ou dépend encore de sa source");
	check(plugin.synonymDictionaryOptions.map(option => option.name).join("|") === "Finition|Personnel", "Le dictionnaire personnel n’est pas conservé dans la liste");
	tab.update();
	check(row("Personnel")?.querySelector("a")?.textContent === personal.description && !row("Personnel")?.querySelector("b") && row("Personnel")?.querySelector<HTMLAnchorElement>("a")?.href === personal.documentation, "La description ou sa documentation ne survit pas à l’import et au rechargement, ou interprète du HTML");
	check(row("Finition")?.textContent?.includes("myThes et WOLF") && row("Finition")?.querySelector("a")?.textContent === "myThes et WOLF", "La description de Finition est absente");
	await plugin.runSynonymsLocal();
	check(document.querySelector('[aria-label="Remplacer par personnel"]') && !document.querySelector('[aria-label="Remplacer par véloce"]'), "Dictionnaire personnel non sélectionné");
	check(Array.from(document.querySelectorAll(".finition-synonyms-label")).map(heading => heading.textContent).join("|") === "Partisan|Représentant|Protecteur", "Groupes de sens aplatis ou mélangés");
	check(document.querySelectorAll('[aria-label="Remplacer par personnel"]').length === 2 && document.querySelectorAll(".finition-synonyms-category").length === 1, "Sens commun perdu ou catégorie répétée");
	check(document.querySelectorAll(".finition-synonyms-definition").length === 2 && document.querySelectorAll(".finition-synonyms-registers .finition-synonyms-registers").length === 1, "Définitions répétées ou sous-registre aplati");
	check(!document.querySelector('.finition-synonyms-group > .finition-synonyms [aria-label="Remplacer par mainteneur"]') && document.querySelector('.finition-synonyms-registers [aria-label="Remplacer par mainteneur"]'), "Le registre rare est mélangé aux synonymes courants");
	check(document.querySelectorAll('[aria-label="Remplacer par apôtre"]').length === 2, "Une graphie courante et marquée a perdu un de ses usages");
	const labelBounds = document.querySelector(".finition-synonyms-label")!.getBoundingClientRect();
	const wordBounds = document.querySelector('[aria-label="Remplacer par personnel"]')!.getBoundingClientRect();
	check(labelBounds.top < wordBounds.bottom && wordBounds.top < labelBounds.bottom, "Le groupe et ses synonymes ne partagent pas la même ligne");
	// Obsidian réinitialise son champ interne selection à l’ouverture.
	Reflect.set(modals.at(-1)!, "selection", null);
	const insert = document.querySelector<HTMLButtonElement>(".finition-synonyms-insert")!;
	check(insert.dataset.icon === "message-square-plus" && !insert.textContent && insert.getAttribute("aria-label") === "Insérer la liste en remarque", "Remarque locale sans icône accessible");
	insert.click();
	check(editor.getValue() === "Un pas rapide.\n\n%%\nSynonyme — rapide\n\n" + "**Nom**\n\n**Personne qui soutient une cause.**\n\n- **Partisan** — personnel, fidèle\n  - **rare** — mainteneur\n- **Représentant** — apôtre\n  - **rare** — apôtre\n\n**Personne qui protège.**\n\n- **Protecteur** — personnel, gardien\n  - **québec** — obstineur\n    - **familier** — obstineux" + "\n%%\n", "La remarque locale perd ses sens ou registres");
	check(editor.getSelection() === "rapide" && view.hasFocus, "La remarque locale perd la sélection active");
	reset();
	await plugin.runSynonymsLocal();
	document.querySelector<HTMLButtonElement>('[aria-label="Remplacer par mainteneur"]')!.click();
	check(editor.getValue() === "Un pas mainteneur.", "Le remplacement inclut le libellé du registre");
	check(editor.getSelection() === "mainteneur" && view.hasFocus, "Le synonyme plus long n’est pas entièrement sélectionné et actif");
	reset();
	for (const path of ["../hors-coffre.json", "/tmp/hors-coffre.json", "absent.json", "dictionnaires/prive.json"]) {
		let rejected = false;
		try { await plugin.setSynonymDictionaryPath(path); } catch { rejected = true; }
		check(rejected && plugin.settings.synonymDictionaryPath === importedPath && plugin.hasSynonyms && !menu().find(item => item.title === "Synonymes")?.disabled, "Un import invalide désactive le dernier dictionnaire valide");
	}
	const save = plugin.saveSettings.bind(plugin);
	plugin.saveSettings = async () => { throw new Error("Écriture impossible"); };
	let failedSave = false;
	try { await plugin.importSynonymDictionary(new TextEncoder().encode(JSON.stringify({ ...personal, name: "Autre" })).buffer); } catch { failedSave = true; }
	plugin.saveSettings = save;
	check(failedSave && plugin.settings.synonymDictionaryPath === importedPath && plugin.settings.synonymDictionaries.length === 1 && plugin.hasSynonyms, "Un échec d’enregistrement perd le dictionnaire actif ou modifie sa liste");
	Object.setPrototypeOf(fixture.adapter, FileSystemAdapter.prototype);
	(fixture.adapter as FileSystemAdapter).getBasePath = () => "/coffre";
	await fixture.adapter.writeBinary("dictionnaires/valide.json", new TextEncoder().encode(JSON.stringify(personal)).buffer);
	await plugin.setSynonymDictionaryPath("/coffre/dictionnaires/valide.json");
	check(plugin.settings.synonymDictionaryPath === importedPath, "Un chemin absolu interne au coffre ne retrouve pas la même copie");
	await plugin.importSynonymDictionary(new TextEncoder().encode(JSON.stringify({ ...personal, name: "Choisi", description: "" })).buffer);
	check(plugin.settings.synonymDictionaryPath !== importedPath && plugin.hasSynonyms, "L’import depuis un fichier choisi ne fonctionne pas");
	const secondPath = plugin.settings.synonymDictionaryPath;
	tab.update();
	check(select().options.length === 3 && select().value === secondPath, "Plusieurs dictionnaires importés ne sont pas sélectionnables");
	check(row("Choisi")?.querySelector("a")?.textContent === "Documentation", "Le lien sans description ne porte pas le nom Documentation");
	check(Array.from(select().options).map(option => option.text).join("|") === "Finition|Personnel|Choisi", "Le sélecteur n’affiche pas le champ name des dictionnaires importés");
	check(Array.from(container.querySelectorAll(".setting-item-name")).map(row => row.textContent).join("|") === "Synonymes|Dictionnaire|Finition|Personnel|Choisi|Charger un dictionnaire", "L’import ne se trouve pas sous la liste commune des dictionnaires");
	check(action("Finition")?.textContent === "Recharger" && action("Personnel")?.textContent === "Effacer" && action("Choisi")?.textContent === "Effacer" && !action("Personnel")?.disabled, "Les actions ne sont pas propres à chaque dictionnaire");
	select().value = importedPath;
	select().dispatchEvent(new Event("change"));
	await settled(() => !select().disabled && plugin.settings.synonymDictionaryPath === importedPath);
	const remove = fixture.adapter.remove.bind(fixture.adapter);
	fixture.adapter.remove = async () => { throw new Error("Suppression impossible"); };
	let failedDelete = false;
	try { await plugin.removeSynonymDictionary(importedPath); } catch { failedDelete = true; }
	fixture.adapter.remove = remove;
	check(failedDelete && plugin.settings.synonymDictionaryPath === importedPath && plugin.synonymDictionaryOptions.length === 3 && await fixture.adapter.exists(importedPath), "Une suppression échouée perd le choix ou la liste");
	const confirm = window.confirm.bind(window);
	try {
		window.confirm = () => false;
		action("Personnel")!.click();
		check(await fixture.adapter.exists(importedPath), "Annuler efface le dictionnaire");
		window.confirm = () => true;
		action("Choisi")!.click();
		await settled(() => !select().disabled && select().options.length === 2);
		check(plugin.settings.synonymDictionaryPath === importedPath && await fixture.adapter.exists(importedPath) && !await fixture.adapter.exists(secondPath), "Effacer un dictionnaire inactif modifie le choix actif");
		await plugin.importSynonymDictionary(new TextEncoder().encode(JSON.stringify({ ...personal, name: "Choisi", description: "" })).buffer);
		await plugin.setSynonymDictionary(importedPath);
		tab.update();
		action("Personnel")!.click();
		await settled(() => !select().disabled && plugin.settings.synonymDictionaryPath === "");
		check(!await fixture.adapter.exists(importedPath) && await fixture.adapter.exists("dictionnaires/prive.json") && select().options.length === 2 && !row("Personnel") && action("Finition")?.textContent === "Recharger", "Effacer ne retire pas uniquement la copie choisie ou ne revient pas à Finition");
	} finally { window.confirm = confirm; }
	let rejectedDelete = false;
	try { await plugin.removeSynonymDictionary("dictionnaires/prive.json"); } catch { rejectedDelete = true; }
	check(rejectedDelete && await fixture.adapter.exists("dictionnaires/prive.json"), "Un fichier source peut être supprimé");
	await plugin.setSynonymDictionary(secondPath);
	await plugin.loadSettings();
	await plugin.loadLinguisticResources();
	check(plugin.settings.synonymDictionaryPath === secondPath && plugin.synonymDictionaryOptions.length === 2, "Le choix et la liste ne survivent pas au rechargement");
	await plugin.setSynonymDictionaryPath("");
	await plugin.runSynonymsLocal();
	check(document.querySelector('[aria-label="Remplacer par véloce"]'), "Retour au dictionnaire public impossible");
	modals.at(-1)!.close();
	check(requests.length === offline, "Une recherche locale utilise le réseau");
	const empty = new Plugin(plugin.app, plugin.manifest);
	await empty.loadSettings();
	await empty.loadLinguisticResources();
	await empty.importSynonymDictionary(new TextEncoder().encode(JSON.stringify({ ...personal, name: "Seul", documentation: "" })).buffer);
	check(empty.synonymDictionaryOptions.length === 1 && empty.hasSynonyms, "Un dictionnaire personnel nécessite le pack public");
	tab.plugin = empty;
	tab.update();
	check(row("Seul")?.textContent?.includes(personal.description) && !row("Seul")?.querySelector("a, b"), "La description sans lien doit rester du texte simple");
	await empty.removeSynonymDictionary(empty.settings.synonymDictionaryPath);
	check(empty.synonymDictionaryOptions.length === 0 && !empty.hasSynonyms, "Effacer le dernier dictionnaire ne rétablit pas la liste vide");
	await empty.saveData({ ...empty.settings, synonymDictionaryPath: "dictionnaires/valide.json", synonymDictionaries: [] });
	await empty.loadSettings();
	await empty.loadLinguisticResources();
	check(empty.synonymDictionaryOptions[0]?.name === "Personnel" && empty.settings.synonymDictionaryPath === importedPath && empty.hasSynonyms, "L’ancien dictionnaire sélectionné n’est pas repris dans la liste");
	container.remove();
	view.destroy();
	view.dom.parentElement?.remove();
	console.error("Synonymes locaux : téléchargement, menu, sélection, remplacement, note modifiée et dictionnaire personnel vérifiés hors ligne");
}
