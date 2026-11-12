import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import * as process from "node:process";
import { env, InferenceSession, Tensor } from "onnxruntime-web/webgpu";
import { Tokenizer } from "@huggingface/tokenizers";
import { FinitionModel, loadModel, type ModelData } from "../plugin/modes/finition-corrector/model";

async function main() {
	env.wasm.numThreads = 1;
	const runtime = await readFile(new URL("../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", import.meta.url));
	env.wasm.wasmBinary = runtime;
	env.wasm.wasmPaths = { mjs: new URL("../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", import.meta.url).href };
	globalThis.fetch = async () => { throw new Error("Réseau interdit pendant la comparaison locale."); };
	for (const profile of ["electra", "camembert-v1", "camembert"] as const) {
		const kind = profile === "electra" ? "electra" : "camembert";
		const root = new URL(profile === "camembert-v1" ? "./neural/camembert-v1/" : "../resources/camembert/", import.meta.url);
		const read = async (name: string): Promise<ArrayBuffer> => {
			const directory = name.startsWith("electra/") ? new URL("../Antidote/model/", import.meta.url) : name.startsWith("onnx/") && profile !== "camembert-v1" ? new URL("./neural/camembert/", import.meta.url) : root;
			const value = await readFile(new URL(name, directory));
			return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
		};
		const model = await loadModel(read, kind);
		const source = kind === "electra" ? new Uint8Array(await read("electra/model.onnx")) : Buffer.concat((await Promise.all(["onnx/model-0.bin", "onnx/model-1.bin"].map(read))).map(bytes => new Uint8Array(bytes)));
		const reference = await InferenceSession.create(source, { executionProviders: ["wasm"] });
		try {
			const tokenizer = new Tokenizer(JSON.parse(new TextDecoder().decode(await read(kind === "electra" ? "electra/tokenizer.json" : "tokenizer.json"))) as object, kind === "electra" ? { unk_token: "<unk>", bos_token: "<s>", eos_token: "</s>", pad_token: "<pad>" } : JSON.parse(new TextDecoder().decode(await read("tokenizer_config.json"))) as object);
			if (profile === "camembert") {
				const examples = JSON.parse(await readFile(new URL("./neural/camembert/tokenizer-reference.json", import.meta.url), "utf8")) as Array<{ text: string; ids: number[] }>;
				for (const example of examples) assert.deepEqual(tokenizer.encode(example.text).ids, example.ids, `WordPiece différent : ${example.text}`);
				const description = JSON.parse(new TextDecoder().decode(await read("model.json"))) as ModelData;
				assert.throws(() => new FinitionModel({ ...description, padTokenId: 1 }, new Uint8Array()), /Architecture neuronale incompatible/);
			}
			const maskToken = model.maskTokenId === 4 ? "[MASK]" : "<mask>";
			const contexts = kind === "electra" ? ["Je me demande ou il habite.", "Quand il pleut je reste chez moi."] : ["Il va <mask> Paris demain.", "Les enfants <mask> dans le jardin.", "Ils <mask> terminé leur travail.", "Je me demande <mask> il habite."].map(text => text.replace("<mask>", maskToken));
			const groups = [["a", "à"], ["son", "sont"], ["on", "ont"], ["ou", "où"]];
			for (const batch of kind === "electra" ? contexts.map(text => [text]) : profile === "camembert" ? [contexts, Array.from({ length: 16 }, (_, index) => contexts[index % contexts.length])] : [contexts]) {
				const ids = batch.map(text => tokenizer.encode(text).ids), length = Math.max(...ids.map(row => row.length));
				const tokens = new BigInt64Array(ids.length * length).fill(BigInt(model.padTokenId)), masks = new BigInt64Array(tokens.length);
				for (const [row, values] of ids.entries()) { tokens.set(values.map(BigInt), row * length); masks.fill(BigInt(1), row * length, row * length + values.length); }
				const input = new Tensor("int64", tokens, [ids.length, length]), attention = new Tensor("int64", masks, [ids.length, length]);
				const outputs = await reference.run(kind === "electra" ? { inputIds: input, attentionMasks: attention } : { input_ids: input, attention_mask: attention });
				try {
					if (kind === "electra") {
						for (const [row, values] of ids.entries()) for (const [head, tensor] of Object.entries(model.classify(values))) {
							const expected = outputs[head].data as Float32Array, width = tensor.dims[2];
							for (let i = 0; i < tensor.data.length; i++) assert(Math.abs(tensor.data[i] - expected[row * length * width + i]) < 0.001, `${head} : score différent à ${i}`);
						}
					} else {
						const candidates = ids.map((_, row) => groups[row % groups.length].map(word => tokenizer.encode(word, { add_special_tokens: false }).ids[0]));
						const actual = model.score(ids, candidates), expected = outputs.logits.data as Float32Array, vocabulary = outputs.logits.dims[2];
						for (let row = 0; row < ids.length; row++) {
							const scores = candidates[row].map(id => expected[row * vocabulary + id]);
							assert.equal(actual[row][1] > actual[row][0], scores[1] > scores[0], "Choix lexical différent");
							assert.equal(Math.abs(actual[row][1] - actual[row][0]) >= Math.log(10), Math.abs(scores[1] - scores[0]) >= Math.log(10), `Seuil lexical différent ${profile}, ${batch[row]} : TS ${JSON.stringify(actual[row])}, ONNX ${JSON.stringify(scores)}`);
							if (profile === "camembert") for (let column = 0; column < scores.length; column++) assert(Math.abs(actual[row][column] - scores[column]) < 0.001, "Score CamemBERTv2 différent de la référence ONNX");
						}
					}
				} finally { input.dispose(); attention.dispose(); for (const output of Object.values(outputs)) output.dispose(); }
			}
		} finally { await reference.release(); }
	}
	await assert.rejects(loadModel(async () => new ArrayBuffer(65537), "camembert"), /trop volumineuse/);
	await assert.rejects(loadModel(async () => new TextEncoder().encode('{"kind":"autre"}').buffer, "camembert"), /invalide/);
	process.stdout.write("PASS: scores ELECTRA et choix/seuils CamemBERT v1/v2 comparés à ONNX local, lots, remplissage et validation des descriptions\n");
}
void main().then(() => process.exit(0), (error: unknown) => { console.error(error); process.exit(1); });
