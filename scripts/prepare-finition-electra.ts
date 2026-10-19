import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as process from "node:process";
import { Buffer } from "node:buffer";
import * as protobuf from "protobufjs";
import { convertModel } from "./convert-finition-models";

async function main() {
  const [modelPath, vocabularyPath, labelsPath] = process.argv.slice(2);
  if (!modelPath || !vocabularyPath || !labelsPath) throw new Error("Fournir les fichiers locaux : modèle ONNX, vocabulaire SentencePiece, classes.");
  const [model, vocabulary, classes] = await Promise.all([modelPath, vocabularyPath, labelsPath].map(path => readFile(path)));
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  if (hash(model) !== "eb24ed40a5d8f384c8c1eb3d3f3614080751fb92b6e1f165a059e4d1ca3ea998" || hash(vocabulary) !== "5f58ad5c488f2fb5830cdeeca38097413ef31ba8f54d78de262eb8dacceff4fe" || hash(classes) !== "6f30f47911a5b94149ff88f65aea29a7764d122619a090fbbb54d3997d3365fd") throw new Error("Empreinte des ressources locales invalide.");
  const schema = protobuf.parse('syntax="proto2"; message Model { message Piece { optional string piece=1; optional float score=2; optional int32 type=3 [default=1]; } repeated Piece pieces=1; message Normalizer { optional string name=1; optional bytes precompiled_charsmap=2; } optional Normalizer normalizer=3; }').root.lookupType("Model");
  const decoded = schema.toObject(schema.decode(vocabulary)) as { pieces: Array<{ piece: string; score: number; type?: number }>; normalizer: { name: string; precompiledCharsmap: Buffer } };
  const tokenizer = JSON.parse(await readFile(new URL("../resources/camembert/tokenizer.json", import.meta.url), "utf8")) as {
    model: { vocab: Array<[string, number]>; unk_id: number };
    normalizer: { precompiled_charsmap: string };
    added_tokens: Array<{ id: number; content: string; special: boolean; normalized: boolean; single_word: boolean; lstrip: boolean; rstrip: boolean }>;
  };
  if (decoded.pieces.length !== 32007 || !Buffer.from(tokenizer.normalizer.precompiled_charsmap, "base64").equals(decoded.normalizer.precompiledCharsmap)) throw new Error("Normalisation du vocabulaire incompatible.");
  if (decoded.pieces.slice(0, 32005).some((piece, i) => i !== 4 && (piece.piece !== tokenizer.model.vocab[i]?.[0] || Math.abs(piece.score - tokenizer.model.vocab[i][1]) > 1e-10))) throw new Error("Correspondance des identifiants lexicaux invalide.");
  tokenizer.model.vocab = decoded.pieces.slice(0, 32005).map(piece => [piece.piece, piece.score]);
  tokenizer.model.unk_id = 3;
  tokenizer.added_tokens = tokenizer.added_tokens.filter(token => token.id !== 4);
  tokenizer.added_tokens.push({ id: 3, content: "<unk>", special: true, normalized: false, single_word: false, lstrip: false, rstrip: false });
  const labels: Record<string, string[]> = { VirguleManquanteGeneraleDevant: ["O", ","] };
  let offset = 0;
  for (const [name, count] of [["MotsManquantsGeneralDevant", 125], ["est", 12], ["ou", 3], ["ces", 5]] as const) {
    if (classes[offset++] !== 0x80 + count || classes[offset++] !== 0x80 + count) throw new Error("En-tête des classes invalide.");
    labels[name] = [];
    for (let i = 0; i < count; i++) {
      const end = classes.indexOf(0, offset);
      if (end < offset) throw new Error("Liste des classes tronquée.");
      labels[name].push(classes.subarray(offset, end).toString("utf8"));
      offset = end + 1;
    }
    if (labels[name][0] !== "O") throw new Error("Classe sans correction absente.");
  }
  if (offset !== classes.length) throw new Error("Classes supplémentaires non décodées.");
  const destination = new URL("../Antidote/model/electra/", import.meta.url);
  await mkdir(destination, { recursive: true });
  await writeFile(new URL("model.onnx", destination), model);
  await writeFile(new URL("tokenizer.json", destination), JSON.stringify(tokenizer));
  await writeFile(new URL("labels.json", destination), JSON.stringify(labels));
  await writeFile(new URL("NOTICE.txt", destination), "Modèle neuronal spécialisé importé depuis des ressources locales.\nAttribution observée dans la distribution source : Druide informatique inc.\nAucune licence ouverte de redistribution identifiée pour ces poids.\nLe modèle public CamemBERT possède une provenance et une licence distinctes.\n");
  await convertModel("electra", model, new URL("../Antidote/model/", import.meta.url));
  process.stdout.write(`ELECTRA local : ${model.length} octets, 32005 jetons, 5 sorties ; empreintes vérifiées.\n`);
}
void main().catch((error: unknown) => { console.error(error); process.exit(1); });
