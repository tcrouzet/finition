import { App, ColorComponent, DropdownComponent, PluginSettingTab, Setting } from "obsidian";
import type FinitionPlugin from "./main";
import { DEFAULT_PALETTE, DEFAULT_SETTINGS, FinitionMode, parseGrammalecteDictionary, parseStopWords } from "./types";

type ColorFunctionKey = "hedgingColorIndex" | "stereotypeColorIndex" | "hingeColorIndex" | "grammalecteColorIndex";

const COLOR_FUNCTIONS: Array<{ key: ColorFunctionKey; label: string }> = [
	{ key: "hedgingColorIndex", label: "Atténuation" },
	{ key: "stereotypeColorIndex", label: "Stéréotypes" },
	{ key: "hingeColorIndex", label: "Charnières" },
	{ key: "grammalecteColorIndex", label: "Grammalecte" },
];
// Tricolons n'a plus de couleur unique réglable ici : chaque tricolon
// détecté prend désormais une couleur différente de la palette (tournante,
// comme Cadence et Répétitions), pour rester visuellement distinct d'un
// autre tricolon voisin — une seule couleur fixe les aurait tous confondus
// en un même bloc.

export class FinitionSettingTab extends PluginSettingTab {
	plugin: FinitionPlugin;

	// État transitoire de l'UI "Enregistrer sous ce nom" (nom + modèle en
	// cours de saisie, pas encore sauvegardés). Stocké sur l'instance (qui
	// survit, elle, aux appels répétés de display()) plutôt qu'en variable
	// locale de display() : sinon chaque this.display() — déclenché par le
	// changement de modèle ou de prompt — recréait ces variables à partir
	// des réglages déjà persistés, annulant silencieusement la sélection
	// qu'on venait de faire. null = pas de saisie en cours, se recale sur
	// les réglages actuels.
	private pendingPromptName: string | null = null;
	private pendingPromptModel: string | null = null;

	constructor(app: App, plugin: FinitionPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		// display() est réappelé après chaque changement (couleur, prompt,
		// modèle…) pour refléter immédiatement l'état à jour — mais ça vide
		// et reconstruit tout le panneau, ce qui remettait le défilement en
		// haut à chaque fois. On restaure la position juste après coup.
		const scrollTop = containerEl.scrollTop;
		containerEl.empty();
		new Setting(containerEl)
			.setName("Mode actif")
			.setDesc(
				"Équivalent du menu ouvert en cliquant sur la note de musique dans la barre d'état."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("none", "Aucun")
					.addOption("repetition", "Répétitions")
					.addOption("hedging", "Atténuation")
					.addOption("stereotype", "Stéréotypes")
					.addOption("burstiness", "Monotonie")
					.addOption("ternary", "Tricolons")
					.addOption("cadence", "Cadence")
					.addOption("hinges", "Charnières")
					.setValue(this.plugin.settings.mode)
					.onChange(async (value) => {
						this.plugin.settings.mode = value as FinitionMode;
						await this.plugin.saveSettings();
						this.plugin.updateStatusBarIcon();
						this.plugin.refreshAllEditors();
					})
			);

		new Setting(containerEl)
			.setName("Taille maximale de document analysé")
			.setDesc("Garde-fou de performance : au-delà de cette taille (caractères), le surlignage est désactivé.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxDocumentLength)).onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isNaN(parsed) && parsed > 0) {
						this.plugin.settings.maxDocumentLength = parsed;
						await this.plugin.saveSettings();
					}
				})
			);

		new Setting(containerEl).setName("Répétition").setHeading();

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
							// Pas de this.display() ici : ça reconstruirait tout le
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
					this.plugin.loadLexiconData();
					await this.plugin.saveSettings();
					this.plugin.refreshAllEditors();
					this.display();
				})
		);

		new Setting(containerEl).setName("Cadence").setHeading();

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
			.setName("Moteur de Cadence")
			.setDesc(
				"Rapide : heuristique légère basée sur la longueur et la ponctuation des phrases (temps réel). Grammalecte : signatures syntaxiques (sujet/verbe/complément...) construites à partir de l'analyse grammaticale de Grammalecte, plus précises mais plus lentes à calculer sur de longs documents."
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("fast", "Rapide")
					.addOption("grammalecte", "Grammalecte")
					.setValue(this.plugin.settings.cadenceEngine)
					.onChange(async (value) => {
						this.plugin.settings.cadenceEngine = value as "fast" | "grammalecte";
						await this.plugin.saveSettings();
						this.plugin.refreshAllEditors();
					});
			});

		new Setting(containerEl).setName("Monotonie").setHeading();

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
				"Deux phrases voisines sont considérées 'proches' si leur écart (en mots) ne dépasse pas ce pourcentage de la moyenne de LEURS DEUX longueurs à elles (pas de la moyenne du document) — avec un minimum d'1 mot. Ex. 10 % : phrases de 10 et 10 mots → moyenne 10 → 1 mot d'écart toléré ; phrases de 28 et 32 mots → moyenne 30 → 3 mots tolérés."
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

		new Setting(containerEl).setName("Grammalecte").setHeading();

		new Setting(containerEl)
			.setName("Dictionnaire")
			.setDesc("Orthographe classique ou rectifications de 1990. Ne prend effet qu'au prochain lancement de Grammalecte (menu ♪).")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("fr-classic", "Classique")
					.addOption("fr-reform", "Réforme 1990")
					.setValue(this.plugin.settings.grammalecteDictionary)
					.onChange(async (value) => {
						this.plugin.settings.grammalecteDictionary = value as "fr-classic" | "fr-reform";
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Dictionnaire personnel")
			.setDesc(
				"Mots que Grammalecte ne doit plus jamais signaler comme fautifs (noms propres, néologismes...). Sépare-les par des espaces et/ou des virgules — se remplit aussi automatiquement via le bouton « Ajouter au dictionnaire » dans le popup de correction."
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
					// Pas de this.display() ici, même raison que "Longueur
					// minimale d'un mot" plus haut : onChange se déclenche à
					// chaque frappe, un display() ferait perdre le focus.
				});
			});

		new Setting(containerEl).setName("Ortho-typo IA").setHeading();

		const apiKeyDesc = document.createDocumentFragment();
		apiKeyDesc.appendChild(
			document.createTextNode(
				"Nécessaire pour utiliser « Ortho-typo IA » (menu ♪). Stockée en clair dans data.json, comme la plupart des plugins IA d'Obsidian. "
			)
		);
		const apiKeyLink = document.createElement("a");
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
					.setPlaceholder("sk-ant-...")
					.setValue(this.plugin.settings.aiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.aiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		const openaiKeyDesc = document.createDocumentFragment();
		openaiKeyDesc.appendChild(
			document.createTextNode("Utilisée à la place de la clé Anthropic quand le modèle choisi ci-dessous est un modèle GPT. ")
		);
		const openaiKeyLink = document.createElement("a");
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
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		const modelDesc = document.createDocumentFragment();
		modelDesc.appendChild(
			document.createTextNode(
				"Modèle à utiliser — Claude (Anthropic) ou GPT (OpenAI) : le nom choisi détermine automatiquement quelle clé API est utilisée. "
			)
		);
		const modelLink = document.createElement("a");
		modelLink.textContent = "Modèles Claude";
		modelLink.href = "https://platform.claude.com/docs/en/models/overview";
		modelLink.target = "_blank";
		modelLink.rel = "noopener";
		modelDesc.appendChild(modelLink);
		modelDesc.appendChild(document.createTextNode(" · "));
		const openaiModelLink = document.createElement("a");
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
						this.display(); // affiche/masque le champ de saisie libre
					});
			});

		if (!isPreset) {
			new Setting(containerEl)
				.setName("Identifiant du modèle personnalisé")
				.setDesc("Identifiant exact tel que documenté par Anthropic (ex. claude-sonnet-4-5-20250929).")
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
					dropdown.addOption(UNSAVED_VALUE, "(non enregistré)");
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
						}
						await this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Prompt de révision")
			.setDesc(
				"Instructions envoyées à l'IA pour chaque tronçon. Modifiable librement — toute modification ici n'affecte que le prompt actif, pas la version enregistrée sous ce nom (utilise « Enregistrer » ci-dessous pour la mettre à jour)."
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
					// Pas de this.display() ici, pour la même raison que le champ
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
		const PROMPT_MODEL_DEFAULT_VALUE = "__model_default__";
		const PROMPT_MODEL_CUSTOM_VALUE = "__model_custom__";
		const promptModelIsPreset =
			this.pendingPromptModel === "" || AI_MODEL_PRESETS.some((p) => p.value === this.pendingPromptModel);

		new Setting(containerEl)
			.setName("Modèle pour ce prompt")
			.setDesc(
				"Modèle utilisé quand CE prompt est chargé. « Modèle par défaut » : pas de modèle dédié, le prompt utilise simplement le modèle réglé ci-dessus (qui devient alors son modèle par défaut)."
			)
			.addDropdown((dropdown) => {
				dropdown.addOption(PROMPT_MODEL_DEFAULT_VALUE, "Modèle par défaut");
				for (const preset of AI_MODEL_PRESETS) {
					dropdown.addOption(preset.value, preset.label);
				}
				dropdown.addOption(PROMPT_MODEL_CUSTOM_VALUE, "Autre (saisir un identifiant)…");
				dropdown
					.setValue(
						this.pendingPromptModel === ""
							? PROMPT_MODEL_DEFAULT_VALUE
							: promptModelIsPreset
							? (this.pendingPromptModel as string)
							: PROMPT_MODEL_CUSTOM_VALUE
					)
					.onChange((value) => {
						if (value === PROMPT_MODEL_DEFAULT_VALUE) {
							this.pendingPromptModel = "";
						} else if (value === PROMPT_MODEL_CUSTOM_VALUE) {
							this.pendingPromptModel = promptModelIsPreset ? "" : this.pendingPromptModel;
						} else {
							this.pendingPromptModel = value;
						}
						this.display(); // affiche/masque le champ de saisie libre, comme pour le modèle global
					});
			});

		const promptModelShowCustomField =
			this.pendingPromptModel !== "" && !AI_MODEL_PRESETS.some((p) => p.value === this.pendingPromptModel);

		if (promptModelShowCustomField) {
			new Setting(containerEl)
				.setName("Identifiant du modèle pour ce prompt")
				.addText((text) =>
					text
						.setPlaceholder("Ex. claude-opus-4-1-20250805")
						.setValue(this.pendingPromptModel as string)
						.onChange((value) => {
							this.pendingPromptModel = value.trim();
						})
				);
		}

		new Setting(containerEl)
			.setName("Enregistrer sous ce nom")
			.setDesc("Sauvegarde le texte et le modèle du prompt ci-dessus dans la bibliothèque, sous ce nom (écrase le prompt existant s'il porte déjà ce nom).")
			.addText((text) => {
				text.setPlaceholder("Ex. Littéraire, Sobre, Journalistique…").setValue(this.pendingPromptName as string);
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
						await this.plugin.saveSettings();
						this.display();
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
		};

		// Un prompt système (builtin) n'est jamais supprimable depuis les
		// réglages — seuls les prompts créés par l'utilisateur le sont.
		if (activeMatchesSaved && activeSavedEntry && !activeSavedEntry.builtin) {
			new Setting(containerEl).addButton((button) =>
				button
					.setButtonText(`Supprimer « ${this.plugin.settings.activePromptName} »`)
					.setWarning()
					.onClick(async () => {
						const name = this.plugin.settings.activePromptName;
						this.plugin.settings.savedPrompts = this.plugin.settings.savedPrompts.filter((p) => p.name !== name);
						resetToFactoryDefault();
						await this.plugin.saveSettings();
						this.display();
					})
			);
		}

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText("Réinitialiser le prompt")
				.setTooltip("Revenir au prompt « Corrections » d'origine (sans toucher à la bibliothèque enregistrée)")
				.onClick(async () => {
					resetToFactoryDefault();
					await this.plugin.saveSettings();
					this.display();
				})
		);

		new Setting(containerEl).setName("Palette").setHeading();

		// Grille compacte : pour chaque couleur, juste 1) le sélecteur de
		// couleur natif (cercle, qui affiche la couleur actuelle) puis 2) le
		// menu déroulant natif d'association à une fonction (qui affiche
		// lui-même la valeur sélectionnée avec ses flèches — standard, pas de
		// composant maison). Pas de code hexa affiché, pas de Setting (qui
		// empile une bordure/un fond par ligne et donne cet effet de blocs
		// gris). Remplissage en COLONNES (grid-auto-flow: column dans le CSS)
		// pour que l'ordre de lecture naturel (de haut en bas dans une
		// colonne, puis la colonne suivante) corresponde à l'ordre réel du
		// tableau, donc à la progression chromatique — un remplissage par
		// LIGNES ferait sauter d'une teinte à l'autre sans logique visible.
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
				this.display(); // réaffiche pour mettre à jour les autres menus déroulants (fonction réassignée)
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
					this.display();
				})
		);

		// Restauration du défilement capturé en tout début de display() :
		// après un reflow (setTimeout 0), sinon le DOM reconstruit n'a pas
		// encore sa hauteur finale et scrollTop serait ignoré.
		window.setTimeout(() => {
			containerEl.scrollTop = scrollTop;
		}, 0);
	}
}
