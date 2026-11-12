import { Tokenizer } from "@huggingface/tokenizers";
import { preserveCase } from "./corrector";
import type { Correction } from "./corrector";
import type { ReadNeuralAsset } from "./neural-assets";
import { loadModel } from "./model";

export async function createNeuralCorrector(readAsset: ReadNeuralAsset) {
  const phonetics: unknown = JSON.parse(new TextDecoder().decode(await readAsset("phonet_data.json")));
  if (!phonetics || typeof phonetics !== "object" || !("alternatives" in phonetics) || !phonetics.alternatives || typeof phonetics.alternatives !== "object" || Array.isArray(phonetics.alternatives) || Object.values(phonetics.alternatives).some(group => !Array.isArray(group) || group.length < 2 || group.some(word => typeof word !== "string"))) throw new Error("Lexique contextuel invalide.");
  const alternatives = new Map(Object.entries(phonetics.alternatives) as Array<[string, string[]]>);
  const [vocabulary, config, model] = await Promise.all([readAsset("tokenizer.json"), readAsset("tokenizer_config.json"), loadModel(readAsset, "camembert")]);
  const tokenizer = new Tokenizer(JSON.parse(new TextDecoder().decode(vocabulary)) as object, JSON.parse(new TextDecoder().decode(config)) as object);
  const maskToken = model.maskTokenId === 4 ? "[MASK]" : "<mask>";
  const maskId = tokenizer.token_to_id(maskToken);
  if (maskId !== model.maskTokenId) throw new Error("Vocabulaire neuronal incompatible.");
  const cache = new Map<string, readonly Correction[]>();
  return async (text: string): Promise<Correction[]> => {
    const results: Correction[] = [];
    const nextCache = new Map<string, readonly Correction[]>();
    const jobs: Array<{ context: string; length: number; errors: Correction[]; word: string; start: number; original: number; words: string[]; ids: number[] }> = [];
    for (const paragraph of text.matchAll(/[^\r\n]+/g)) {
      let local = nextCache.get(paragraph[0]) ?? cache.get(paragraph[0]);
      if (!local) {
        const errors: Correction[] = [];
        for (const sentence of paragraph[0].matchAll(/[^.!?;]+(?:[.!?;]|$)/gu)) {
          const tokens = [...sentence[0].matchAll(/\p{L}[\p{L}\p{M}]*(?:[-'’][\p{L}\p{M}]+)*/gu)];
          if (tokens.length < 2) continue;
          for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const prefix = /^(?:[cdjlmnst]|qu|jusqu|lorsqu|puisqu|quoiqu)['’]/iu.exec(token[0])?.[0].length ?? 0;
            const word = token[0].slice(prefix);
            const start = token.index + prefix;
            const original = word.toLocaleLowerCase("fr");
            const group = alternatives.get(original);
            if (!group || word === word.toLocaleUpperCase("fr")) continue;
            const from = tokens[Math.max(0, i - 12)].index;
            const last = tokens[Math.min(tokens.length - 1, i + 12)];
            const to = i + 12 >= tokens.length - 1 ? sentence[0].length : last.index + last[0].length;
            const context = sentence[0].slice(from, start) + maskToken + sentence[0].slice(token.index + token[0].length, to);
            const ids = tokenizer.encode(context).ids;
            if (ids.length > 128 || ids.filter(id => id === maskId).length !== 1) continue;
            const mask = ids.indexOf(maskId);
            // Après une élision, l'identifiant diffère souvent de celui du mot isolé.
            const candidates = group.map(candidate => ({ word: candidate, ids: tokenizer.encode(context.replace(maskToken, preserveCase(word, candidate))).ids })).filter(candidate => candidate.ids.length === ids.length && candidate.ids.every((id, index) => index === mask || id === ids[index]));
            const originalIndex = candidates.findIndex(candidate => candidate.word === original);
            if (originalIndex < 0 || candidates.length < 2) continue;
            jobs.push({ context, length: ids.length, errors, word, start: sentence.index + start, original: originalIndex, words: candidates.map(candidate => candidate.word), ids: candidates.map(candidate => candidate.ids[mask]) });
          }
        }
        local = errors;
      }
      nextCache.set(paragraph[0], local);
    }
    jobs.sort((a, b) => a.length - b.length);
    for (let from = 0; from < jobs.length;) {
      let to = Math.min(jobs.length, from + model.maxBatchSize);
      while ((to - from) * jobs[to - 1].length > 512) to--;
      const batch = jobs.slice(from, to);
      from = to;
      const output = model.score(batch.map(job => tokenizer.encode(job.context).ids), batch.map(job => job.ids));
      for (const [row, job] of batch.entries()) {
          const scores = output[row];
          const best = scores.reduce((index, score, current) => score > scores[index] ? current : index, 0);
          const margin = scores[best] - scores[job.original];
          // shortcut: seuil 10:1 non calibré sur un corpus annoté ; le modèle reste expérimental.
          if (!Number.isFinite(margin) || margin < Math.log(10)) continue;
          job.errors.push({ nStart: job.start, nEnd: job.start + job.word.length, sType: "grammaire", sRuleId: "neural.homophone", sMessage: "Le contexte suggère une autre graphie. Vérifier cette proposition.", aSuggestions: [preserveCase(job.word, job.words[best])], sOriginal: job.word });
      }
    }
    for (const paragraph of text.matchAll(/[^\r\n]+/g)) {
      for (const error of nextCache.get(paragraph[0])!) results.push({ ...error, aSuggestions: [...error.aSuggestions], nStart: error.nStart + paragraph.index, nEnd: error.nEnd + paragraph.index });
    }
    cache.clear();
    for (const [paragraph, errors] of nextCache) cache.set(paragraph, errors);
    return results.sort((a, b) => a.nStart - b.nStart);
  };
}
