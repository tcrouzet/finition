import { App, PluginSettingTab, Setting } from "obsidian";
import type FinitionPlugin from "./main";
import { DEFAULT_SETTINGS, FinitionMode, parseStopWords } from "./types";

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
				"Un seul mode à la fois (cumuler les surlignages serait illisible). Équivalent du menu ouvert en cliquant sur la note de musique dans la barre d'état."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("none", "Aucun")
					.addOption("repetition", "Répétitions")
					.addOption("hedging", "Prudence épistémique")
					.addOption("stereotype", "Stéréotypes")
					.addOption("burstiness", "Burstiness")
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
			.setName("Mots-outils (stop words)")
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
				.setTooltip("Revenir à la liste chargée depuis data/function-words.json")
				.onClick(async () => {
					this.plugin.settings.customStopWords = null;
					await this.plugin.loadLexiconData();
					await this.plugin.saveSettings();
					this.plugin.refreshAllEditors();
					this.display();
				})
		);
	}
}
