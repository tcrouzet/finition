import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as process from "node:process";
import { onnx } from "../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx";
import { neuralModelParts } from "../plugin/modes/finition-corrector/neural-assets";

const originalHash = "f649e5b16ffa6dc61f67f19e4b80cad53a853b5407a57139cff6741f55820783";
const optimizedHash = "f91efc744c68a8841794ce64e81c22e96417449cebc5546b31630c954ed49c1e";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function optimizeNeuralModel(bytes: Uint8Array): Uint8Array {
  if (hash(bytes) === optimizedHash) return bytes;
  assert.equal(hash(bytes), originalHash, "Modèle source inattendu.");
  const model = onnx.ModelProto.decode(bytes), graph = onnx.GraphProto.create(model.graph!);
  model.graph = graph;
  assert.equal(Number(model.opsetImport.find(item => !item.domain)?.version), 11);
  const decoder = graph.node.find(node => node.name === "/lm_head/decoder/MatMul");
  assert(decoder?.opType === "MatMul" && decoder.input && decoder.output && decoder.input[0] === "/lm_head/layer_norm/Add_1_output_0");
  const decoderOutput = decoder.output[0];
  graph.initializer.push(onnx.TensorProto.create({ name: "finition_mask_id", dataType: 7, int64Data: [32004] }));
  const nodes = [
    { opType: "Equal", input: ["input_ids", "finition_mask_id"], output: ["finition_mask"] },
    { opType: "NonZero", input: ["finition_mask"], output: ["finition_mask_indices"] },
    { opType: "Transpose", input: ["finition_mask_indices"], output: ["finition_mask_rows"], attribute: [{ name: "perm", type: 7, ints: [1, 0] }] },
    { opType: "Unsqueeze", input: ["finition_mask_rows"], output: ["finition_mask_positions"], attribute: [{ name: "axes", type: 7, ints: [1] }] },
    { opType: "GatherND", input: [decoder.input[0], "finition_mask_positions"], output: ["finition_mask_hidden"] },
  ];
  graph.node.splice(graph.node.indexOf(decoder), 0, ...nodes.map(node => onnx.NodeProto.create(node)));
  decoder.input[0] = "finition_mask_hidden";
  for (const value of [...graph.output, ...graph.valueInfo.filter(value => value.name === decoderOutput)]) {
    const dimensions = value.type?.tensorType?.shape?.dim;
    if (dimensions) {
      assert.equal(dimensions.length, 3);
      dimensions[1] = onnx.TensorShapeProto.Dimension.create({ dimValue: 1 });
    }
  }
  assert.equal(onnx.ModelProto.verify(model), null);
  const optimized = onnx.ModelProto.encode(model).finish();
  assert.equal(hash(optimized), optimizedHash);
  return optimized;
}

async function main() {
  const root = new URL("./neural/camembert/", import.meta.url);
  const original = Buffer.concat(await Promise.all(neuralModelParts.map(file => readFile(new URL(file, root)))));
  const optimized = optimizeNeuralModel(original);
  const provenance = new URL("../resources/camembert/source.json", import.meta.url);
  const source = JSON.parse(await readFile(provenance, "utf8")) as { hashes: Record<string, string>; optimization?: string };
  for (const [index, file] of neuralModelParts.entries()) {
    const part = optimized.subarray(index * 64 * 1024 * 1024, (index + 1) * 64 * 1024 * 1024);
    await writeFile(new URL(file, root), part);
    source.hashes[file] = hash(part);
  }
  source.optimization = "Projection du vocabulaire limitée au mot masqué ; poids et calcul contextuel conservés.";
  await writeFile(provenance, JSON.stringify(source, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ original: hash(original), optimized: hash(optimized), bytes: optimized.byteLength }) + "\n");
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) void main().catch((error: unknown) => { console.error(error); process.exit(1); });
