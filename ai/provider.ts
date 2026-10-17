/**
 * Un seul champ "Modèle" dans les réglages pilote deux fournisseurs
 * différents (Anthropic/Claude et OpenAI/GPT) : c'est le nom du modèle
 * choisi qui détermine quelle API appeler et quelle clé utiliser, plutôt
 * qu'un sélecteur de fournisseur séparé.
 */
export type AIProvider = "anthropic" | "openai";

export function detectProvider(model: string): AIProvider {
	const m = model.toLowerCase();
	// "gpt-...", "o1-...", "o3-...", "o4-..." : familles de modèles OpenAI.
	if (m.startsWith("gpt") || /^o\d/.test(m)) return "openai";
	return "anthropic";
}
