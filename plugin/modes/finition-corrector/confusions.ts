import type { Lexeme } from "./lexicon";

const grammar = ["a à", "son sont", "on ont", "sa ça", "ce se"];
const delegated = new Set("et est ou où ces ses".split(" "));
const closed = new Set(["préposition", "conjonction", "déterminant", "pronom", "adverbe"]);

export function buildNeuralAlternatives(groups: unknown, lookup: (word: string) => readonly Lexeme[]): Record<string, string[]> {
  if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group) || group.some(word => typeof word !== "string"))) throw new Error("Données phonétiques invalides.");
  const alternatives = new Map<string, Set<string>>();
  const content = (item: Lexeme) => item.category === "nom" || item.category === "adjectif";
  const analyses = new Map<string, readonly Lexeme[]>();
  const forms = (word: string) => {
    if (!analyses.has(word)) {
      const entries = lookup(word);
      const frequency = Math.max(0, ...entries.filter(content).map(item => item.frequency));
      analyses.set(word, entries.some(item => closed.has(item.category) && item.frequency >= frequency) ? [] : entries);
    }
    return analyses.get(word)!;
  };
  for (const group of groups as string[][]) for (const word of group) {
    const source = forms(word);
    if (delegated.has(word)) continue;
    for (const candidate of group) {
      const target = forms(candidate);
      if (candidate === word || delegated.has(candidate) || source.some(left => target.some(right => left.lemma === right.lemma))) continue;
      if (!source.some(left => content(left) && target.some(right => content(right) && (!left.gender || !right.gender || left.gender === right.gender) && (!left.number || !right.number || left.number === right.number)))) continue;
      const values = alternatives.get(word) ?? new Set([word]);
      values.add(candidate);
      alternatives.set(word, values);
    }
  }
  // Les trois autres familles grammaticales sont traitées par le modèle spécialisé.
  for (const pair of grammar) {
    const words = pair.split(" ");
    for (const word of words) alternatives.set(word, new Set([...(alternatives.get(word) ?? []), ...words]));
  }
  return Object.fromEntries([...alternatives].map(([word, values]) => [word, [...values]]));
}
