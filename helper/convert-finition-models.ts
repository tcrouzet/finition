import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as process from "node:process";
import { onnx } from "../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx";
import type { DenseWeights, EmbeddingWeights, LayerWeights, ModelData, NormWeights, WeightArray } from "../plugin/modes/finition-corrector/model";
import { specializedFiles } from "../plugin/modes/finition-corrector/neural-assets";

export async function convertModel(kind: "camembert" | "electra", source: Uint8Array, directory: URL): Promise<void> {
	const decoded = onnx.ModelProto.decode(source);
	assert(decoded.graph, "Graphe neuronal absent.");
	const graph = onnx.GraphProto.create(decoded.graph), nodes = graph.node.map(node => onnx.NodeProto.create(node));
	const tensors = new Map(graph.initializer.map(tensor => { const value = onnx.TensorProto.create(tensor); return [value.name, value]; }));
	const chunks: Uint8Array[] = [], cached = new Map<string, WeightArray>();
	let offset = 0;
	const append = (bytes: Uint8Array, type: WeightArray["type"], dims: number[]): WeightArray => {
		if (offset % 4) { const padding = 4 - offset % 4; chunks.push(new Uint8Array(padding)); offset += padding; }
		const result = { offset, dims, type };
		chunks.push(bytes); offset += bytes.byteLength;
		return result;
	};
	const tensor = (name: string) => { const value = tensors.get(name); assert(value, `Poids absents : ${name}`); return value; };
	const bytes = (name: string): Uint8Array => {
		const value = tensor(name);
		if (value.rawData.length) return value.rawData;
		if (value.dataType === 1) return new Uint8Array(new Float32Array(value.floatData).buffer);
		if (value.dataType === 2 || value.dataType === 3) return Uint8Array.from(value.int32Data);
		throw new Error(`Type de poids incompatible : ${name}`);
	};
	const array = (name: string): WeightArray => {
		let result = cached.get(name);
		if (!result) {
			const value = tensor(name), type = value.dataType === 1 ? "f32" : value.dataType === 2 ? "u8" : value.dataType === 3 ? "i8" : null;
			assert(type, `Type neuronal non pris en charge : ${name}`);
			result = append(bytes(name), type, value.dims.map(Number)); cached.set(name, result);
		}
		return result;
	};
	const scalar = (name: string): number => {
		const value = tensor(name), raw = bytes(name);
		assert(value.dims.length === 0);
		return value.dataType === 1 ? new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat32(0, true) : raw[0];
	};
	const nodePrefix = kind === "camembert" ? "/roberta" : "/model/electra";
	const weightPrefix = kind === "camembert" ? "roberta" : "model.electra";
	const norm = (name: string, path: string): NormWeights => {
		const node = nodes.find(item => item.name === path + (kind === "camembert" ? "/Constant_1" : "/LayerNormalization"));
		assert(node, `Normalisation absente : ${path}`);
		const rawConstant = node.attribute.find(attribute => attribute.name === "value")?.t;
		const constant = rawConstant ? onnx.TensorProto.create(rawConstant) : undefined;
		const epsilon = kind === "camembert" ? constant?.rawData.length ? Buffer.from(constant.rawData).readFloatLE() : constant?.floatData[0] : node.attribute.find(attribute => attribute.name === "epsilon")?.f;
		assert(epsilon && epsilon > 0 && epsilon < 0.01);
		return { weight: array(name + ".weight"), bias: array(name + ".bias"), epsilon };
	};
	const embedding = (name: string): EmbeddingWeights => kind === "camembert" ? { weight: array(name + "_quantized"), scale: scalar(name + "_scale"), zero: scalar(name + "_zero_point") } : { weight: array(name), scale: 1, zero: 0 };
	const linear = (name: string, path: string): DenseWeights => {
		if (kind === "electra") return { weight: array(name + ".weight"), bias: array(name + ".bias") };
		const node = nodes.find(item => item.name === path + "/MatMul_quant");
		assert(node?.input && node.opType === "MatMulInteger", `Projection absente : ${path}`);
		const weight = tensor(node.input[1]), [inner, columns] = weight.dims.map(Number);
		assert(weight.dataType === 3 && weight.dims.length === 2);
		assert(bytes(node.input[3]).every(value => value === 0), "Décalage des poids non nul.");
		const source = new Int8Array(bytes(weight.name).buffer, bytes(weight.name).byteOffset, inner * columns);
		const transposed = new Int8Array(source.length), sums = new Int32Array(columns);
		for (let column = 0; column < columns; column++) for (let row = 0; row < inner; row++) { const value = source[row * columns + column]; transposed[column * inner + row] = value; sums[column] += value; }
		return {
			weight: append(new Uint8Array(transposed.buffer), "i8", [columns, inner]), bias: array(name + ".bias"),
			scale: array(weight.name.replace(/_quantized$/, "_scale")), sums: append(new Uint8Array(sums.buffer), "i32", [columns]),
		};
	};
	const layers: LayerWeights[] = [];
	for (let index = 0; index < (kind === "camembert" ? 12 : 6); index++) {
		const prefix = `${weightPrefix}.encoder.layer.${index}`, path = `${nodePrefix}/encoder/layer.${index}`;
		layers.push({
			query: linear(prefix + ".attention.self.query", path + "/attention/self/query"), key: linear(prefix + ".attention.self.key", path + "/attention/self/key"), value: linear(prefix + ".attention.self.value", path + "/attention/self/value"),
			attention: linear(prefix + ".attention.output.dense", path + "/attention/output/dense"), attentionNorm: norm(prefix + ".attention.output.LayerNorm", path + "/attention/output/LayerNorm"),
			intermediate: linear(prefix + ".intermediate.dense", path + "/intermediate/dense"), output: linear(prefix + ".output.dense", path + "/output/dense"), outputNorm: norm(prefix + ".output.LayerNorm", path + "/output/LayerNorm"),
		});
	}
	const model: ModelData = {
		version: 1, kind, hidden: kind === "camembert" ? 768 : 256, heads: kind === "camembert" ? 12 : 4,
		embeddings: {
			word: embedding(weightPrefix + ".embeddings.word_embeddings.weight"), position: embedding(weightPrefix + ".embeddings.position_embeddings.weight"), token: embedding(weightPrefix + ".embeddings.token_type_embeddings.weight"),
			norm: norm(weightPrefix + ".embeddings.LayerNorm", nodePrefix + "/embeddings/LayerNorm"),
		}, layers,
	};
	if (kind === "camembert") model.head = { dense: linear("lm_head.dense", "/lm_head/dense"), norm: norm("lm_head.layer_norm", "/lm_head/layer_norm"), bias: array("lm_head.bias") };
	else {
		model.projection = linear("model.electra.embeddings_project", "/model/electra/embeddings_project");
		model.classifiers = Object.fromEntries(["VirguleManquanteGeneraleDevant", "MotsManquantsGeneralDevant", "est", "ou", "ces"].map(head => {
			const prefix = `model.tetes.${head}`, path = `/model/${head}`;
			return [head, { first: linear(prefix + ".layers.0", path + "/layers.0"), second: linear(prefix + ".layers.1.dense", path + "/layers.1/dense"), norm: norm(prefix + ".layers.1.LayerNorm", path + "/layers.1/LayerNorm"), output: linear(prefix + ".output", path + "/output") }];
		}));
	}
	const weights = Buffer.concat(chunks), root = new URL(kind === "camembert" ? "./" : "electra/", directory);
	await mkdir(new URL(kind === "camembert" ? "onnx/" : "./", root), { recursive: true });
	await writeFile(new URL("model.json", root), JSON.stringify(model) + "\n");
	if (kind === "camembert") {
		await writeFile(new URL("onnx/weights-0.bin", root), weights.subarray(0, 64 * 1024 * 1024));
		await writeFile(new URL("onnx/weights-1.bin", root), weights.subarray(64 * 1024 * 1024));
	} else {
		await writeFile(new URL("weights.bin", root), weights);
		const files = [];
		for (const path of specializedFiles) {
			const bytes = await readFile(new URL(path, directory));
			files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
		}
		await writeFile(new URL("pack.json", directory), JSON.stringify({ version: 1, architecture: "finition-electra-v1", name: "Modèle local", files }) + "\n");
	}
	if (kind === "camembert") {
		const provenance = new URL("source.json", directory);
		const metadata = JSON.parse(await readFile(provenance, "utf8")) as { hashes: Record<string, string>; inference?: string };
		for (const obsolete of ["runtime.wasm", "electra/model.json", "electra/weights.bin"]) delete metadata.hashes[obsolete];
		metadata.inference = "Calcul Finition intégré au plugin ; seuls les poids et données sont distribués séparément.";
		for (const file of ["model.json", "onnx/weights-0.bin", "onnx/weights-1.bin"]) metadata.hashes[file] = createHash("sha256").update(await readFile(new URL(file, directory))).digest("hex");
		await writeFile(provenance, JSON.stringify(metadata, null, 2) + "\n");
	}
	process.stdout.write(`${kind} : ${weights.length} octets de poids, code d’inférence intégré.\n`);
}

async function main() {
	const root = new URL("../plugin/data/finition-neural/", import.meta.url);
	await convertModel("camembert", Buffer.concat(await Promise.all(["onnx/model-0.bin", "onnx/model-1.bin"].map(name => readFile(new URL(name, root))))), new URL("../ressources/camembert/", import.meta.url));
	const privateRoot = new URL("../Antidote/model/", import.meta.url);
	await convertModel("electra", await readFile(new URL("electra/model.onnx", privateRoot)), privateRoot);
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) void main().catch((error: unknown) => { console.error(error); process.exit(1); });
