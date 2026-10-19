import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as process from "node:process";
import { Buffer } from "node:buffer";
import { neuralModelParts } from "../plugin/modes/finition-corrector/neural-assets";
import { convertModel } from "./convert-finition-models";
import { restoreCamembertV2MLM, camembertV2Revision, camembertV2OnnxRevision, camembertV2EncoderHash, camembertV2SourceBytes, camembertV2SourceHash, camembertV2ModelHash } from "./camembertv2-mlm";

async function main() {
  const root = new URL("../resources/camembert/", import.meta.url);
  const preparation = new URL("./neural/camembert/", import.meta.url);
  const upstream = `https://huggingface.co/almanach/camembertv2-base/resolve/${camembertV2Revision}/`;
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const get = async (url: string, expected: string, range?: number) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000), ...(range ? { headers: { Range: `bytes=0-${range - 1}` } } : {}) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, range);
    if (hash(bytes) !== expected) throw new Error(`Empreinte inattendue : ${url}`);
    return bytes;
  };
  const hashes: Record<string, string> = {};
  const files = {
    "config.json": "ae37c72814a8913efe40b78e6fea709d27c4e617e9d192787e7a2ac102d3ded5",
    "tokenizer.json": "9a73847b1816a4ba8f99a11e602fc983d717b3cc393696239b2a57d32adbedca",
    "tokenizer_config.json": "97d3f6f9628ffbf08fded0bed70f9f76f07b2d1e10bf62b2854eb53342963bb1",
    "special_tokens_map.json": "02febc01c792e198ba17c4e094a0cddc27f3cf96bc5754314f8f1cd854b4326c",
    "README.md": "a1d56583a9003815acec0038661a3787ac9d7927ef378b044d87d8dca013a54f",
  };
  for (const [file, expected] of Object.entries(files)) {
    const path = new URL(file, file === "config.json" || file === "special_tokens_map.json" ? preparation : root);
    const cached = await readFile(path).catch(() => null);
    const bytes = cached && hash(cached) === expected ? cached : await get(upstream + file, expected);
    await mkdir(dirname(path.pathname), { recursive: true });
    await writeFile(path, bytes); hashes[file] = expected;
  }
  const cached = await Promise.all(neuralModelParts.map(file => readFile(new URL(file, preparation)))).then(parts => Buffer.concat(parts)).catch(() => null);
  let model = cached;
  if (!model || hash(model) !== camembertV2ModelHash) {
    const encoder = await get(`https://huggingface.co/onnx-community/camembertv2-base/resolve/${camembertV2OnnxRevision}/onnx/model_quantized.onnx`, camembertV2EncoderHash);
    const sourceParts = ["mlm-source-0.bin", "mlm-source-1.bin"];
    const existing = await Promise.all(sourceParts.map(file => readFile(new URL(file, preparation)))).then(parts => Buffer.concat(parts)).catch(() => null);
    const source = existing && hash(existing) === camembertV2SourceHash ? existing : await get(upstream + "model.safetensors", camembertV2SourceHash, camembertV2SourceBytes);
    for (const [index, file] of sourceParts.entries()) await writeFile(new URL(file, preparation), source.subarray(index * 64 * 1024 * 1024, (index + 1) * 64 * 1024 * 1024));
    model = Buffer.from(restoreCamembertV2MLM(encoder, source));
  }
  await mkdir(new URL("onnx/", preparation), { recursive: true });
  for (const [index, file] of neuralModelParts.entries()) {
    const part = model.subarray(index * 96 * 1024 * 1024, (index + 1) * 96 * 1024 * 1024);
    await writeFile(new URL(file, preparation), part); hashes[file] = hash(part);
  }
  await copyFile(new URL("../node_modules/@huggingface/transformers/LICENSE", import.meta.url), new URL("TRANSFORMERS-LICENSE.txt", root));
  const licensePath = new URL("ONNX-LICENSE.txt", root);
  const licenseHash = "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c";
  const license = await readFile(licensePath).catch(() => null);
  if (!license || hash(license) !== licenseHash) await writeFile(licensePath, await get("https://raw.githubusercontent.com/microsoft/onnxruntime/8d85527a010e294a26b274749f74294b2a32cec5/LICENSE", licenseHash));
  hashes["TRANSFORMERS-LICENSE.txt"] = hash(await readFile(new URL("TRANSFORMERS-LICENSE.txt", root)));
  await writeFile(new URL("source.json", root), JSON.stringify({ model: "almanach/camembertv2-base", revision: camembertV2Revision, license: "MIT", upstream: "https://huggingface.co/almanach/camembertv2-base", encoder: { model: "onnx-community/camembertv2-base", revision: camembertV2OnnxRevision, sha256: camembertV2EncoderHash }, mlmSource: { bytes: camembertV2SourceBytes, sha256: camembertV2SourceHash, checkpointSha256: "632617234a6fa64239b427be9a5325c930a26f3f3c11ede90d3040cf53d6b6dc" }, transformers: "4.3.1", optimization: "Tête MLM officielle restaurée avec projection limitée aux mots masqués ; embeddings, décodeur et activations en précision d’origine ; poids des projections internes quantifiés.", hashes }, null, 2) + "\n");
  await convertModel("camembert", model, root);
  process.stdout.write("CamemBERTv2 local prêt ; aucune connexion utilisée par le correcteur.\n");
}
void main().catch((error: unknown) => { console.error(error); process.exit(1); });
