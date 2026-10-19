import { Lexicon } from "./lexicon";
import type { LexemeRow } from "./lexicon";
import type { ReadNeuralAsset } from "./neural-assets";

export async function loadDictionnaire(readAsset: ReadNeuralAsset): Promise<Lexicon> {
	const dictionaryText = new TextDecoder().decode(await readAsset("finition-dictionnaire.json"));
	const dictionary = JSON.parse(dictionaryText) as { name: string; version: number; encoding: string; payload: string };
	if (dictionary.name !== "finition-dictionnaire" || dictionary.version !== 1 || dictionary.encoding !== "gzip-base64") throw new Error("Format du dictionnaire invalide.");
	const binary = atob(dictionary.payload);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
	const [entries, forms] = JSON.parse(await new Response(stream).text()) as [LexemeRow[], string[]];
	if (!Array.isArray(entries) || !Array.isArray(forms)) throw new Error("Contenu du dictionnaire invalide.");
	return new Lexicon(entries, forms);
}
