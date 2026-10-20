import type { Lexicon } from "./lexicon";
import type { ReadNeuralAsset } from "./neural-assets";
import { decodeDictionary, readPersonalForms } from "../../lexicon/shared";
import { adaptNeural } from "../../lexicon/neural-adapter";

export async function loadDictionnaire(readAsset: ReadNeuralAsset, readPersonal?: () => Promise<ArrayBuffer>): Promise<Lexicon> {
	const dictionaryText = new TextDecoder().decode(await readAsset("finition-dictionnaire.json"));
	const dictionary: unknown = JSON.parse(dictionaryText);
	const [data, personal] = await Promise.all([decodeDictionary(dictionary, "neural"), readPersonal ? readPersonalForms(readPersonal) : []]);
	return adaptNeural(data, personal);
}
