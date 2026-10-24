import type { FinitionSettings } from "../types";
import { CODEX_MODEL } from "./codex";
import modelPresets from "./models.json";

export type AIProvider = "anthropic" | "openai" | "codex";

export function aiModelName(connection: { provider: AIProvider; model: string }): string {
	return connection.provider === "codex" ? connection.model ? `Codex · ${connection.model}` : "Codex" : modelPresets.find(preset => preset.value === connection.model)?.label ?? connection.model;
}

export function detectProvider(model: string): AIProvider {
	if (model === CODEX_MODEL) return "codex";
	const m = model.toLowerCase();
	// "gpt-...", "o1-...", "o3-...", "o4-..." : familles de modèles OpenAI.
	if (m.startsWith("gpt") || /^o\d/.test(m)) return "openai";
	return "anthropic";
}

export function getAIConnection(settings: FinitionSettings): { provider: AIProvider; apiKey: string; model: string; baseUrl?: string } {
	if (settings.aiModel === CODEX_MODEL) return { provider: "codex", apiKey: "", model: settings.codexModel.trim() };
	if (settings.localAIServer.trim()) {
		let url: URL;
		try { url = new URL(settings.localAIServer.trim()); }
		catch { throw new Error("Serveur local : adresse HTTP ou HTTPS invalide."); }
		if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) {
			throw new Error("Serveur local : utilise une adresse HTTP ou HTTPS sans identifiants, paramètres ni fragment.");
		}
		const model = settings.localAIModel.trim();
		if (!model) throw new Error("Serveur local : renseigne le champ Modèle local dans les réglages de Finition.");
		const path = url.pathname.replace(/\/+$/u, "");
		url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
		return { provider: "openai", apiKey: "", model, baseUrl: url.href.replace(/\/$/u, "") };
	}
	const provider = detectProvider(settings.aiModel);
	const apiKey = provider === "openai" ? settings.openaiApiKey : settings.aiApiKey;
	if (!apiKey) throw new Error(`renseigne ta clé API ${provider === "openai" ? "OpenAI" : "Anthropic"} dans Réglages → Finition.`);
	return { provider, apiKey, model: settings.aiModel };
}
