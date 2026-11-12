import { neuralAssetFiles } from "./modes/finition-corrector/neural-assets";
import { dictionaryFile } from "./lexicon/shared";

export const resourceEngines = ["grammalecte", "finition-corrector"] as const;
export type ResourceEngine = typeof resourceEngines[number];
export const dictionaryResourcePacks = ["definitions", "antonymes", "phonetique", "rimes", "conjugaisons", "historique", "citations", "champ-lexical"] as const;
export const resourcePacks = ["lexique", ...resourceEngines, "synonymes", ...dictionaryResourcePacks] as const;
export type ResourcePack = typeof resourcePacks[number];
export const resourceLabels: Record<ResourcePack, string> = { lexique: "Dictionnaire Finition", grammalecte: "Grammalecte", "finition-corrector": "Neuronal", synonymes: "Synonymes", definitions: "Définitions", antonymes: "Antonymes", phonetique: "Phonétique", rimes: "Rimes", conjugaisons: "Conjugaisons", historique: "Étymologie", citations: "Citations", "champ-lexical": "Champ lexical" };
export const grammarFiles = {
	classic: "_dictionaries/fr-classic.json", reform: "_dictionaries/fr-reform.json",
	conjugations: "conj_data.json", phonetics: "phonet_data.json", plurals: "mfsp_data.json",
	thesaurus1: "thesaurus1_data.json", thesaurus2: "thesaurus2_data.json",
} as const;
export const resourceFiles: Record<ResourcePack, readonly string[]> = {
	lexique: [dictionaryFile, "MPL-2.0.txt"],
	grammalecte: [dictionaryFile, "MPL-2.0.txt", ...Object.values(grammarFiles).filter(file => !file.startsWith("_dictionaries/"))],
	"finition-corrector": [dictionaryFile, "MPL-2.0.txt", "phonet_data.json", ...neuralAssetFiles.filter(file => !file.startsWith("electra/")), "source.json", "ONNX-LICENSE.txt", "TRANSFORMERS-LICENSE.txt", "README.md"],
	synonymes: ["synonymes.json", "SOURCE.json", "MYTHES-NOTICE.txt", "LGPL-2.1.txt", "CECILL-C.txt"],
	definitions: ["definitions.json", "CC-BY-SA-4.0.txt"],
	antonymes: ["antonymes.json", "CC-BY-SA-4.0.txt"],
	phonetique: ["phonetique.json", "CC-BY-SA-4.0.txt"],
	rimes: ["rimes.json", "CC-BY-SA-4.0.txt"],
	conjugaisons: ["conjugaisons.json", "CC-BY-SA-4.0.txt"],
	historique: ["historique.json", "CC-BY-SA-4.0.txt"],
	citations: ["citations.json", "CC-BY-SA-4.0.txt"],
	"champ-lexical": ["champ-lexical.json", "CC-BY-SA-4.0.txt"],
};
export const resourceAssetName = (engine: ResourcePack, file: string): string => `${file === dictionaryFile || file === "MPL-2.0.txt" ? "lexique" : engine}-${file.replace(/\//g, "__")}`;
export const resourceSource = (engine: ResourcePack, file: string): string => file === dictionaryFile || file === "MPL-2.0.txt" ? `resources/lexique/${file}` : `${file.endsWith(".bin") ? "scripts/neural" : "resources"}/${file === "phonet_data.json" ? "grammalecte" : engine === "finition-corrector" ? "camembert" : engine}/${file}`;
