/**
 * Appel à l'API OpenAI (Chat Completions) via `requestUrl` (obligatoire dans
 * Obsidian/Electron pour contourner les restrictions CORS de `fetch`).
 * Même contrat (ReviseResult, retries) que ai/anthropic.ts, pour que
 * main.ts puisse basculer de l'un à l'autre selon le modèle choisi sans
 * changer son code appelant.
 */

import { requestUrl } from "obsidian";
import { hasResponseText } from "./clean";

interface OpenAICallOptions {
	apiKey: string;
	baseUrl?: string;
	model: string;
	maxTokens: number;
	system: string;
	userText: string;
}

interface OpenAICallResult {
	text: string | null;
	/** Message d'erreur lisible, uniquement si text est null. */
	error: string | null;
}

export async function callOpenAI(opts: OpenAICallOptions): Promise<OpenAICallResult> {
	let timeout: number | undefined;
	try {
		const request = requestUrl({
			url: `${opts.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`,
			method: "POST",
			headers: {
				...(opts.baseUrl ? {} : { Authorization: `Bearer ${opts.apiKey}` }),
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: opts.model,
				...(opts.baseUrl ? { max_tokens: opts.maxTokens, stream: false } : { max_completion_tokens: opts.maxTokens }),
				messages: [
					{ role: "system", content: opts.system },
					{ role: "user", content: opts.userText },
				],
			}),
			throw: false,
		});
		const response = await (opts.baseUrl ? Promise.race([
			request,
			new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error("Le serveur local n’a pas répondu dans les deux minutes.")), 120_000); }),
		]) : request);
		if (response.status < 200 || response.status >= 300) {
			// OpenAI renvoie un JSON { error: { message, type, code } } en cas
			// d'échec (clé invalide, modèle inconnu, quota dépassé...) — on le
			// remonte tel quel plutôt que de le passer sous silence.
			let detail = response.text;
			try {
				const errJson = response.json as { error?: string | { message?: string } };
				if (typeof errJson?.error === "string") detail = errJson.error;
				else if (errJson?.error?.message) detail = errJson.error.message;
			} catch {
				// response.text déjà utilisé en repli
			}
			const message = `Erreur API ${opts.baseUrl ? "serveur local" : "OpenAI"} (${response.status}) : ${detail}`;
			console.error("Corrections IA :", message);
			return { text: null, error: message };
		}
		const data = response.json as { choices?: Array<{ message?: { content?: string } }> };
		const text = data?.choices?.[0]?.message?.content;
		if (!hasResponseText(text)) {
			const message = "Réponse API inattendue (aucun contenu).";
			console.error("Corrections IA :", message, data);
			return { text: null, error: message };
		}
		return { text, error: null };
	} catch (e) {
		const message = `Erreur réseau : ${e instanceof Error ? e.message : String(e)}`;
		console.error("Corrections IA :", message);
		return { text: null, error: message };
	} finally {
		if (timeout !== undefined) window.clearTimeout(timeout);
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
 * d'origine) — même logique que reviseChunkWithRetry() côté Anthropic.
 */
export async function reviseChunkWithRetryOpenAI(
	chunk: string,
	system: string,
	opts: Omit<OpenAICallOptions, "system" | "userText">
): Promise<ReviseResult> {
	let lastError: string | null = null;
	for (let attempt = 1; attempt <= (opts.baseUrl ? 1 : 3); attempt++) {
		const result = await callOpenAI({
			...opts,
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
