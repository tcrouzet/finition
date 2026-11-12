import { createMatrixKernel } from "./matrix";
import type { ReadNeuralAsset } from "./neural-assets";

export interface WeightArray { offset: number; dims: number[]; type: "f32" | "i8" | "u8" | "i32" }
export interface DenseWeights { weight: WeightArray; bias: WeightArray; scale?: WeightArray; sums?: WeightArray }
export interface NormWeights { weight: WeightArray; bias: WeightArray; epsilon: number }
export interface EmbeddingWeights { weight: WeightArray; scale: number; zero: number }
export interface LayerWeights {
	query: DenseWeights; key: DenseWeights; value: DenseWeights; attention: DenseWeights;
	attentionNorm: NormWeights; intermediate: DenseWeights; output: DenseWeights; outputNorm: NormWeights;
}
export interface ModelData {
	version: 1; kind: "camembert" | "electra"; hidden: number; heads: number;
	maskTokenId?: number; padTokenId?: number;
	floatActivations?: boolean;
	embeddings: { word: EmbeddingWeights; position: EmbeddingWeights; token: EmbeddingWeights; norm: NormWeights };
	projection?: DenseWeights;
	layers: LayerWeights[];
	head?: { dense: DenseWeights; norm: NormWeights; bias: WeightArray };
	classifiers?: Record<string, { first: DenseWeights; second: DenseWeights; norm: NormWeights; output: DenseWeights }>;
}

const scratchBytes = 8 * 1024 * 1024;
const roundEven = (value: number): number => { const floor = Math.floor(value); return value - floor === 0.5 ? floor + (floor & 1) : Math.round(value); };
const f32 = Math.fround;

export class FinitionModel {
	readonly maskTokenId: number;
	readonly padTokenId: number;
	get maxBatchSize(): number { return this.data.floatActivations === true ? 16 : 4; }
	private memory: WebAssembly.Memory;
	private kernel: ReturnType<typeof createMatrixKernel>;
	private base: number;
	private limit: number;
	private views = new WeakMap<WeightArray, Float32Array | Int32Array | Int8Array | Uint8Array>();
	private quantized = new WeakMap<Float32Array, { data: Uint8Array; scale: number; zero: number }>();

	constructor(private data: ModelData, weights: Uint8Array) {
		this.maskTokenId = data.maskTokenId ?? 32004;
		this.padTokenId = data.padTokenId ?? 1;
		const vocabulary = data.embeddings?.word?.weight?.dims?.[0];
		const tokensValid = vocabulary === 32005 && this.maskTokenId === 32004 && this.padTokenId === 1 || data.kind === "camembert" && vocabulary === 32768 && this.maskTokenId === 4 && this.padTokenId === 0;
		if (data.version !== 1 || !["camembert", "electra"].includes(data.kind) || data.hidden !== (data.kind === "camembert" ? 768 : 256) || data.heads !== (data.kind === "camembert" ? 12 : 4) || !Array.isArray(data.layers) || data.layers.length !== (data.kind === "camembert" ? 12 : 6) || !tokensValid || data.floatActivations !== undefined && typeof data.floatActivations !== "boolean" || data.embeddings.word.weight.dims[1] !== (data.kind === "camembert" ? 768 : 128) || weights.length > 256 * 1024 * 1024) throw new Error("Architecture neuronale incompatible.");
		this.limit = weights.length;
		this.base = Math.ceil(weights.length / 16) * 16;
		const pages = Math.ceil((this.base + scratchBytes * 3 + 16384) / 65536);
		this.memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
		new Uint8Array(this.memory.buffer).set(weights);
		this.kernel = createMatrixKernel(this.memory);
	}

	private view(spec: WeightArray): Float32Array | Int32Array | Int8Array | Uint8Array {
		const cached = this.views.get(spec);
		if (cached) return cached;
		if (!spec || !Array.isArray(spec.dims) || spec.dims.length > 2 || spec.dims.some(n => !Number.isSafeInteger(n) || n < 1 || n > 64000) || !Number.isSafeInteger(spec.offset) || spec.offset < 0 || !["f32", "i32", "i8", "u8"].includes(spec.type)) throw new Error("Tenseur neuronal invalide.");
		const length = spec.dims.reduce((a, b) => a * b, 1), size = spec.type === "f32" || spec.type === "i32" ? 4 : 1;
		if (spec.offset % size || spec.offset + length * size > this.limit) throw new Error("Poids neuronaux tronqués.");
		const array = spec.type === "f32" ? new Float32Array(this.memory.buffer, spec.offset, length) : spec.type === "i32" ? new Int32Array(this.memory.buffer, spec.offset, length) : spec.type === "i8" ? new Int8Array(this.memory.buffer, spec.offset, length) : new Uint8Array(this.memory.buffer, spec.offset, length);
		this.views.set(spec, array);
		return array;
	}

	private floats(spec: WeightArray): Float32Array {
		const array = this.view(spec);
		if (!(array instanceof Float32Array)) throw new Error("Poids flottants attendus.");
		return array;
	}

	private quantize(input: Float32Array) {
		let result = this.quantized.get(input);
		if (result) return result;
		let min = 0, max = 0;
		for (const value of input) { min = Math.min(min, value); max = Math.max(max, value); }
		const scale = f32((max - min) / 255) || 1;
		const zero = Math.min(255, Math.max(0, roundEven(-min / scale)));
		const values = new Uint8Array(input.length);
		for (let i = 0; i < input.length; i++) values[i] = Math.min(255, Math.max(0, roundEven(f32(input[i] / scale)) + zero));
		result = { data: values, scale, zero };
		this.quantized.set(input, result);
		return result;
	}

	private linear(input: Float32Array, params: DenseWeights): Float32Array {
		const weight = this.view(params.weight), bias = this.floats(params.bias);
		const [columns, inner] = params.weight.dims, rows = input.length / inner;
		if (!Number.isSafeInteger(rows) || rows < 1 || rows > 520 || columns !== bias.length || input.byteLength > scratchBytes || rows * columns * 4 > scratchBytes) throw new Error("Dimensions de calcul invalides.");
		const output = this.base + scratchBytes * 2;
		if (weight instanceof Int8Array) {
			if (!params.scale || !params.sums || this.floats(params.scale).length !== columns || !(this.view(params.sums) instanceof Int32Array) || this.view(params.sums).length !== columns) throw new Error("Quantification neuronale invalide.");
			if (this.data.floatActivations === true) {
				new Float32Array(this.memory.buffer, this.base, input.length).set(input);
				this.kernel.mixedMatrix(this.base, params.weight.offset, output, rows, columns, inner, params.bias.offset, params.scale.offset, this.base + scratchBytes);
			} else {
				const q = this.quantize(input);
				new Uint8Array(this.memory.buffer, this.base, input.length).set(q.data);
				this.kernel.integerMatrix(this.base, params.weight.offset, output, rows, columns, inner, params.bias.offset, params.sums.offset, params.scale.offset, q.zero, q.scale);
			}
		} else if (weight instanceof Float32Array) {
			new Float32Array(this.memory.buffer, this.base, input.length).set(input);
			this.kernel.floatMatrix(this.base, params.weight.offset, output, rows, columns, inner, params.bias.offset);
		} else throw new Error("Matrice neuronale incompatible.");
		return new Float32Array(this.memory.buffer, output, rows * columns).slice();
	}

	private norm(input: Float32Array, params: NormWeights): Float32Array {
		const scale = this.floats(params.weight), bias = this.floats(params.bias), width = scale.length;
		if (bias.length !== width || input.length % width || !(params.epsilon > 0) || params.epsilon > 0.01) throw new Error("Normalisation neuronale invalide.");
		const output = new Float32Array(input.length);
		for (let row = 0; row < input.length; row += width) {
			let mean = 0, variance = 0;
			for (let i = 0; i < width; i++) mean += input[row + i];
			mean = f32(mean / width);
			for (let i = 0; i < width; i++) { const delta = f32(input[row + i] - mean); variance += f32(delta * delta); }
			const deviation = f32(Math.sqrt(f32(f32(variance / width) + params.epsilon)));
			for (let i = 0; i < width; i++) output[row + i] = f32(f32(f32(input[row + i] - mean) / deviation) * scale[i]) + bias[i];
		}
		return output;
	}

	private gelu(input: Float32Array): Float32Array {
		// shortcut: erf approchée ; remplacer si les comparaisons numériques exigent une fonction exacte.
		return input.map(value => {
			const x = f32(value / Math.SQRT2), t = 1 / (1 + 0.3275911 * Math.abs(x));
			const erf = f32(Math.sign(x) * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)));
			return f32(f32(value * f32(1 + erf)) * 0.5);
		});
	}

	private embedding(params: EmbeddingWeights, index: number, output: Float32Array): void {
		const array = this.view(params.weight), [rows, width] = params.weight.dims;
		if (!Number.isInteger(index) || index < 0 || index >= rows || output.length !== width || !Number.isFinite(params.scale) || !Number.isFinite(params.zero)) throw new Error("Entrée neuronale invalide.");
		for (let i = 0; i < width; i++) output[i] = (array[index * width + i] - params.zero) * params.scale;
	}

	private attention(query: Float32Array, key: Float32Array, value: Float32Array, ids: number[][], length: number): Float32Array {
		const hidden = this.data.hidden, width = hidden / this.data.heads, output = new Float32Array(query.length);
		const a = this.base, b = a + scratchBytes, out = b + scratchBytes, zeroBias = out + scratchBytes;
		for (let batch = 0; batch < ids.length; batch++) for (let head = 0; head < this.data.heads; head++) {
			const q = new Float32Array(length * width), k = new Float32Array(q.length), v = new Float32Array(q.length);
			for (let row = 0; row < length; row++) for (let i = 0; i < width; i++) {
				const source = (batch * length + row) * hidden + head * width + i;
				q[row * width + i] = query[source]; k[row * width + i] = key[source]; v[i * length + row] = value[source];
			}
			new Float32Array(this.memory.buffer, a, q.length).set(q);
			new Float32Array(this.memory.buffer, b, k.length).set(k);
			this.kernel.floatMatrix(a, b, out, length, length, width, zeroBias);
			const scores = new Float32Array(this.memory.buffer, out, length * length);
			for (let row = 0; row < length; row++) {
				let max = -Infinity, sum = 0;
				for (let column = 0; column < length; column++) {
					const offset = row * length + column;
					scores[offset] = column >= ids[batch].length ? -3.4028234663852886e38 : scores[offset] / Math.sqrt(width);
					max = Math.max(max, scores[offset]);
				}
				for (let column = 0; column < length; column++) { const offset = row * length + column; scores[offset] = Math.exp(f32(scores[offset] - max)); sum += scores[offset]; }
				for (let column = 0; column < length; column++) scores[row * length + column] /= sum;
			}
			new Float32Array(this.memory.buffer, a, scores.length).set(scores);
			new Float32Array(this.memory.buffer, b, v.length).set(v);
			this.kernel.floatMatrix(a, b, out, length, width, length, zeroBias);
			const context = new Float32Array(this.memory.buffer, out, length * width);
			for (let row = 0; row < length; row++) output.set(context.subarray(row * width, (row + 1) * width), (batch * length + row) * hidden + head * width);
		}
		return output;
	}

	private forward(ids: number[][]): { hidden: Float32Array; length: number } {
		if (!ids.length || ids.length > this.maxBatchSize || ids.some(row => !row.length || row.length > 130) || ids.length * Math.max(...ids.map(row => row.length)) > 520) throw new Error("Lot neuronal invalide.");
		this.quantized = new WeakMap();
		const length = Math.max(...ids.map(row => row.length)), embeddings = this.data.embeddings, width = embeddings.word.weight.dims[1];
		const input = new Float32Array(ids.length * length * width), word = new Float32Array(width), position = new Float32Array(width), token = new Float32Array(width);
		this.embedding(embeddings.token, 0, token);
		for (let batch = 0; batch < ids.length; batch++) {
			let currentPosition = this.padTokenId;
			for (let row = 0; row < length; row++) {
				const id = ids[batch][row] ?? this.padTokenId;
				this.embedding(embeddings.word, id, word);
				this.embedding(embeddings.position, this.data.kind === "camembert" ? id === this.padTokenId ? this.padTokenId : ++currentPosition : row, position);
				for (let i = 0; i < width; i++) input[(batch * length + row) * width + i] = f32(word[i] + token[i]) + position[i];
			}
		}
		let hidden = this.norm(input, embeddings.norm);
		if (this.data.projection) hidden = this.linear(hidden, this.data.projection);
		for (const layer of this.data.layers) {
			const context = this.attention(this.linear(hidden, layer.query), this.linear(hidden, layer.key), this.linear(hidden, layer.value), ids, length);
			const projected = this.linear(context, layer.attention);
			for (let i = 0; i < hidden.length; i++) projected[i] += hidden[i];
			hidden = this.norm(projected, layer.attentionNorm);
			const intermediate = this.gelu(this.linear(hidden, layer.intermediate)), result = this.linear(intermediate, layer.output);
			for (let i = 0; i < hidden.length; i++) result[i] += hidden[i];
			hidden = this.norm(result, layer.outputNorm);
		}
		return { hidden, length };
	}

	score(ids: number[][], candidates: number[][]): number[][] {
		if (this.data.kind !== "camembert" || !this.data.head || candidates.length !== ids.length) throw new Error("Tête lexicale indisponible.");
		const { hidden, length } = this.forward(ids), head = this.data.head;
		const width = this.data.hidden, masks = ids.map(row => row.indexOf(this.maskTokenId));
		if (masks.some((mask, row) => mask < 0 || ids[row].lastIndexOf(this.maskTokenId) !== mask) || candidates.some(row => row.length > 256)) throw new Error("Mot masqué invalide.");
		const compact = head.dense.weight.type === "f32";
		const selected = compact ? new Float32Array(ids.length * width) : hidden;
		if (compact) for (const [batch, mask] of masks.entries()) selected.set(hidden.subarray((batch * length + mask) * width, (batch * length + mask + 1) * width), batch * width);
		const normalized = this.norm(this.gelu(this.linear(selected, head.dense)), head.norm), bias = this.floats(head.bias);
		const a = this.base, b = a + scratchBytes, vector = new Float32Array(width);
		return masks.map((mask, batch) => {
			const offset = (compact ? batch : batch * length + mask) * width;
			new Float32Array(this.memory.buffer, a, width).set(normalized.subarray(offset, offset + width));
			return candidates[batch].map(id => {
				this.embedding(this.data.embeddings.word, id, vector);
				new Float32Array(this.memory.buffer, b, width).set(vector);
				return f32(this.kernel.floatDot(a, b, width) + bias[id]);
			});
		});
	}

	classify(ids: number[]): Record<string, { dims: number[]; data: Float32Array }> {
		if (this.data.kind !== "electra" || !this.data.classifiers) throw new Error("Têtes contextuelles indisponibles.");
		const { hidden } = this.forward([ids]);
		return Object.fromEntries(Object.entries(this.data.classifiers).map(([name, head]) => {
			const first = this.linear(hidden, head.first).map(x => Math.max(0, x));
			const second = this.norm(this.linear(first, head.second), head.norm).map(x => Math.max(0, x));
			const data = this.linear(second, head.output);
			return [name, { dims: [1, ids.length, head.output.bias.dims[0]], data }];
		}));
	}
}

export async function loadModel(read: ReadNeuralAsset, kind: "camembert" | "electra"): Promise<FinitionModel> {
	const prefix = kind === "camembert" ? "" : "electra/";
	const description = await read(`${prefix}model.json`);
	if (description.byteLength > 65536) throw new Error("Description neuronale trop volumineuse.");
	const data: unknown = JSON.parse(new TextDecoder().decode(description));
	if (!data || typeof data !== "object" || !("kind" in data) || data.kind !== kind) throw new Error("Description neuronale invalide.");
	const names = kind === "camembert" ? ["onnx/weights-0.bin", "onnx/weights-1.bin"] : ["electra/weights.bin"];
	const parts = await Promise.all(names.map(read)), length = parts.reduce((n, part) => n + part.byteLength, 0);
	if (length > 256 * 1024 * 1024) throw new Error("Poids neuronaux trop volumineux.");
	const weights = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) { weights.set(new Uint8Array(part), offset); offset += part.byteLength; }
	return new FinitionModel(data as ModelData, weights);
}
