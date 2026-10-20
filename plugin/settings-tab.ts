import { App, ColorComponent, DropdownComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionRender } from "obsidian";
import { loadingMessage } from "./ui/loading-message";
import type { ResourcePack } from "./linguistic-files";
import { resourceEngines, resourceLabels } from "./linguistic-files";
import { finitionSynonymMetadata, isSynonymDocumentation, synonymDocumentation, synonymFileLimit, type SynonymMetadata } from "./synonyms";
import type FinitionPlugin from "./main";
import { neuralDocumentation, neuralFileLimit } from "./neural-models";
import { DEFAULT_PALETTE, DEFAULT_SETTINGS, parseGrammalecteDictionary, parseStopWords } from "./types";
import { dictionaryDocumentation, dictionaryLabels, publicDictionaryMetadata, type DictionaryKind } from "./dictionaries";
import { lexiconDocumentation, publicLexiconMetadata } from "./lexicon/dictionaries";

type ColorFunctionKey = "hedgingColorIndex" | "stereotypeColorIndex" | "hingeColorIndex" | "grammalecteColorIndex";

const COLOR_FUNCTIONS: Array<{ key: ColorFunctionKey; label: string }> = [
	{ key: "hedgingColorIndex", label: "Atténuations" },
	{ key: "stereotypeColorIndex", label: "Stéréotypes" },
	{ key: "hingeColorIndex", label: "Charnières" },
	{ key: "grammalecteColorIndex", label: "Orthographe" },
];
// Tricolons n'a plus de couleur unique réglable ici : chaque tricolon
// détecté prend désormais une couleur différente de la palette (tournante,
// comme Cadence et Répétitions), pour rester visuellement distinct d'un
// autre tricolon voisin — une seule couleur fixe les aurait tous confondus
// en un même bloc.

export class FinitionSettingTab extends PluginSettingTab {
	plugin: FinitionPlugin;

	// Les brouillons survivent aux reconstructions de l’interface ; null recharge le prompt actif.
	private pendingPromptName: string | null = null;
	private pendingPromptModel: string | null = null;
	private promptModelCustom = false;
	private downloadingEngine: ResourcePack | null = null;
	private changingSynonyms = false;
	private synonymError = "";
	private pendingSynonymPath = "";
	private changingModels = false;
	private modelError = "";
	private pendingModelPath = "";
	private pendingLexiconPath = "";
	private lexiconError = "";
	private openSections = new Set<string>();
	private changingDictionary = false;
	private dictionaryErrors: Partial<Record<DictionaryKind, string>> = {};
	private pendingDictionaryPaths: Partial<Record<DictionaryKind, string>> = {};

	constructor(app: App, plugin: FinitionPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private describeResource(setting: Setting, metadata: SynonymMetadata): void {
		if (isSynonymDocumentation(metadata.documentation)) {
			setting.descEl.createEl("a", { text: metadata.description || "Documentation", href: metadata.documentation, attr: { target: "_blank", rel: "noopener noreferrer" } });
		} else setting.setDesc(metadata.description ?? "");
	}
	private section(parent: HTMLElement, title: string): HTMLElement {
		const details = parent.createEl("details", { cls: "finition-settings-section", attr: { "data-section": title } });
		details.open = this.openSections.has(title);
		details.createEl("summary", { cls: "setting-item-heading" }).createSpan({ cls: "setting-item-name", text: title });
		details.addEventListener("toggle", () => {
			if (details.isConnected) {
				if (details.open) this.openSections.add(title);
				else this.openSections.delete(title);
			}
		});
		return details.createDiv({ cls: "finition-settings-section-body" });
	}

	private displaySynonyms(containerEl: HTMLElement): void {
		containerEl = this.section(containerEl, "Synonymes");
		const options = this.plugin.synonymDictionaryOptions;
		const busy = this.changingSynonyms || this.changingModels || this.changingDictionary || this.downloadingEngine !== null;
		const update = async (action: () => Promise<void>) => {
			if (this.changingSynonyms || this.changingModels || this.changingDictionary || this.downloadingEngine !== null) return;
			this.changingSynonyms = true;
			this.synonymError = "";
			this.update();
			try { await action(); }
			catch (error) { this.synonymError = error instanceof Error ? error.message : String(error); }
			finally { this.changingSynonyms = false; this.update(); }
		};
		new Setting(containerEl).setName("Dictionnaire")
			.setDesc(this.synonymError || (options.length ? "" : "Aucun dictionnaire installé."))
			.addDropdown(dropdown => {
				for (const option of options) dropdown.addOption(option.id, option.name);
				dropdown.setValue(this.plugin.settings.synonymDictionaryPath).setDisabled(busy || !options.length)
					.onChange(id => update(() => this.plugin.setSynonymDictionary(id)));
			});
		const finition = new Setting(containerEl).setName("Finition")
			.addButton(button => button.setButtonText(this.plugin.isLinguisticEngineInstalled("synonymes") ? "Recharger" : "Charger").setDisabled(busy)
				.onClick(() => update(async () => {
					const notice = new Notice(loadingMessage("Téléchargement des synonymes…"), 0);
					try { await this.plugin.downloadLinguisticResources("synonymes", text => notice.setMessage(loadingMessage(text))); }
					finally { notice.hide(); }
				})));
		this.describeResource(finition, finitionSynonymMetadata);
		for (const option of options.filter(option => option.id)) {
			const setting = new Setting(containerEl).setName(option.name)
				.addButton(button => button.setButtonText("Effacer").setDestructive().setDisabled(busy)
					.onClick(() => {
						if (containerEl.ownerDocument.defaultView?.confirm(`Effacer le dictionnaire « ${option.name} » du plugin ?`)) return update(() => this.plugin.removeSynonymDictionary(option.id));
					}));
			this.describeResource(setting, option);
		}
		const browseDictionary = () => this.openFilePicker(false, files => {
			const file = files[0];
			if (!file) return;
			void update(async () => {
				if (file.size > synonymFileLimit) throw new Error("Choisis un dictionnaire JSON de 128 Mio maximum.");
				await this.plugin.importSynonymDictionary(await file.arrayBuffer());
			});
		});
		const loader = new Setting(containerEl).setName("Charger un dictionnaire")
			.setClass("finition-import-setting")
			.addText(text => {
				text.setValue(this.pendingSynonymPath).setPlaceholder("Chemin du fichier JSON").setDisabled(busy)
					.onChange(value => { this.pendingSynonymPath = value; });
				text.inputEl.setAttribute("aria-label", "Chemin du dictionnaire JSON");
			})
			.addButton(button => button.setButtonText("Charger").setDisabled(busy).onClick(() => {
				if (this.pendingSynonymPath.trim()) return update(async () => {
					await this.plugin.setSynonymDictionaryPath(this.pendingSynonymPath);
					this.pendingSynonymPath = "";
				});
				browseDictionary();
			}))
			.addButton(button => button.setButtonText("Parcourir…").setDisabled(busy).onClick(browseDictionary));
		loader.descEl.createEl("a", { text: "JSON au format Finition", href: synonymDocumentation, attr: { target: "_blank", rel: "noopener noreferrer" } });
		loader.settingEl.appendChild(loader.descEl);
	}
	private openFilePicker(directory: boolean, onChange: (files: File[]) => void): void {
		const input = this.containerEl.createEl("input", {
			attr: { type: "file", hidden: "", ...(directory ? { webkitdirectory: "", multiple: "" } : { accept: ".json,application/json" }) }
		});
		input.addEventListener("cancel", () => input.remove(), { once: true });
		input.addEventListener("change", () => {
			const files = Array.from(input.files ?? []);
			input.remove();
			if (files.length) onChange(files);
		}, { once: true });
		try { input.showPicker(); }
		catch (error) {
			input.remove();
			new Notice(`Impossible d’ouvrir le sélecteur : ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	private displayWordDictionary(parent: HTMLElement, kind: DictionaryKind): void {
		const container = this.section(parent, dictionaryLabels[kind]);
		const store = this.plugin.wordDictionaries;
		const options = store?.options.filter(entry => entry.kind === kind) ?? [];
		const busy = this.changingDictionary || this.changingModels || this.changingSynonyms || this.downloadingEngine !== null;
		const update = async (action: () => Promise<void>) => {
			if (this.changingDictionary || this.changingModels || this.changingSynonyms || this.downloadingEngine !== null) return;
			this.changingDictionary = true;
			this.dictionaryErrors[kind] = "";
			this.update();
			try { await action(); }
			catch (error) { this.dictionaryErrors[kind] = error instanceof Error ? error.message : String(error); }
			finally { this.changingDictionary = false; this.update(); }
		};
		new Setting(container).setName("Dictionnaire")
			.setDesc(this.dictionaryErrors[kind] || (options.length ? "" : "Aucun dictionnaire installé."))
			.addDropdown(dropdown => {
				for (const option of options) dropdown.addOption(option.path, option.name);
				dropdown.setValue(this.plugin.settings.wordDictionaryPaths?.[kind] ?? "").setDisabled(busy || !options.length)
					.onChange(path => update(async () => { await store?.select(kind, path); }));
			});
		const finition = new Setting(container).setName("Finition")
			.addButton(button => button.setButtonText(this.plugin.isLinguisticEngineInstalled(kind) ? "Recharger" : "Charger").setDisabled(busy)
				.onClick(() => update(async () => {
					const notice = new Notice(loadingMessage("Téléchargement du dictionnaire…"), 0);
					try { await this.plugin.downloadLinguisticResources(kind, text => notice.setMessage(loadingMessage(text))); }
					finally { notice.hide(); }
				})));
		this.describeResource(finition, publicDictionaryMetadata);
		for (const option of options.filter(option => option.path)) {
			const row = new Setting(container).setName(option.name)
				.addButton(button => button.setButtonText("Effacer").setDestructive().setDisabled(busy).onClick(() => {
					if (container.ownerDocument.defaultView?.confirm(`Effacer le dictionnaire « ${option.name} » du plugin ?`)) return update(async () => { await store?.remove(kind, option.path); });
				}));
			this.describeResource(row, option);
		}
		const browseDictionary = () => this.openFilePicker(false, files => {
			const file = files[0];
			if (!file) return;
			void update(async () => {
				if (file.size > synonymFileLimit) throw new Error("Choisis un dictionnaire JSON de 128 Mio maximum.");
				await store!.import(kind, await file.arrayBuffer());
			});
		});
		const loader = new Setting(container).setName("Charger un dictionnaire")
			.setClass("finition-import-setting")
			.addText(text => {
				text.setValue(this.pendingDictionaryPaths[kind] ?? "").setPlaceholder("Chemin du fichier JSON").setDisabled(busy)
					.onChange(value => { this.pendingDictionaryPaths[kind] = value; });
				text.inputEl.setAttribute("aria-label", `Chemin du dictionnaire ${dictionaryLabels[kind]}`);
			})
			.addButton(button => button.setButtonText("Charger").setDisabled(busy || !store).onClick(() => {
				const path = this.pendingDictionaryPaths[kind]?.trim();
				if (path) return update(async () => {
					await this.plugin.setWordDictionaryPath(kind, path);
					this.pendingDictionaryPaths[kind] = "";
				});
				browseDictionary();
			}))
			.addButton(button => button.setButtonText("Parcourir…").setDisabled(busy || !store).onClick(browseDictionary));
		loader.descEl.createEl("a", { text: "JSON au format Finition", href: dictionaryDocumentation, attr: { target: "_blank", rel: "noopener noreferrer" } });
		loader.settingEl.appendChild(loader.descEl);
	}

	private displayLexicons(container: HTMLElement, busy: boolean): void {
		const store = this.plugin.lexiconDictionaries;
		const options = store?.options ?? [];
		const update = async (action: () => Promise<void>) => {
			if (this.changingModels || this.changingSynonyms || this.changingDictionary || this.downloadingEngine !== null) return;
			this.changingModels = true;
			this.lexiconError = "";
			this.update();
			try { await action(); }
			catch (error) { this.lexiconError = error instanceof Error ? error.message : String(error); }
			finally { this.changingModels = false; this.update(); }
		};
		new Setting(container).setName("Lexique")
			.setDesc(this.lexiconError || (!options.length ? "Aucun lexique installé." : !store?.available ? "Lexique sélectionné absent." : ""))
			.addDropdown(dropdown => {
				for (const option of options) dropdown.addOption(option.path, option.name);
				dropdown.setValue(this.plugin.settings.lexiconDictionaryPath).setDisabled(busy || !options.length)
					.onChange(path => update(() => this.plugin.setLexicon(path)));
			});
		const installed = options.some(option => option.path === "");
		const finition = new Setting(container).setName("Dictionnaire Finition")
			.addButton(button => button.setButtonText(installed ? "Recharger" : "Charger").setDisabled(busy).onClick(() => update(async () => {
				const notice = new Notice(loadingMessage("Téléchargement du lexique…"), 0);
				try { await this.plugin.downloadLinguisticResources("lexique", text => notice.setMessage(loadingMessage(text))); }
				finally { notice.hide(); }
			})));
		this.describeResource(finition, publicLexiconMetadata);
		for (const option of options.filter(option => option.path)) {
			const row = new Setting(container).setName(option.name)
				.addButton(button => button.setButtonText("Effacer").setDestructive().setDisabled(busy).onClick(() => {
					if (container.ownerDocument.defaultView?.confirm(`Effacer le lexique « ${option.name} » du plugin ?`)) return update(() => this.plugin.removeLexicon(option.path));
				}));
			this.describeResource(row, option);
		}
		const browse = () => this.openFilePicker(false, files => {
			const file = files[0];
			if (!file) return;
			void update(async () => {
				if (file.size > synonymFileLimit) throw new Error("Choisis un lexique JSON de 128 Mio maximum.");
				await this.plugin.importLexicon(await file.arrayBuffer());
			});
		});
		const loader = new Setting(container).setName("Charger un lexique").setClass("finition-import-setting")
			.addText(text => {
				text.setValue(this.pendingLexiconPath).setPlaceholder("Chemin du fichier JSON").setDisabled(busy)
					.onChange(value => { this.pendingLexiconPath = value; });
				text.inputEl.setAttribute("aria-label", "Chemin du lexique JSON");
			})
			.addButton(button => button.setButtonText("Charger").setDisabled(busy).onClick(() => {
				if (!this.pendingLexiconPath.trim()) return browse();
				return update(async () => { await this.plugin.setLexiconPath(this.pendingLexiconPath); this.pendingLexiconPath = ""; });
			}))
			.addButton(button => button.setButtonText("Parcourir…").setDisabled(busy).onClick(browse));
		loader.descEl.createEl("a", { text: "Lexique au format Finition", href: lexiconDocumentation, attr: { target: "_blank", rel: "noopener noreferrer" } });
		loader.settingEl.appendChild(loader.descEl);
	}
	private displayCorrections(containerEl: HTMLElement): void {
		containerEl = this.section(containerEl, "Corrections");
		const installed = resourceEngines.filter(engine => this.plugin.isLinguisticEngineInstalled(engine));
		const models = this.plugin.neuralModelOptions;
		const busy = this.changingModels || this.changingSynonyms || this.changingDictionary || this.downloadingEngine !== null;
		const update = async (action: () => Promise<void>) => {
			if (this.changingModels || this.changingSynonyms || this.changingDictionary || this.downloadingEngine !== null) return;
			this.changingModels = true;
			this.modelError = "";
			this.update();
			try { await action(); }
			catch (error) { this.modelError = error instanceof Error ? error.message : String(error); }
			finally { this.changingModels = false; this.update(); }
		};
		this.displayLexicons(containerEl, busy);
		for (const engine of resourceEngines) {
			const installed = this.plugin.isLinguisticEngineInstalled(engine);
			const setting = new Setting(containerEl).setName(engine === "finition-corrector" ? "CamemBERT" : resourceLabels[engine]);
			if (engine === "grammalecte") setting.addDropdown(dropdown => {
				if (installed) dropdown.addOption("fr-classic", "Classique").addOption("fr-reform", "Réforme 1990");
				dropdown.setValue(this.plugin.settings.grammalecteDictionary).setDisabled(!installed || busy)
					.onChange(value => update(async () => {
						if (value !== "fr-classic" && value !== "fr-reform") return;
						this.plugin.settings.grammalecteDictionary = value;
						await this.plugin.setSpellingEngine("grammalecte");
					}));
			});
			this.describeResource(setting, { name: engine, documentation: engine === "grammalecte" ? "https://grammalecte.net/" : "https://huggingface.co/almanach/camembertv2-base" });
			setting.addButton(button => button.setButtonText(this.downloadingEngine === engine ? "Téléchargement…" : installed ? "Recharger" : "Charger")
					.setDisabled(busy).onClick(async () => {
						this.downloadingEngine = engine;
						this.update();
						const notice = new Notice(loadingMessage("Téléchargement des ressources…"), 0);
						try {
							await this.plugin.downloadLinguisticResources(engine, text => notice.setMessage(loadingMessage(text)));
							new Notice("Ressources installées. Utilisation hors ligne disponible.");
						} catch (error) {
							new Notice(error instanceof Error ? error.message : String(error), 10000);
						} finally {
							notice.hide();
							this.downloadingEngine = null;
							this.update();
						}
					}));
		}

		for (const model of models) {
			const row = new Setting(containerEl).setName(model.name)
				.addButton(button => button.setButtonText("Effacer").setDestructive().setDisabled(busy).onClick(() => {
					if (containerEl.ownerDocument.defaultView?.confirm(`Effacer le modèle « ${model.name} » du plugin ?`)) return update(() => this.plugin.removeNeuralModel(model.id));
				}));
			this.describeResource(row, model);
		}
		const browseModel = () => this.openFilePicker(true, selected => {
			const files = new Map(selected.map(file => [file.webkitRelativePath.split("/").slice(1).join("/"), file]));
			void update(() => this.plugin.importNeuralModel(async path => {
				const file = files.get(path);
				if (!file || file.size > (path === "pack.json" ? 16384 : neuralFileLimit)) throw new Error("Fichier du modèle absent ou trop volumineux.");
				return file.arrayBuffer();
			}));
		});
		const loader = new Setting(containerEl).setName("Charger un modèle neuronal")
			.setClass("finition-import-setting")
			.addText(text => {
				text.setValue(this.pendingModelPath).setPlaceholder("Chemin du dossier ou de pack.json").setDisabled(busy)
					.onChange(value => { this.pendingModelPath = value; });
				text.inputEl.setAttribute("aria-label", "Chemin du modèle neuronal");
			})
			.addButton(button => button.setButtonText("Charger").setDisabled(busy).onClick(() => {
				if (this.pendingModelPath.trim()) return update(async () => {
					await this.plugin.setNeuralModelPath(this.pendingModelPath);
					this.pendingModelPath = "";
				});
				browseModel();
			}))
			.addButton(button => button.setButtonText("Parcourir…").setDisabled(busy).onClick(browseModel));
		loader.descEl.createEl("a", { text: "Modèle au format Finition", href: neuralDocumentation, attr: { target: "_blank", rel: "noopener noreferrer" } });
		loader.descEl.createSpan({ text: " · Dossiers cachés sur macOS : ⌘⇧." });
		loader.settingEl.appendChild(loader.descEl);

		new Setting(containerEl).setName("Correcteur neuronal par défaut")
			.setDesc(this.modelError || (installed.includes("finition-corrector") ? "" : "Aucun correcteur neuronal installé."))
			.addDropdown(dropdown => {
				if (installed.includes("finition-corrector")) {
					dropdown.addOption("finition-corrector", "CamemBERT");
					for (const model of models) dropdown.addOption(model.id, model.name);
				}
				const selected = this.plugin.settings.neuralModel;
				const model = selected === "auto" ? models[0]?.id : selected;
				dropdown.setValue(model || "finition-corrector").setDisabled(!installed.includes("finition-corrector") || busy)
					.onChange(value => update(async () => {
						if (value !== "finition-corrector" && !models.some(model => model.id === value)) return;
						await this.plugin.setNeuralModel(value === "finition-corrector" ? "" : value);
						this.plugin.settings.spellingNeural = true;
						await this.plugin.setSpellingEngine("finition-corrector");
					}));
			});

		new Setting(containerEl).setName("Moteur d’analyse")
			.setDesc("Pour la structure, les tricolons et la cadence syntaxique.")
			.addDropdown(dropdown => {
				for (const engine of installed) dropdown.addOption(engine, resourceLabels[engine]);
				dropdown.setValue(this.plugin.settings.analysisEngine).setDisabled(busy || !installed.length)
					.onChange(value => update(async () => {
						if (value !== "grammalecte" && value !== "finition-corrector") return;
						await this.plugin.setAnalysisEngine(value);
					}));
			});


		new Setting(containerEl)
			.setName("Dictionnaire personnel")
			.setDesc(
				"Mots à accepter, séparés par des espaces ou des virgules. La liste se complète aussi lorsqu’un mot est ajouté depuis une correction."
			)
			.setClass("finition-stopwords-setting")
			.addTextArea((textArea) => {
				textArea.inputEl.rows = 5;
				textArea.inputEl.addClass("finition-stop-words-textarea");
				textArea.setValue(this.plugin.settings.grammalecteCustomDictionary);
				textArea.onChange(async (value) => {
					this.plugin.settings.grammalecteCustomDictionary = value;
					await this.plugin.saveSettings();
					// Retire immédiatement les surlignages déjà affichés pour les
					// mots qu'on vient d'ajouter à la main (sans attendre un
					// nouveau lancement de Grammalecte) — même filtrage que
					// addWordToGrammalecteDictionary(), juste sans y ajouter de
					// mot supplémentaire.
					const dictionary = parseGrammalecteDictionary(value);
					this.plugin.grammalecteErrors = this.plugin.grammalecteErrors.filter(
						(err) => !(err.sType === "orthographe" && err.sValue && dictionary.has(err.sValue.toLowerCase()))
					);
					this.plugin.grammalecteErrorsVersion++;
					this.plugin.refreshAllEditors();
					// Pas de this.update() ici, même raison que "Longueur
					// minimale d'un mot" plus haut : onChange se déclenche à
					// chaque frappe, un update() ferait perdre le focus.
				});
			});
	}

	private displayAICorrections(containerEl: HTMLElement): void {
		containerEl = this.section(containerEl, "Corrections IA");

		const apiKeyDesc = createFragment();
		apiKeyDesc.appendChild(
			document.createTextNode(
				"Pour utiliser Claude avec Corrections IA et Synonymes IA. Stockée en clair dans data.json. Inutile avec un serveur local. "
			)
		);
		const apiKeyLink = createEl("a");
		apiKeyLink.textContent = "Comment obtenir une clé API";
		apiKeyLink.href = "https://platform.claude.com/docs/en/get-api-key";
		apiKeyLink.target = "_blank";
		apiKeyLink.rel = "noopener";
		apiKeyDesc.appendChild(apiKeyLink);

		new Setting(containerEl)
			.setName("Clé API Anthropic")
			.setDesc(apiKeyDesc)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("Clé secrète Anthropic")
					.setValue(this.plugin.settings.aiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.aiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		const openaiKeyDesc = createFragment();
		openaiKeyDesc.appendChild(
			document.createTextNode("Utilisée à la place de la clé Anthropic quand le modèle choisi ci-dessous est un modèle GPT. ")
		);
		const openaiKeyLink = createEl("a");
		openaiKeyLink.textContent = "Créer une clé API OpenAI";
		openaiKeyLink.href = "https://platform.openai.com/api-keys";
		openaiKeyLink.target = "_blank";
		openaiKeyLink.rel = "noopener";
		openaiKeyDesc.appendChild(openaiKeyLink);

		new Setting(containerEl)
			.setName("Clé API OpenAI")
			.setDesc(openaiKeyDesc)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("Clé secrète OpenAI")
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Serveur local")
			.setDesc("Ollama ou serveur compatible OpenAI, par exemple http://localhost:11434. Active les corrections et synonymes IA locaux, sans clé API ni repli vers le cloud. Vider pour utiliser Claude/GPT.")
			.addText(text => text.setPlaceholder("Adresse du serveur").setValue(this.plugin.settings.localAIServer).onChange(async value => {
				this.plugin.settings.localAIServer = value.trim();
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
			.setName("Modèle local")
			.setDesc("Identifiant exact du modèle servi localement. Obligatoire quand le serveur local est renseigné. Aucun modèle n’est téléchargé par Finition.")
			.addText(text => text.setPlaceholder("Identifiant du modèle local").setValue(this.plugin.settings.localAIModel).onChange(async value => {
				this.plugin.settings.localAIModel = value.trim();
				await this.plugin.saveSettings();
			}));

		const modelDesc = createFragment();
		modelDesc.appendChild(
			document.createTextNode(
				"Modèle Claude ou GPT utilisé lorsque Serveur local est vide. Le nom choisi détermine quelle clé API est utilisée. "
			)
		);
		const modelLink = createEl("a");
		modelLink.textContent = "Modèles Claude";
		modelLink.href = "https://platform.claude.com/docs/en/models/overview";
		modelLink.target = "_blank";
		modelLink.rel = "noopener";
		modelDesc.appendChild(modelLink);
		modelDesc.appendChild(document.createTextNode(" · "));
		const openaiModelLink = createEl("a");
		openaiModelLink.textContent = "Modèles OpenAI";
		openaiModelLink.href = "https://developers.openai.com/api/docs/models";
		openaiModelLink.target = "_blank";
		openaiModelLink.rel = "noopener";
		modelDesc.appendChild(openaiModelLink);

		const AI_MODEL_PRESETS: Array<{ value: string; label: string }> = [
			{ value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
			{ value: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
			{ value: "gpt-6-luna", label: "GPT-6 Luna" },
			{ value: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
		];
		const CUSTOM_MODEL_VALUE = "__custom__";
		const isPreset = AI_MODEL_PRESETS.some((p) => p.value === this.plugin.settings.aiModel);

		new Setting(containerEl)
			.setName("Modèle par défaut")
			.setDesc(modelDesc)
			.addDropdown((dropdown) => {
				for (const preset of AI_MODEL_PRESETS) {
					dropdown.addOption(preset.value, preset.label);
				}
				dropdown.addOption(CUSTOM_MODEL_VALUE, "Autre (saisir un identifiant)…");
				dropdown
					.setValue(isPreset ? this.plugin.settings.aiModel : CUSTOM_MODEL_VALUE)
					.onChange(async (value) => {
						if (value !== CUSTOM_MODEL_VALUE) {
							this.plugin.settings.aiModel = value;
							await this.plugin.saveSettings();
						}
						this.update(); // affiche/masque le champ de saisie libre
					});
			});

		if (!isPreset) {
			new Setting(containerEl)
				.setName("Identifiant du modèle personnalisé")
				.setDesc("Identifiant exact fourni dans la documentation du fournisseur.")
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_SETTINGS.aiModel)
						.setValue(this.plugin.settings.aiModel)
						.onChange(async (value) => {
							this.plugin.settings.aiModel = value.trim() || DEFAULT_SETTINGS.aiModel;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Taille des tronçons (caractères)")
			.setDesc("Le texte sélectionné est découpé par paragraphe entier (jamais coupé au milieu) en tronçons d'environ cette taille avant d'être envoyé à l'IA.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "500";
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.aiChunkSize))
					.setValue(String(this.plugin.settings.aiChunkSize))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.aiChunkSize = parsed;
							await this.plugin.saveSettings();
						}
					});
			});

		const UNSAVED_VALUE = "__unsaved__";
		// "Corrections" et "Révision stylistique" sont fournis d'origine dans
		// settings.savedPrompts (voir DEFAULT_SETTINGS dans types.ts) : la
		// bibliothèque n'est donc normalement jamais vide. Le cas "non
		// enregistré" ci-dessous ne sert qu'à représenter un prompt modifié
		// depuis sa dernière sauvegarde (ou si l'utilisateur a supprimé toute
		// la bibliothèque), sans jamais écraser silencieusement son contenu.
		const activeMatchesSaved =
			this.plugin.settings.activePromptName !== null &&
			this.plugin.settings.savedPrompts.some((p) => p.name === this.plugin.settings.activePromptName);

		new Setting(containerEl)
			.setName("Prompt enregistré")
			.setDesc("Choisis un prompt de la bibliothèque pour le charger dans la zone de texte ci-dessous.")
			.addDropdown((dropdown) => {
				if (!activeMatchesSaved) {
					dropdown.addOption(UNSAVED_VALUE, "Non enregistré");
				}
				for (const saved of this.plugin.settings.savedPrompts) {
					dropdown.addOption(saved.name, saved.name);
				}
				dropdown
					.setValue(activeMatchesSaved ? (this.plugin.settings.activePromptName as string) : UNSAVED_VALUE)
					.onChange(async (value) => {
						if (value === UNSAVED_VALUE) return; // option de simple affichage, rien à charger
						const saved = this.plugin.settings.savedPrompts.find((p) => p.name === value);
						if (saved) {
							this.plugin.settings.aiPrompt = saved.prompt;
							this.plugin.settings.activePromptName = saved.name;
							// Pas de modèle dédié (chaîne vide) : on laisse le
							// modèle par défaut actuellement réglé tel quel.
							if (saved.model) {
								this.plugin.settings.aiModel = saved.model;
							}
							// On vient de charger un prompt existant : on efface
							// toute saisie en cours dans "Enregistrer sous ce
							// nom" / "Modèle pour ce prompt", pour qu'ils
							// repartent de CE prompt plutôt que de garder une
							// saisie relative au prompt précédent.
							this.pendingPromptName = null;
							this.pendingPromptModel = null;
							this.promptModelCustom = false;
						}
						await this.plugin.saveSettings();
						this.update();
					});
			});

		new Setting(containerEl)
			.setName("Prompt de révision")
			.setDesc(
				"Instructions envoyées à l’IA pour chaque tronçon. Modifier ce champ change le prompt actif ; enregistrer pour mettre à jour la bibliothèque."
			)
			.setClass("finition-stopwords-setting")
			.addTextArea((textArea) => {
				textArea.inputEl.rows = 14;
				textArea.inputEl.addClass("finition-stop-words-textarea");
				textArea.setValue(this.plugin.settings.aiPrompt);
				textArea.onChange(async (value) => {
					this.plugin.settings.aiPrompt = value;
					// Le contenu diverge potentiellement du prompt nommé d'origine :
					// on délie le nom actif (il réapparaîtra à la prochaine ouverture
					// des réglages comme "(non enregistré)" tant qu'il n'est pas
					// ré-enregistré ou qu'un autre prompt n'est rechargé).
					// Pas de this.update() ici, pour la même raison que le champ
					// "Longueur minimale d'un mot" plus haut : ça ferait perdre le
					// focus à chaque frappe.
					this.plugin.settings.activePromptName = null;
					await this.plugin.saveSettings();
				});
			});

		// activeSavedEntry sert de valeur de repli tant que l'utilisateur n'a
		// pas encore touché aux champs "Enregistrer sous ce nom" / "Modèle
		// pour ce prompt" dans CETTE session de réglages (pendingPromptName /
		// pendingPromptModel valent alors encore null).
		const activeSavedEntry = activeMatchesSaved
			? this.plugin.settings.savedPrompts.find((p) => p.name === this.plugin.settings.activePromptName)
			: undefined;
		if (this.pendingPromptName === null) {
			this.pendingPromptName = this.plugin.settings.activePromptName ?? "";
		}
		if (this.pendingPromptModel === null) {
			this.pendingPromptModel = activeSavedEntry?.model ?? "";
		}
		const setPromptModel = async (value: string) => {
			this.pendingPromptModel = value;
			const settings = this.plugin.settings;
			const saved = settings.savedPrompts.find(prompt => prompt.name === settings.activePromptName && prompt.prompt === settings.aiPrompt && prompt.name === this.pendingPromptName?.trim());
			if (saved) saved.model = value;
			if (value) settings.aiModel = value;
			await this.plugin.saveSettings();
		};
		const PROMPT_MODEL_DEFAULT_VALUE = "__model_default__";
		const PROMPT_MODEL_CUSTOM_VALUE = "__model_custom__";
		const promptModelIsPreset =
			this.pendingPromptModel === "" || AI_MODEL_PRESETS.some((p) => p.value === this.pendingPromptModel);

		new Setting(containerEl)
			.setName("Modèle pour ce prompt")
			.setDesc(
				"Modèle utilisé avec ce prompt. Sans modèle dédié, le modèle configuré plus haut est utilisé."
			)
			.addDropdown((dropdown) => {
				dropdown.addOption(PROMPT_MODEL_DEFAULT_VALUE, "Modèle par défaut");
				for (const preset of AI_MODEL_PRESETS) {
					dropdown.addOption(preset.value, preset.label);
				}
				dropdown.addOption(PROMPT_MODEL_CUSTOM_VALUE, "Autre (saisir un identifiant)…");
				dropdown
					.setValue(
						this.promptModelCustom
							? PROMPT_MODEL_CUSTOM_VALUE
							: this.pendingPromptModel === ""
							? PROMPT_MODEL_DEFAULT_VALUE
							: promptModelIsPreset
							? (this.pendingPromptModel as string)
							: PROMPT_MODEL_CUSTOM_VALUE
					)
					.onChange(async (value) => {
						this.promptModelCustom = value === PROMPT_MODEL_CUSTOM_VALUE;
						if (this.promptModelCustom) {
							this.pendingPromptModel = promptModelIsPreset ? "" : this.pendingPromptModel;
						} else {
							await setPromptModel(value === PROMPT_MODEL_DEFAULT_VALUE ? "" : value);
						}
						this.update(); // affiche/masque le champ de saisie libre, comme pour le modèle global
					});
			});

		const promptModelShowCustomField =
			this.promptModelCustom || (this.pendingPromptModel !== "" && !AI_MODEL_PRESETS.some((p) => p.value === this.pendingPromptModel));

		if (promptModelShowCustomField) {
			new Setting(containerEl)
				.setName("Identifiant du modèle pour ce prompt")
				.addText((text) =>
					text
						.setPlaceholder("Identifiant du modèle")
						.setValue(this.pendingPromptModel as string)
						.onChange(value => setPromptModel(value.trim()))
				);
		}

		new Setting(containerEl)
			.setName("Enregistrer sous ce nom")
			.setDesc("Sauvegarde le texte et le modèle du prompt ci-dessus dans la bibliothèque, sous ce nom (écrase le prompt existant s'il porte déjà ce nom).")
			.addText((text) => {
				text.setPlaceholder("Littéraire, sobre, journalistique…").setValue(this.pendingPromptName as string);
				text.onChange((value) => {
					this.pendingPromptName = value;
				});
			})
			.addButton((button) =>
				button
					.setButtonText("Enregistrer")
					.setCta()
					.onClick(async () => {
						const name = (this.pendingPromptName ?? "").trim();
						if (!name) return;
						const existingIndex = this.plugin.settings.savedPrompts.findIndex((p) => p.name === name);
						const wasBuiltin = existingIndex >= 0 && this.plugin.settings.savedPrompts[existingIndex].builtin;
						const entry = {
							name,
							prompt: this.plugin.settings.aiPrompt,
							model: this.pendingPromptModel ?? "",
							// Écraser le contenu d'un prompt système (même nom)
							// ne le rend pas supprimable pour autant ; un prompt
							// réellement nouveau, lui, est toujours supprimable.
							builtin: wasBuiltin,
						};
						if (existingIndex >= 0) {
							this.plugin.settings.savedPrompts[existingIndex] = entry;
						} else {
							this.plugin.settings.savedPrompts.push(entry);
						}
						this.plugin.settings.activePromptName = name;
						this.pendingPromptName = null;
						this.pendingPromptModel = null;
						this.promptModelCustom = false;
						await this.plugin.saveSettings();
						this.update();
					})
			);

		// Recharge le prompt système par défaut (premier de BUILTIN_PROMPTS,
		// "Corrections") s'il existe encore dans la bibliothèque, sinon
		// retombe sur son contenu d'usine sans nom associé — jamais une
		// bibliothèque laissée vide par erreur.
		const resetToFactoryDefault = () => {
			const factory = this.plugin.settings.savedPrompts.find((p) => p.name === DEFAULT_SETTINGS.activePromptName);
			this.plugin.settings.aiPrompt = factory ? factory.prompt : DEFAULT_SETTINGS.aiPrompt;
			this.plugin.settings.activePromptName = factory ? factory.name : null;
			this.pendingPromptName = null;
			this.pendingPromptModel = null;
			this.promptModelCustom = false;
		};

		// Un prompt système (builtin) n'est jamais supprimable depuis les
		// réglages — seuls les prompts créés par l'utilisateur le sont.
		if (activeMatchesSaved && activeSavedEntry && !activeSavedEntry.builtin) {
			new Setting(containerEl).addButton((button) =>
				button
					.setButtonText(`Supprimer « ${this.plugin.settings.activePromptName} »`)
					.setDestructive()
					.onClick(async () => {
						const name = this.plugin.settings.activePromptName;
						this.plugin.settings.savedPrompts = this.plugin.settings.savedPrompts.filter((p) => p.name !== name);
						resetToFactoryDefault();
						await this.plugin.saveSettings();
						this.update();
					})
			);
		}

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText("Réinitialiser le prompt")
				.setTooltip("Restaurer le prompt d’origine sans modifier la bibliothèque")
				.onClick(async () => {
					resetToFactoryDefault();
					await this.plugin.saveSettings();
					this.update();
				})
		);
	}

	private generalDefinitions(): SettingDefinitionRender[] {
		return [
			{
				name: "Compteur du document",
				desc: "À gauche de ♫. Signes : espaces compris.",
				render: setting => {
					setting.addDropdown(dropdown => dropdown
						.addOption("none", "Masqué")
						.addOption("words", "Mots")
						.addOption("characters", "Signes")
						.addOption("both", "Mots et signes")
						.setValue(this.plugin.settings.documentCountDisplay)
						.onChange(async value => {
							if (value !== "none" && value !== "words" && value !== "characters" && value !== "both") return;
							this.plugin.settings.documentCountDisplay = value;
							await this.plugin.saveSettings();
							this.plugin.updateDocumentCounts();
						}));
				},
			},
			{
				name: "Masquer le compteur de backlinks",
				desc: "Dans la barre d’état uniquement.",
				render: setting => {
					setting.addToggle(toggle => toggle.setValue(this.plugin.settings.hideBacklinksCount).onChange(async value => {
						this.plugin.settings.hideBacklinksCount = value;
						await this.plugin.saveSettings();
					}));
				},
			},
			{
				name: "Taille maximale de document analysé",
				desc: "Nombre maximal de caractères analysés depuis le début. Le reste de la note reste sans surlignage.",
				render: setting => {
					setting.addText(text => text.setValue(String(this.plugin.settings.maxDocumentLength)).onChange(async value => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.maxDocumentLength = parsed;
							await this.plugin.saveSettings();
							this.plugin.refreshAllEditors();
						}
					}));
				},
			},
			{
				name: "Mode debug",
				desc: "Afficher Structure dans le menu et la palette de commandes.",
				render: setting => {
					setting.addToggle(toggle => toggle.setValue(this.plugin.settings.debugMode).onChange(async value => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}));
				},
			},
		];
	}

	private displayRepetitions(containerEl: HTMLElement): void {
		containerEl = this.section(containerEl, "Répétitions");
		new Setting(containerEl)
			.setName("Empan de répétition (caractères)")
			.setDesc("Deux occurrences du même lemme séparées de moins de cette distance sont considérées comme une répétition.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.span))
					.setValue(String(this.plugin.settings.span))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.span = parsed;
							await this.plugin.saveSettings();
							this.plugin.refreshAllEditors();
						}
					});
			});

		new Setting(containerEl)
			.setName("Longueur minimale d'un mot (caractères)")
			.setDesc("Un mot de cette longueur ou moins n'est jamais compté comme répétition, même s'il revient souvent (ex. \"et\", \"ou\", \"si\").")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.repetitionMinLength))
					.setValue(String(this.plugin.settings.repetitionMinLength))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed >= 0) {
							this.plugin.settings.repetitionMinLength = parsed;
							await this.plugin.saveSettings();
							this.plugin.refreshAllEditors();
							// Pas de this.update() ici : ça reconstruirait tout le
							// panneau à CHAQUE FRAPPE (onChange se déclenche sur
							// chaque caractère tapé), ce qui fait perdre le focus du
							// champ en cours de saisie et interrompt la frappe.
							// La liste des mots-outils filtrés par ce seuil se
							// met à jour à la prochaine ouverture des réglages.
						}
					});
			});

		new Setting(containerEl)
			.setName("Mots-outils")
			.setDesc(
				"Mots exclus de la détection de répétitions (articles, pronoms, prépositions...). Sépare-les par des espaces et/ou des virgules. Modifier cette liste remplace définitivement celle fournie par défaut."
			)
			.setClass("finition-stopwords-setting")
			.addTextArea((textArea) => {
				textArea.inputEl.rows = 6;
				textArea.inputEl.addClass("finition-stop-words-textarea");
				textArea.setValue(this.plugin.settings.customStopWords ?? this.plugin.stopWordsAsText());
				textArea.onChange(async (value) => {
					this.plugin.settings.customStopWords = value;
					this.plugin.functionWords = parseStopWords(value);
					await this.plugin.saveSettings();
					this.plugin.refreshAllEditors();
				});
			});

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText("Réinitialiser les mots-outils")
				.setTooltip("Revenir à la liste par défaut")
				.onClick(async () => {
					this.plugin.settings.customStopWords = null;
					await this.plugin.loadLexiconData();
					await this.plugin.saveSettings();
					this.plugin.refreshAllEditors();
					this.update();
				})
		);
	}

	private displayCadence(containerEl: HTMLElement): void {
		containerEl = this.section(containerEl, "Cadence");
		new Setting(containerEl)
			.setName("Empan de cadence (caractères)")
			.setDesc("Deux phrases de même structure rythmique séparées de moins de cette distance sont considérées comme une cadence.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.cadenceSpan))
					.setValue(String(this.plugin.settings.cadenceSpan))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.cadenceSpan = parsed;
							await this.plugin.saveSettings();
							this.plugin.refreshAllEditors();
						}
					});
			});

		new Setting(containerEl)
			.setName("Moteur de cadence")
			.setDesc(
				"Rapide : longueur et ponctuation des phrases. Syntaxique : moteur choisi dans la section corrections."
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("fast", "Rapide")
					.addOption("grammalecte", "Syntaxique")
					.setValue(this.plugin.settings.cadenceEngine)
					.onChange(async (value) => {
						this.plugin.settings.cadenceEngine = value as "fast" | "grammalecte";
						await this.plugin.saveSettings();
						this.plugin.refreshAllEditors();
					});
			});
	}

	private displayMonotony(containerEl: HTMLElement): void {
		containerEl = this.section(containerEl, "Monotonie");
		new Setting(containerEl)
			.setName("Longueur minimale d'une série (en phrases)")
			.setDesc("Nombre minimal de phrases consécutives de longueur proche pour former une série repérable.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "2";
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.burstThreshold))
					.setValue(String(this.plugin.settings.burstThreshold))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed >= 2) {
							this.plugin.settings.burstThreshold = parsed;
							await this.plugin.saveSettings();
							this.plugin.refreshAllEditors();
						}
					});
			});

		new Setting(containerEl)
			.setName("Tolérance (% de la longueur de phrase)")
			.setDesc(
				"Deux phrases voisines sont considérées proches si leur écart en mots ne dépasse pas ce pourcentage de leur longueur moyenne, avec un minimum de 1 mot."
			)
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.step = "1";
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.burstTolerancePercent))
					.setValue(String(this.plugin.settings.burstTolerancePercent))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.burstTolerancePercent = parsed;
							await this.plugin.saveSettings();
							this.plugin.refreshAllEditors();
						}
					});
			});
	}

	private displayPalette(containerEl: HTMLElement): void {
		containerEl = this.section(containerEl, "Palette");
		const grid = containerEl.createDiv({ cls: "finition-palette-grid" });

		this.plugin.settings.palette.forEach((hex, index) => {
			const assigned = COLOR_FUNCTIONS.find((f) => this.plugin.settings[f.key] === index);
			const item = grid.createDiv({ cls: "finition-palette-item" });

			new ColorComponent(item).setValue(hex).onChange(async (value) => {
				this.plugin.settings.palette[index] = value;
				await this.plugin.saveSettings();
				this.plugin.refreshAllEditors();
			});

			const dropdown = new DropdownComponent(item);
			dropdown.addOption("none", "—");
			COLOR_FUNCTIONS.forEach((f) => {
				dropdown.addOption(f.key, f.label);
			});
			dropdown.setValue(assigned ? assigned.key : "none");
			dropdown.onChange(async (value) => {
				if (value === "none") return; // retrait : réassigne la fonction à une autre couleur à la place
				this.plugin.settings[value as ColorFunctionKey] = index;
				await this.plugin.saveSettings();
				this.plugin.refreshAllEditors();
				this.update(); // réaffiche pour mettre à jour les autres menus déroulants (fonction réassignée)
			});
		});

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText("Réinitialiser la palette")
				.setTooltip("Revenir aux 16 couleurs par défaut, en progression chromatique")
				.onClick(async () => {
					this.plugin.settings.palette = [...DEFAULT_PALETTE];
					await this.plugin.saveSettings();
					this.plugin.refreshAllEditors();
					this.update();
				})
		);
	}

	private sectionDefinition(name: string, aliases: string[], render: (container: HTMLElement) => void): SettingDefinitionRender {
		return { name, aliases, render: setting => {
			setting.setClass("finition-settings-section-host");
			setting.settingEl.empty();
			render(setting.settingEl);
		} };
	}

	getSettingDefinitions(): SettingDefinitionRender[] {
		return [
			...this.generalDefinitions(),
			this.sectionDefinition("Corrections", ["Lexique", "Charger un lexique", ...(this.plugin.lexiconDictionaries?.options.map(option => option.name) ?? []), "Dictionnaire Finition", "Moteur d’analyse", "Neuronal", "Structure", "Tricolons", "Grammalecte", "Correcteur neuronal par défaut", "CamemBERT", "Charger un modèle neuronal", "Dictionnaire personnel", ...this.plugin.neuralModelOptions.map(option => option.name)], container => this.displayCorrections(container)),
			this.sectionDefinition("Corrections IA", ["Clé API Anthropic", "Clé API OpenAI", "Serveur local", "Modèle local", "Modèle par défaut", "Identifiant du modèle personnalisé", "Taille des tronçons (caractères)", "Prompt enregistré", "Prompt de révision", "Modèle pour ce prompt", "Identifiant du modèle pour ce prompt", "Enregistrer sous ce nom"], container => this.displayAICorrections(container)),
			this.sectionDefinition("Synonymes", ["Dictionnaire", "Finition", "Charger un dictionnaire", ...this.plugin.synonymDictionaryOptions.map(option => option.name)], container => this.displaySynonyms(container)),
			this.sectionDefinition("Définitions", ["Dictionnaire", "Charger un dictionnaire", ...(this.plugin.wordDictionaries?.options.filter(option => option.kind === "definitions").map(option => option.name) ?? [])], container => this.displayWordDictionary(container, "definitions")),
			this.sectionDefinition("Antonymes", ["Dictionnaire", "Charger un dictionnaire", ...(this.plugin.wordDictionaries?.options.filter(option => option.kind === "antonymes").map(option => option.name) ?? [])], container => this.displayWordDictionary(container, "antonymes")),
			this.sectionDefinition("Phonétique", ["Dictionnaire", "Charger un dictionnaire", ...(this.plugin.wordDictionaries?.options.filter(option => option.kind === "phonetique").map(option => option.name) ?? [])], container => this.displayWordDictionary(container, "phonetique")),
			this.sectionDefinition("Rimes", ["Dictionnaire", "Charger un dictionnaire", ...(this.plugin.wordDictionaries?.options.filter(option => option.kind === "rimes").map(option => option.name) ?? [])], container => this.displayWordDictionary(container, "rimes")),
			this.sectionDefinition("Répétitions", ["Empan de répétition (caractères)", "Longueur minimale d'un mot (caractères)", "Mots-outils"], container => this.displayRepetitions(container)),
			this.sectionDefinition("Cadence", ["Empan de cadence (caractères)", "Moteur de cadence"], container => this.displayCadence(container)),
			this.sectionDefinition("Monotonie", ["Longueur minimale d'une série (en phrases)", "Tolérance (% de la longueur de phrase)"], container => this.displayMonotony(container)),
			this.sectionDefinition("Palette", [], container => this.displayPalette(container)),
		];
	}

	update(): void {
		const { containerEl } = this;
		const scrollTop = containerEl.scrollTop;
		for (const details of Array.from(containerEl.querySelectorAll<HTMLDetailsElement>("details[data-section]"))) {
			const title = details.dataset.section!;
			if (details.open) this.openSections.add(title);
			else this.openSections.delete(title);
		}
		super.update();
		window.setTimeout(() => { containerEl.scrollTop = scrollTop; }, 0);
	}
}
