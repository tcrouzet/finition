import type { App } from "obsidian";
import type FinitionPlugin from "../main";
import { FinitionSettingTab } from "../plugin/settings-tab";

export async function checkPromptModels(Plugin: typeof FinitionPlugin): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const plugin = new Plugin({} as App, { id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.14.0", description: "", author: "" });
	await plugin.loadSettings();
	const [first, second] = plugin.settings.savedPrompts;
	const container = document.body.createDiv();
	let tab = new FinitionSettingTab(plugin.app, plugin);
	tab.containerEl = container;
	tab.update();
	const row = (name: string) => Array.from(container.querySelectorAll(".setting-item")).find(row => row.querySelector(".setting-item-name")?.textContent === name)!;
	check(row("Serveur local") && row("Modèle local"), "Champs de connexion au serveur local absents");
	const names = Array.from(container.querySelectorAll(".setting-item-name"), element => element.textContent);
	check(names.indexOf("Serveur local") === names.indexOf("Clé API OpenAI") + 1 && names.indexOf("Modèle local") === names.indexOf("Serveur local") + 1, "Connexion locale placée hors des zones de clés API");
	for (const [name, value] of [["Serveur local", "http://localhost:11434"], ["Modèle local", "modele-local:test"]]) {
		const input = row(name).querySelector<HTMLInputElement>("input")!;
		check(input.value === "", "Une connexion locale est activée par défaut");
		input.value = value;
		input.dispatchEvent(new Event("input"));
		await new Promise(resolve => window.setTimeout(resolve, 0));
	}
	const select = (name: string) => row(name).querySelector<HTMLSelectElement>("select")!;
	const change = async (name: string, value: string) => {
		const field = select(name);
		field.value = value;
		field.dispatchEvent(new Event("change"));
		await new Promise(resolve => window.setTimeout(resolve, 0));
	};
	await change("Prompt enregistré", first.name);
	await change("Modèle pour ce prompt", "gpt-6.1-sol");
	await change("Prompt enregistré", second.name);
	await change("Modèle pour ce prompt", "claude-haiku-5-5");
	await change("Prompt enregistré", first.name);
	check(select("Modèle pour ce prompt").value === "gpt-6.1-sol" && plugin.settings.aiModel === "gpt-6.1-sol", "Le modèle du premier prompt est perdu après un aller-retour");
	await change("Prompt enregistré", second.name);
	check(select("Modèle pour ce prompt").value === "claude-haiku-5-5", "Le modèle du second prompt écrase celui du premier");
	await change("Modèle pour ce prompt", "__model_custom__");
	const custom = row("Identifiant du modèle pour ce prompt")?.querySelector<HTMLInputElement>("input");
	check(custom, "Le choix d’un modèle personnalisé ne permet pas de saisir son identifiant");
	custom!.value = "modele-personnel";
	custom!.dispatchEvent(new Event("input"));
	await new Promise(resolve => window.setTimeout(resolve, 0));
	await plugin.loadSettings();
	tab = new FinitionSettingTab(plugin.app, plugin);
	tab.containerEl = container;
	tab.update();
	check(row("Serveur local").querySelector<HTMLInputElement>("input")!.value === "http://localhost:11434" && row("Modèle local").querySelector<HTMLInputElement>("input")!.value === "modele-local:test", "Connexion locale perdue après réouverture des réglages");
	check(plugin.settings.savedPrompts.find(prompt => prompt.name === second.name)?.model === "modele-personnel" && row("Identifiant du modèle pour ce prompt").querySelector<HTMLInputElement>("input")!.value === "modele-personnel", "Le modèle personnalisé n’est pas persisté après réouverture des réglages");
	await change("Prompt enregistré", first.name);
	await change("Modèle pour ce prompt", "__model_default__");
	await change("Prompt enregistré", second.name);
	await change("Prompt enregistré", first.name);
	check(select("Modèle pour ce prompt").value === "__model_default__", "Le choix du modèle par défaut n’est pas mémorisé");
	const draft = row("Prompt de révision").querySelector<HTMLTextAreaElement>("textarea")!;
	draft.value += "\nBrouillon non enregistré.";
	draft.dispatchEvent(new Event("input"));
	await change("Modèle pour ce prompt", "gpt-6-luna");
	await plugin.loadSettings();
	check(plugin.settings.savedPrompts.find(prompt => prompt.name === first.name)?.model === "", "Modifier un brouillon réécrit le modèle du prompt enregistré");
	container.remove();
	console.error("finition-test-step", "prompts : modèles dédiés, personnalisés, défaut, persistance et brouillons vérifiés");
}
