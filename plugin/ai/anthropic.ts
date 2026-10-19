/**
 * Appel à l'API Claude (Anthropic) via `requestUrl` (obligatoire dans
 * Obsidian/Electron pour contourner les restrictions CORS de `fetch`).
 */

import { requestUrl } from "obsidian";

interface AnthropicCallOptions {
	apiKey: string;
	model: string;
	maxTokens: number;
	system: string;
	userText: string;
}

interface AnthropicCallResult {
	text: string | null;
	/** Message d'erreur lisible, uniquement si text est null. */
	error: string | null;
}

export async function callAnthropic(opts: AnthropicCallOptions): Promise<AnthropicCallResult> {
	try {
		const response = await requestUrl({
			url: "https://api.anthropic.com/v1/messages",
			method: "POST",
			headers: {
				"x-api-key": opts.apiKey,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: opts.model,
				max_tokens: opts.maxTokens,
				system: opts.system,
				messages: [{ role: "user", content: opts.userText }],
			}),
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) {
			// Anthropic renvoie un JSON { error: { type, message } } en cas
			// d'échec (clé invalide, modèle inconnu, quota dépassé...) — on le
			// remonte tel quel plutôt que de le passer sous silence.
			let detail = response.text;
			try {
				const errJson = response.json as { error?: { message?: string } };
				if (errJson?.error?.message) detail = errJson.error.message;
			} catch {
				// response.text déjà utilisé en repli
			}
			const message = `Erreur API Anthropic (${response.status}) : ${detail}`;
			console.error("Corrections IA :", message);
			return { text: null, error: message };
		}
		const data = response.json as { content?: Array<{ type: string; text?: string }> };
		const textBlock = data.content?.find((block) => block.type === "text");
		if (!textBlock?.text) {
			const message = "Réponse API inattendue (aucun bloc de texte).";
			console.error("Corrections IA :", message, data);
			return { text: null, error: message };
		}
		return { text: textBlock.text, error: null };
	} catch (e) {
		const message = `Erreur réseau : ${e instanceof Error ? e.message : String(e)}`;
		console.error("Corrections IA :", message);
		return { text: null, error: message };
	}
}

export interface ReviseResult {
	text: string;
	/** Dernière erreur rencontrée si toutes les tentatives ont échoué, sinon null. */
	error: string | null;
}

/**
 * Révise un tronçon, avec jusqu'à 3 tentatives si l'appel échoue ou si la
 * réponse semble tronquée (moins de 80 % de la longueur du tronçon
 * d'origine) — même heuristique que `chunkProcessor()` côté Python. En cas
 * d'échec complet, renvoie le tronçon tel quel accompagné du message
 * d'erreur, pour que l'appelant puisse en informer l'utilisateur au lieu de
 * laisser croire silencieusement qu'"aucune correction" n'était nécessaire.
 */
export async function reviseChunkWithRetryAnthropic(
	chunk: string,
	system: string,
	opts: { apiKey: string; model: string; maxTokens: number }
): Promise<ReviseResult> {
	let lastError: string | null = null;
	for (let attempt = 1; attempt <= 3; attempt++) {
		const result = await callAnthropic({
			apiKey: opts.apiKey,
			model: opts.model,
			maxTokens: opts.maxTokens,
			system,
			userText: chunk,
		});
		if (result.error) {
			lastError = result.error;
			continue;
		}
		if (result.text && result.text.length >= 0.8 * chunk.length) {
			return { text: result.text, error: null };
		}
		lastError = "Réponse trop courte par rapport au texte d'origine (possiblement tronquée).";
	}
	return { text: chunk, error: lastError };
}
