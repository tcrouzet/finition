/*! Morphalou 3.1: ATILF CNRS, Marie Tonnelier, licence LGPL-LR (texte inclus dans finition-dictionnaire). Lexique 3.83: Boris New, Christophe Pallier et contributeurs. https://www.lexique.org/databases/Lexique383/Lexique383.tsv ; CC-BY-SA-4.0 https://creativecommons.org/licenses/by-sa/4.0/ ; adaptation: champs orthographiques et morphologiques, categories traduites, frequence maximale des corpus. */
import { FinitionCorrector } from "./corrector";
import { loadDictionnaire } from "./finition-dictionnaire";
import { maskMarkdown } from "./markdown";
import { createNeuralCorrector } from "./neural";
import { createElectraCorrector } from "./electra";
import { decodeDictionary, dictionaryFile, personalDictionaryFile } from "../../lexicon/shared";
import { adaptRepetitions } from "../../lexicon/repetition-adapter";
import { buildCopuleLexicon } from "../copules";

let corrector: Promise<FinitionCorrector> | undefined;
let neural: ReturnType<typeof createNeuralCorrector> | undefined;
let specialized: ReturnType<typeof createElectraCorrector> | undefined;
let sequence = 0;
const assets = new Map<number, { resolve: (buffer: ArrayBuffer) => void; reject: (error: Error) => void }>();
const readAsset = (file: string) => new Promise<ArrayBuffer>((resolve, reject) => {
	const assetId = sequence++;
	assets.set(assetId, { resolve, reject });
	self.postMessage({ asset: file, assetId });
});
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<{ id: number; text: string; words?: string[]; phonetics?: boolean; lemmas?: boolean; neural?: boolean; specialized?: boolean; lexicalOnly?: boolean; assetId?: number; buffer?: ArrayBuffer; error?: string }>) => {
	if (event.data.assetId !== undefined) {
		const request = assets.get(event.data.assetId);
		assets.delete(event.data.assetId);
		if (event.data.error) request?.reject(new Error(event.data.error));
		else if (event.data.buffer instanceof ArrayBuffer) request?.resolve(event.data.buffer);
		else request?.reject(new Error("Fichier neuronal invalide."));
		return;
	}
	const { id, text, words, phonetics, neural: enabled, lexicalOnly } = event.data;
	queue = queue.then(async () => {
		if (event.data.lemmas) {
			const value: unknown = JSON.parse(new TextDecoder().decode(await readAsset(dictionaryFile)));
			const dictionary = await decodeDictionary(value, "neural");
			return { lemmas: adaptRepetitions(dictionary), copules: buildCopuleLexicon(dictionary) };
		}
		if (lexicalOnly) {
			neural ??= createNeuralCorrector(readAsset).catch((error: unknown) => { neural = undefined; throw error; });
			return (await neural)(maskMarkdown(text));
		}
		corrector ??= loadDictionnaire(readAsset, () => readAsset(personalDictionaryFile)).then(dictionary => new FinitionCorrector(dictionary)).catch((error: unknown) => { corrector = undefined; throw error; });
		if (phonetics) {
			const data = JSON.parse(new TextDecoder().decode(await readAsset("phonet_data.json"))) as { lSet?: unknown };
			return (await corrector).getNeuralAlternatives(data.lSet, Boolean(event.data.specialized));
		}
		if (words) return (await corrector).getCategories(words);
		const masked = maskMarkdown(text);
		const base = await (await corrector).parse(masked);
		if (!enabled) return base;
		self.postMessage({ id, result: base, partial: true });
		if (!event.data.specialized) return base;
		specialized ??= createElectraCorrector(readAsset).catch((error: unknown) => { specialized = undefined; throw error; });
		const contextual = await (await specialized)(masked);
		return [...base.filter(item => !contextual.some(error => item.nStart < error.nEnd && item.nEnd > error.nStart)), ...contextual].sort((a, b) => a.nStart - b.nStart);
	}).then(
		result => self.postMessage({ id, result }),
		(error: unknown) => self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
	);
};
