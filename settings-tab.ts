import { App, ColorComponent, DropdownComponent, PluginSettingTab, Setting } from "obsidian";
import type FinitionPlugin from "./main";
import { DEFAULT_SETTINGS, FinitionMode, parseStopWords } from "./types";

type ColorFunctionKey = "hedgingColorIndex" | "stereotypeColorIndex" | "ternaryColorIndex" | "hingeColorIndex";

const COLOR_FUNCTIONS: Array<{ key: ColorFunctionKey; label: string }> = [
	{ key: "hedgingColorIndex", label: "Atténuation" },
	{ key: "stereotypeColorIndex", label: "Stéréotypes" },
	{ key: "ternaryColorIndex", label: "Ternaires" },
	{ key: "hingeColorIndex", label: "Charnières" },
];

export class FinitionSettingTab extends PluginSettingTab {
	plugin: FinitionPlugin;

	constructor(app: App, plugin: FinitionPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Finition" });

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
					.addOption("burstiness", "Burstiness")
					.addOption("ternary", "Ternaires")
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
			.setName("Burstiness — longueur minimale d'une série")
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
			.setName("Burstiness — tolérance")
			.setDesc(
				"Marge de longueur tolérée entre deux phrases voisines pour les considérer 'proches' (plus la valeur est grande, plus la tolérance est large)."
			)
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0.1";
				text.inputEl.step = "0.1";
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.burstToleranceK))
					.setValue(String(this.plugin.settings.burstToleranceK))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.burstToleranceK = parsed;
							await this.plugin.saveSettings();
							this.plugin.refreshAllEditors();
						}
					});
			});

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

		new Setting(containerEl)
			.setName("Mots-outils")
			.setDesc(
				"Mots exclus de la détection de répétitions (articles, pronoms, prépositions...). Sépare-les par des espaces et/ou des virgules. Modifier cette liste remplace définitivement celle fournie par défaut."
			)
			.setClass("finition-stopwords-setting")
			.addTextArea((textArea) => {
				textArea.inputEl.rows = 10;
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
					this.display();
				})
		);

		containerEl.createEl("h3", { text: "Palette" });

		// Grille compacte : pour chaque couleur, juste 1) le sélecteur de
		// couleur natif (cercle, qui affiche la couleur actuelle) puis 2) le
		// menu déroulant d'association à une fonction (qui affiche lui-même
		// la valeur sélectionnée avec ses flèches). Pas de code hexa affiché,
		// pas de Setting (qui empile une bordure/un fond par ligne et donne
		// cet effet de blocs gris).
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
			COLOR_FUNCTIONS.forEach((f) => dropdown.addOption(f.key, f.label));
			dropdown.setValue(assigned ? assigned.key : "none");
			dropdown.onChange(async (value) => {
				if (value === "none") return; // retrait : réassigne la fonction à une autre couleur à la place
				this.plugin.settings[value as ColorFunctionKey] = index;
				await this.plugin.saveSettings();
				this.plugin.refreshAllEditors();
				this.display(); // réaffiche pour mettre à jour les autres menus déroulants (fonction réassignée)
			});
		});
	}
}
