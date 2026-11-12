export interface Lexeme {
  form: string;
  lemma: string;
  category: string;
  gender: string;
  number: string;
  inflection: string;
  frequency: number;
}

export const wordKey = (word: string): string => word.normalize("NFC").replace(/’/g, "'").replace(/\u00ad/g, "").toLocaleLowerCase("fr");

export type LexemeRow = readonly [string, string, string, string, string, string, number];
export const isLexemeRow = (row: unknown): row is LexemeRow => Array.isArray(row) && row.length === 7 && row.slice(0, 6).every(item => typeof item === "string") && Boolean(row[0]) && Boolean(row[1]) && typeof row[6] === "number" && Number.isFinite(row[6]) && row[6] >= 0;
const expand = (row: LexemeRow): Lexeme => ({ form: row[0], lemma: row[1], category: row[2], gender: row[3], number: row[4], inflection: row[5], frequency: row[6] });
const spellingForm = (word: string): string => word.normalize("NFC").replace(/’/g, "'").replace(/\u00ad/g, "");
const matchesCase = (row: LexemeRow, word: string): boolean => {
  const capitalizedUnknown = !row[2] && spellingForm(row[0]) !== wordKey(row[0]);
  return (row[2] !== "nom propre" && !capitalizedUnknown) || spellingForm(row[0]) === spellingForm(word) || word === word.toLocaleUpperCase("fr");
};

function distance(left: string, right: string, rows: number[][]): number {
  let [previous, beforePrevious, row] = rows;
  for (let j = 0; j <= right.length; j++) previous[j] = j;
  let previousMinimum = 0;
  for (let i = 1; i <= left.length; i++) {
    row.fill(3);
    row[0] = i;
    let minimum = i;
    for (let j = Math.max(1, i - 2); j <= Math.min(right.length, i + 2); j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(left[i - 1] !== right[j - 1]));
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
      minimum = Math.min(minimum, row[j]);
    }
    if (minimum > 2 && previousMinimum > 2) return 3;
    previousMinimum = minimum;
    const spare = beforePrevious;
    beforePrevious = previous;
    previous = row;
    row = spare;
  }
  return previous[right.length];
}

export class Lexicon {
  private readonly words = new Map<string, LexemeRow[]>();
  private readonly lemmas = new Map<string, LexemeRow[]>();
  private readonly additional = new Set<string>();
  private readonly capitalizedAdditional = new Set<string>();
  private readonly lengths = new Map<number, string[]>();
  private readonly suggestions = new Map<string, string[]>();
  private readonly phrases = new Map<string, Set<number>>();

  constructor(entries: readonly LexemeRow[], forms: readonly string[] = []) {
    for (const row of entries) {
      if (!isLexemeRow(row)) throw new TypeError("Entrée lexicale invalide.");
      const key = wordKey(row[0]);
      if (!this.words.has(key)) this.addCandidate(row[0], key);
      for (const [index, entryKey] of [[this.words, key], [this.lemmas, wordKey(row[1])]] as const) {
        const values = index.get(entryKey) ?? [];
        values.push(row);
        index.set(entryKey, values);
      }
    }
    for (const form of forms) {
      if (typeof form !== "string" || !form) throw new TypeError("Forme lexicale invalide.");
      const exact = spellingForm(form);
      if (this.additional.has(exact)) continue;
      this.additional.add(exact);
      const key = wordKey(exact);
      if (exact !== key) this.capitalizedAdditional.add(key);
      this.addCandidate(exact, key);
    }
  }

  private addCandidate(form: string, key: string): void {
    const values = this.lengths.get(key.length) ?? [];
    values.push(form, key);
    this.lengths.set(key.length, values);
    const words = form.split(" ");
    if (words.length > 1) {
      const first = wordKey(words[0]);
      const sizes = this.phrases.get(first) ?? new Set<number>();
      sizes.add(words.length);
      this.phrases.set(first, sizes);
    }
  }

  phraseLengths(word: string): readonly number[] {
    return [...(this.phrases.get(wordKey(word)) ?? [])];
  }

  has(word: string): boolean {
    const form = spellingForm(word);
    const key = wordKey(word);
    return Boolean(this.words.get(key)?.some(row => matchesCase(row, form))) || this.additional.has(form) || (/^\p{Lu}/u.test(form) && this.additional.has(key)) || (form === form.toLocaleUpperCase("fr") && this.capitalizedAdditional.has(key));
  }

  lookup(word: string): readonly Lexeme[] {
    return (this.words.get(wordKey(word)) ?? []).filter(row => matchesCase(row, word)).map(expand);
  }

  forms(lemma: string): readonly Lexeme[] {
    return (this.lemmas.get(wordKey(lemma)) ?? []).map(expand);
  }

  suggest(word: string): string[] {
    const key = wordKey(word);
    if (key.length > 64 || key.length < 2 || this.has(word)) return [];
    const cached = this.suggestions.get(word);
    if (cached) return [...cached];
    const matches: { form: string; distance: number; frequency: number }[] = [];
    const rows = Array.from({ length: 3 }, () => new Array<number>(key.length + 3).fill(3));
    for (let length = Math.max(1, key.length - 2); length <= key.length + 2; length++) {
      const forms = this.lengths.get(length) ?? [];
      for (let i = 0; i < forms.length; i += 2) {
        const cost = distance(key, forms[i + 1], rows);
        if (cost > 2) continue;
        const analyses = this.words.get(forms[i + 1]) ?? [];
        matches.push({ form: forms[i], distance: cost, frequency: analyses.reduce((best, row) => Math.max(best, row[6]), 0) });
      }
    }
    const result = matches.sort((a, b) => a.distance - b.distance || b.frequency - a.frequency || a.form.localeCompare(b.form, "fr")).slice(0, 5).map(item => item.form);
    if (this.suggestions.size >= 512) this.suggestions.clear();
    this.suggestions.set(word, result);
    return [...result];
  }
}
