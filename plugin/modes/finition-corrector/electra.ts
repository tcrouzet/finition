import { Tokenizer } from "@huggingface/tokenizers";
import { preserveCase } from "./corrector";
import type { Correction } from "./corrector";
import type { ReadNeuralAsset } from "./neural-assets";
import { loadModel } from "./model";
import { specializedHeads as headSizes } from "./neural-assets";

type Head = keyof typeof headSizes;

export async function createElectraCorrector(readAsset: ReadNeuralAsset) {
  const [model, vocabulary, classes] = await Promise.all([loadModel(readAsset, "electra"), readAsset("electra/tokenizer.json"), readAsset("electra/labels.json")]);
  const tokenizerData: unknown = JSON.parse(new TextDecoder().decode(vocabulary));
  if (!tokenizerData || typeof tokenizerData !== "object") throw new Error("Vocabulaire neuronal invalide.");
  const tokenizer = new Tokenizer(tokenizerData, { unk_token: "<unk>", bos_token: "<s>", eos_token: "</s>", pad_token: "<pad>" });
  if (tokenizer.token_to_id("<unk>") !== 3 || tokenizer.token_to_id("<pad>") !== 1 || tokenizer.token_to_id("<s>") !== 5 || tokenizer.token_to_id("</s>") !== 6) throw new Error("Identifiants spéciaux incompatibles.");
  const labels = JSON.parse(new TextDecoder().decode(classes)) as Record<Head, string[]>;
  for (const head of Object.keys(headSizes) as Head[]) {
    if (!Array.isArray(labels[head]) || labels[head].length !== headSizes[head] || labels[head][0] !== "O" || labels[head].some(label => typeof label !== "string" || !label.length) || new Set(labels[head]).size !== headSizes[head]) throw new Error("Classes neuronales invalides.");
  }
  if (labels.VirguleManquanteGeneraleDevant[1] !== ",") throw new Error("Classes neuronales invalides.");
  const cache = new Map<string, readonly Correction[]>();
  return async (text: string): Promise<Correction[]> => {
    const results: Correction[] = [];
    const nextCache = new Map<string, readonly Correction[]>();
    for (const paragraph of text.matchAll(/[^\r\n]+/gu)) {
      let errors = nextCache.get(paragraph[0]) ?? cache.get(paragraph[0]);
      if (!errors) {
        const local: Correction[] = [];
        for (const sentence of paragraph[0].matchAll(/[^.!?;]+(?:[.!?;]|$)/gu)) {
          const encoded = tokenizer.encode(sentence[0]);
          const positions = alignTokens(sentence[0], encoded.tokens, tokenizer);
          if (!positions) continue;
          const words = [...sentence[0].matchAll(/\p{L}[\p{L}\p{M}]*(?:['’\u002d‑][\p{L}\p{M}]+)*/gu)];
          for (let windowStart = 1; windowStart < encoded.ids.length - 1; windowStart += 96) {
            const windowEnd = Math.min(windowStart + 128, encoded.ids.length - 1);
            const ids = [5, ...encoded.ids.slice(windowStart, windowEnd), 6];
            if (ids.some(id => id < 0 || id >= 32005)) throw new Error("Identifiant neuronal invalide.");
              const output = model.classify(ids);
              for (const head of Object.keys(headSizes) as Head[]) {
                const tensor = output[head];
                const size = headSizes[head];
                if (!tensor || !(tensor.data instanceof Float32Array) || tensor.dims.length !== 3 || tensor.dims[0] !== 1 || tensor.dims[1] !== ids.length || tensor.dims[2] !== size) throw new Error("Dimensions neuronales invalides.");
                for (let index = 1; index < ids.length - 1; index++) {
                  const originalIndex = windowStart + index - 1;
                  if (windowStart > 1 && index <= 16 || windowEnd < encoded.ids.length - 1 && index >= ids.length - 17) continue;
                  const scores = tensor.data.subarray(index * size, (index + 1) * size);
                  const winner = winningClass(scores, head === "est" || head === "ces" ? 0.99 : 0.95);
                  if (winner === 0) continue;
                  const position = positions[originalIndex];
                  const word = words.find(candidate => candidate.index === position.start);
                  if (!word) continue;
                  const original = word[0];
                  const replacement = labels[head][winner];
                  let start = sentence.index + word.index;
                  let selectedOriginal = original;
                  let suggestion: string;
                  let message: string;
                  if (head === "est" || head === "ou" || head === "ces") {
                    const normalized = original.toLocaleLowerCase("fr").replace(/’/gu, "'");
                    if (!labels[head].includes(normalized) || normalized === replacement || original === original.toLocaleUpperCase("fr")) continue;
                    suggestion = preserveCase(original, replacement).replace(/'/gu, original.includes("’") ? "’" : "'");
                    message = "Le contexte suggère une autre graphie. Vérifier cette proposition.";
                  } else {
                    const before = sentence[0].slice(0, word.index);
                    if (!before.trim() || /[,;:]\s*$/u.test(before)) continue;
                    suggestion = head === "VirguleManquanteGeneraleDevant" ? `, ${original}` : `${replacement}${replacement.endsWith("'") ? "" : " "}${original}`;
                    if (head === "VirguleManquanteGeneraleDevant") {
                      const whitespace = before.match(/\s*$/u)![0];
                      start -= whitespace.length;
                      selectedOriginal = whitespace + original;
                    }
                    message = head === "VirguleManquanteGeneraleDevant" ? "Une virgule semble manquer avant ce mot." : `Le contexte suggère « ${replacement} » avant ce mot. Vérifier cette proposition.`;
                  }
                  if (!local.some(error => error.nStart === start && error.nEnd === start + selectedOriginal.length)) local.push({ nStart: start, nEnd: start + selectedOriginal.length, sType: "grammaire", sRuleId: `neural.electra.${head}`, sMessage: message, aSuggestions: [suggestion], sOriginal: selectedOriginal });
                }
              }
            if (windowEnd === encoded.ids.length - 1) break;
          }
        }
        errors = local;
      }
      nextCache.set(paragraph[0], errors);
      for (const error of errors) results.push({ ...error, aSuggestions: [...error.aSuggestions], nStart: error.nStart + paragraph.index, nEnd: error.nEnd + paragraph.index });
    }
    cache.clear();
    for (const [paragraph, errors] of nextCache) cache.set(paragraph, errors);
    return results;
  };
}

function winningClass(scores: Float32Array, threshold: number): number {
  let winner = 0;
  for (let i = 0; i < scores.length; i++) {
    if (!Number.isFinite(scores[i])) throw new Error("Score neuronal invalide.");
    if (scores[i] > scores[winner]) winner = i;
  }
  if (!winner) return 0;
  const probability = 1 / scores.reduce((sum, score) => sum + Math.exp(score - scores[winner]), 0);
  // shortcut: seuils prudents de 95/99 %, à calibrer sur un corpus annoté ; ils ne reproduisent pas les arbitrages natifs.
  return probability >= threshold ? winner : 0;
}

function alignTokens(text: string, tokens: string[], tokenizer: Tokenizer): Array<{ start: number; end: number }> | null {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const cluster of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const value = tokenizer.normalizer?.normalize(cluster[0]) ?? cluster[0];
    normalized += value;
    for (let i = 0; i < value.length; i++) { starts.push(cluster.index); ends.push(cluster.index + cluster[0].length); }
  }
  if (normalized !== (tokenizer.normalizer?.normalize(text) ?? text)) return null;
  let cursor = 0;
  const positions: Array<{ start: number; end: number }> = [];
  for (const token of tokens) {
    if (token === "<s>" || token === "</s>") { positions.push({ start: -1, end: -1 }); continue; }
    if (token === "<unk>") return null;
    let piece = token;
    if (piece.startsWith("▁")) {
      while (cursor < normalized.length && /\s/u.test(normalized[cursor])) cursor++;
      piece = piece.slice(1);
    }
    if (!normalized.startsWith(piece, cursor)) return null;
    positions.push({ start: starts[cursor] ?? text.length, end: ends[cursor + piece.length - 1] ?? starts[cursor] ?? text.length });
    cursor += piece.length;
  }
  return normalized.slice(cursor).trim() ? null : positions;
}
