export const neuralModelParts = ["onnx/model-0.bin", "onnx/model-1.bin"] as const;
export const neuralAssetFiles = ["model.json", "tokenizer.json", "tokenizer_config.json", "onnx/weights-0.bin", "onnx/weights-1.bin", "electra/model.json", "electra/weights.bin", "electra/tokenizer.json", "electra/labels.json"] as const;
export type ReadNeuralAsset = (file: string) => Promise<ArrayBuffer>;
export const specializedFiles = ["electra/model.json", "electra/weights.bin", "electra/tokenizer.json", "electra/labels.json"] as const;
export const specializedHeads = { VirguleManquanteGeneraleDevant: 2, MotsManquantsGeneralDevant: 125, est: 12, ou: 3, ces: 5 } as const;
