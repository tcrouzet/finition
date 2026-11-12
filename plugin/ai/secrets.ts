import type { SecretStorage } from "obsidian";
import type { FinitionSettings } from "../types";

type LegacySettings = Partial<FinitionSettings> & { aiApiKey?: string; openaiApiKey?: string };

export function migrateAISecrets(settings: LegacySettings, storage: Pick<SecretStorage, "getSecret" | "setSecret">): boolean {
	let changed = false;
	for (const [legacy, reference, base] of [
		["aiApiKey", "anthropicSecretId", "finition-anthropic"],
		["openaiApiKey", "openaiSecretId", "finition-openai"],
	] as const) {
		if (!(legacy in settings)) continue;
		const value = settings[legacy];
		if (typeof value === "string" && value.trim()) {
			const secret = value.trim();
			let id: string = base, suffix = 2;
			while (storage.getSecret(id) && storage.getSecret(id) !== secret) id = `${base}-${suffix++}`;
			if (storage.getSecret(id) !== secret) storage.setSecret(id, secret);
			if (storage.getSecret(id) !== secret) throw new Error("Impossible de transférer les clés API vers le gestionnaire de secrets. Les réglages existants sont conservés.");
			settings[reference] = id;
		}
		delete settings[legacy];
		changed = true;
	}
	return changed;
}
