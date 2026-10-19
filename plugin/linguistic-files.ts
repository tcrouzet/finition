import { neuralAssetFiles } from "./modes/finition-corrector/neural-assets";

export const resourceEngines = ["grammalecte", "finition-corrector"] as const;
export type ResourceEngine = typeof resourceEngines[number];
export const resourcePacks = [...resourceEngines, "synonymes"] as const;
export type ResourcePack = typeof resourcePacks[number];
export const resourceLabels: Record<ResourcePack, string> = { grammalecte: "Grammalecte", "finition-corrector": "Neuronal", synonymes: "Synonymes" };
export const grammarFiles = {
	classic: "_dictionaries/fr-classic.json", reform: "_dictionaries/fr-reform.json",
	conjugations: "conj_data.json", phonetics: "phonet_data.json", plurals: "mfsp_data.json",
	thesaurus1: "thesaurus1_data.json", thesaurus2: "thesaurus2_data.json",
} as const;
export const resourceFiles: Record<ResourcePack, readonly string[]> = {
	grammalecte: Object.values(grammarFiles),
	"finition-corrector": ["finition-dictionnaire.json", "phonet_data.json", ...neuralAssetFiles.filter(file => !file.startsWith("electra/")), "source.json", "ONNX-LICENSE.txt", "TRANSFORMERS-LICENSE.txt", "README.md"],
	synonymes: ["synonymes.json", "SOURCE.json", "MYTHES-NOTICE.txt", "LGPL-2.1.txt", "CECILL-C.txt"],
};
export const resourceAssetName = (engine: ResourcePack, file: string): string => `${engine}-${file.replace(/\//g, "__")}`;
export const resourceSource = (engine: ResourcePack, file: string): string => `ressources/${file === "phonet_data.json" ? "grammalecte" : engine === "finition-corrector" ? "camembert" : engine}/${file}`;
