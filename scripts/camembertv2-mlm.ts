import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { onnx } from "../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx";

export const camembertV2Revision = "42096e44334c6d256ef099c5d8936f9e272a938f";
export const camembertV2OnnxRevision = "6feb53a77def2a26b1dcd49ec3b70799411a8ba6";
export const camembertV2EncoderHash = "1e83a09a9f74afb42501f895dd44b3f504da8a72aaef9ae0937e3550789fd442";
export const camembertV2SourceBytes = 106353408;
export const camembertV2SourceHash = "f722d18cd78c7a4462701df18cf30d9a95efb58dfd39e13f27e0862cc635d319";
export const camembertV2ModelHash = "de1c6e282e63f53f1230783f44555c7dedf7367d6d79c89d3839eeaea3f443d3";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function restoreCamembertV2MLM(encoder: Uint8Array, head: Uint8Array): Uint8Array {
	assert.equal(hash(encoder), camembertV2EncoderHash, "Encodeur CamemBERTv2 inattendu.");
	assert.equal(hash(head), camembertV2SourceHash, "Tête MLM et embeddings CamemBERTv2 inattendus.");
	const model = onnx.ModelProto.decode(encoder), graph = onnx.GraphProto.create(model.graph!);
	assert.deepEqual(graph.output.map(value => value.name), ["last_hidden_state"]);
	assert.equal(Number(model.opsetImport.find(value => !value.domain)?.version), 14);
	const headerLength = Number(Buffer.from(head).readBigUInt64LE()), offset = 8 + headerLength;
	const metadata = JSON.parse(new TextDecoder().decode(head.subarray(8, offset))) as Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>;
	for (const [name, shape] of Object.entries({ "lm_head.dense.weight": [768, 768], "lm_head.dense.bias": [768], "lm_head.layer_norm.weight": [768], "lm_head.layer_norm.bias": [768], "lm_head.bias": [32768] })) {
		const tensor = metadata[name];
		assert.equal(tensor.dtype, "F32"); assert.deepEqual(tensor.shape, shape);
		assert(tensor.data_offsets[1] + offset <= head.length);
		graph.initializer.push(onnx.TensorProto.create({ name, dims: shape, dataType: 1, rawData: head.subarray(offset + tensor.data_offsets[0], offset + tensor.data_offsets[1]) }));
	}
	for (const [name, rows] of [["word_embeddings", 32768], ["position_embeddings", 1025], ["token_type_embeddings", 1]] as const) {
		const target = `embeddings.${name}.weight`, tensor = metadata[`roberta.${target}`];
		assert.equal(tensor.dtype, "F32"); assert.deepEqual(tensor.shape, [rows, 768]);
		assert(tensor.data_offsets[1] + offset <= head.length);
		const gather = graph.node.find(node => node.opType === "Gather" && node.input?.[0] === target + "_quantized");
		const dequantize = graph.node.find(node => node.opType === "DequantizeLinear" && node.input?.[0] === gather?.output?.[0]);
		assert(gather?.input && gather.output && dequantize?.output);
		gather.input[0] = target; gather.output[0] = dequantize.output[0];
		graph.node.splice(graph.node.indexOf(dequantize), 1);
		graph.initializer = graph.initializer.filter(value => ![target + "_quantized", target + "_scale", target + "_zero_point"].includes(value.name ?? ""));
		graph.initializer.push(onnx.TensorProto.create({ name: target, dims: tensor.shape, dataType: 1, rawData: head.subarray(offset + tensor.data_offsets[0], offset + tensor.data_offsets[1]) }));
	}
	// Preserve float activations so tiny rounding differences cannot change later quantization bins.
	for (const integer of [...graph.node].filter(node => node.opType === "MatMulInteger")) {
		const quantize = graph.node.find(node => node.opType === "DynamicQuantizeLinear" && node.output?.[0] === integer.input?.[0]);
		const cast = graph.node.find(node => node.opType === "Cast" && node.input?.[0] === integer.output?.[0]);
		const scaled = graph.node.find(node => node.opType === "Mul" && node.input?.includes(cast?.output?.[0] ?? ""));
		assert(integer.input && quantize?.input && scaled?.output);
		const output = scaled.output[0], name = integer.name!;
		scaled.output[0] += "_integer_unused";
		graph.node.splice(graph.node.indexOf(scaled) + 1, 0,
			onnx.NodeProto.create({ name: name + "_weights", opType: "DequantizeLinear", input: [integer.input[1], integer.input[1].replace(/_quantized$/u, "_scale"), integer.input[3]], output: [name + "_float_weights"], attribute: [{ name: "axis", type: 2, i: 1 }] }),
			onnx.NodeProto.create({ name: name + "_float", opType: "MatMul", input: [quantize.input[0], name + "_float_weights"], output: [output] }));
	}
	for (const [name, value] of Object.entries({ sqrt2: Math.SQRT2, one: 1, half: 0.5, two: 2, "/lm_head/layer_norm/epsilon": 1e-7 })) graph.initializer.push(onnx.TensorProto.create({ name, dataType: 1, floatData: [value] }));
	graph.initializer.push(onnx.TensorProto.create({ name: "mask_id", dataType: 7, int64Data: [4] }), onnx.TensorProto.create({ name: "mask_axes", dataType: 7, dims: [1], int64Data: [1] }));
	const add = (name: string, opType: string, input: string[], output: string, attribute: onnx.IAttributeProto[] = []) => graph.node.push(onnx.NodeProto.create({ name, opType, input, output: [output], attribute }));
	add("mask_equal", "Equal", ["input_ids", "mask_id"], "mask");
	add("mask_nonzero", "NonZero", ["mask"], "mask_indices");
	add("mask_transpose", "Transpose", ["mask_indices"], "mask_rows", [{ name: "perm", type: 7, ints: [1, 0] }]);
	add("mask_unsqueeze", "Unsqueeze", ["mask_rows", "mask_axes"], "mask_positions");
	add("mask_gather", "GatherND", ["last_hidden_state", "mask_positions"], "mask_hidden");
	add("/lm_head/dense/Transpose", "Transpose", ["lm_head.dense.weight"], "dense_weight", [{ name: "perm", type: 7, ints: [1, 0] }]);
	add("/lm_head/dense/MatMul", "MatMul", ["mask_hidden", "dense_weight"], "dense_product");
	add("/lm_head/dense/Add", "Add", ["dense_product", "lm_head.dense.bias"], "dense");
	add("gelu_div", "Div", ["dense", "sqrt2"], "gelu_input");
	add("gelu_erf", "Erf", ["gelu_input"], "gelu_erf");
	add("gelu_add", "Add", ["gelu_erf", "one"], "gelu_plus");
	add("gelu_mul", "Mul", ["dense", "gelu_plus"], "gelu_product");
	add("gelu_half", "Mul", ["gelu_product", "half"], "gelu");
	const axes = [{ name: "axes", type: 7, ints: [-1] }];
	add("norm_mean", "ReduceMean", ["gelu"], "mean", axes);
	add("norm_sub", "Sub", ["gelu", "mean"], "centered");
	add("norm_pow", "Pow", ["centered", "two"], "squared");
	add("norm_variance", "ReduceMean", ["squared"], "variance", axes);
	add("/lm_head/layer_norm/Add", "Add", ["variance", "/lm_head/layer_norm/epsilon"], "variance_epsilon");
	add("norm_sqrt", "Sqrt", ["variance_epsilon"], "deviation");
	add("norm_div", "Div", ["centered", "deviation"], "normalized");
	add("norm_mul", "Mul", ["normalized", "lm_head.layer_norm.weight"], "scaled");
	add("norm_bias", "Add", ["scaled", "lm_head.layer_norm.bias"], "head_hidden");
	// The decoder shares the original word embeddings; coarse embedding quantization changes lexical decisions.
	add("decoder_transpose", "Transpose", ["embeddings.word_embeddings.weight"], "decoder_weight", [{ name: "perm", type: 7, ints: [1, 0] }]);
	add("decoder_matmul", "MatMul", ["head_hidden", "decoder_weight"], "decoder_product");
	add("decoder_bias", "Add", ["decoder_product", "lm_head.bias"], "logits");
	graph.output = [onnx.ValueInfoProto.create({ name: "logits", type: { tensorType: { elemType: 1, shape: { dim: [{ dimParam: "batch" }, { dimValue: 1 }, { dimValue: 32768 }] } } } })];
	model.graph = graph;
	assert.equal(onnx.ModelProto.verify(model), null);
	const bytes = onnx.ModelProto.encode(model).finish();
	assert.equal(hash(bytes), camembertV2ModelHash);
	return bytes;
}
