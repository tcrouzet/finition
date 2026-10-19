import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as process from "node:process";
import { Buffer } from "node:buffer";
import { neuralModelParts } from "../plugin/modes/finition-corrector/neural-assets";
import { optimizeNeuralModel } from "./optimize-finition-neural";
import { convertModel } from "./convert-finition-models";

async function main() {
  const root = new URL("../resources/camembert/", import.meta.url);
  const preparation = new URL("./neural/camembert/", import.meta.url);
  const revision = "c74ca76d8310cfe6ccf9fc51671716e494a66179";
  const model = "Xenova/camembert-base";
  const files = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_quantized.onnx", "README.md"];
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const existing = file === "onnx/model_quantized.onnx" ? await Promise.all(neuralModelParts.map(name => readFile(new URL(name, preparation)))).then(parts => Buffer.concat(parts)).catch((error: unknown) => { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; return null; }) : null;
    const response = existing ? null : await fetch(`https://huggingface.co/${model}/resolve/${revision}/${file}`, { signal: AbortSignal.timeout(180000) });
    if (response && !response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    let bytes = existing ?? Buffer.from(await response!.arrayBuffer());
    if (file === "onnx/model_quantized.onnx") bytes = Buffer.from(optimizeNeuralModel(bytes));
    const outputs: Array<[string, Buffer]> = file === "onnx/model_quantized.onnx" ? neuralModelParts.map((name, i) => [name, bytes.subarray(i * 64 * 1024 * 1024, (i + 1) * 64 * 1024 * 1024)]) : [[file, bytes]];
    for (const [name, part] of outputs) {
      const path = new URL(name, name.startsWith("onnx/") || name === "config.json" || name === "special_tokens_map.json" ? preparation : root);
      await mkdir(dirname(path.pathname), { recursive: true });
      await writeFile(path, part);
      hashes[name] = createHash("sha256").update(part).digest("hex");
    }
    process.stdout.write(`${file}: ${bytes.length} octets\n`);
  }
  for (const [source, destination] of [
    ["@huggingface/transformers/LICENSE", "TRANSFORMERS-LICENSE.txt"],
  ]) {
    const from = new URL(`../node_modules/${source}`, import.meta.url);
    const to = new URL(destination, root);
    await copyFile(from, to);
    hashes[destination] = createHash("sha256").update(await readFile(to)).digest("hex");
  }
  const license = await fetch("https://raw.githubusercontent.com/microsoft/onnxruntime/8d85527a010e294a26b274749f74294b2a32cec5/LICENSE", { signal: AbortSignal.timeout(30000) });
  if (!license.ok) throw new Error(`Licence ONNX: HTTP ${license.status}`);
  await writeFile(new URL("ONNX-LICENSE.txt", root), await license.text());
  await writeFile(new URL("source.json", root), JSON.stringify({ model, revision, license: "MIT", upstream: "https://huggingface.co/almanach/camembert-base", transformers: "4.3.1", optimization: "Projection du vocabulaire limitée au mot masqué ; poids et calcul contextuel conservés.", hashes }, null, 2) + "\n");
  await convertModel("camembert", Buffer.concat(await Promise.all(neuralModelParts.map(name => readFile(new URL(name, preparation))))), root);
  process.stdout.write("Modèle local prêt ; aucune connexion utilisée par le correcteur.\n");
}
void main().catch((error: unknown) => { console.error(error); process.exit(1); });
