import { Lexicon, wordKey } from "./lexicon";
import type { Lexeme } from "./lexicon";
import { buildNeuralAlternatives } from "./confusions";

export interface Correction {
  nStart: number;
  nEnd: number;
  sType: "orthographe" | "grammaire";
  sRuleId: string;
  sMessage: string;
  aSuggestions: string[];
  sValue?: string;
  sOriginal: string;
}

type Token = { text: string; start: number; end: number; analyses: readonly Lexeme[] };
const determiners: Record<string, [string, string]> = {
  le: ["m", "s"], la: ["f", "s"], les: ["", "p"], un: ["m", "s"], une: ["f", "s"], des: ["", "p"],
  ce: ["m", "s"], cet: ["m", "s"], cette: ["f", "s"], ces: ["", "p"],
  mon: ["", "s"], ma: ["f", "s"], mes: ["", "p"], ton: ["", "s"], ta: ["f", "s"], tes: ["", "p"],
  son: ["", "s"], sa: ["f", "s"], ses: ["", "p"], notre: ["", "s"], nos: ["", "p"], votre: ["", "s"], vos: ["", "p"], leur: ["", "s"], leurs: ["", "p"],
};
const persons: Record<string, string> = { je: "1s", tu: "2s", il: "3s", elle: "3s", on: "3s", nous: "1p", vous: "2p", ils: "3p", elles: "3p" };
const hasCategory = (token: Token | undefined, category: string): boolean => Boolean(token?.analyses.some(item => item.category === category) && (!["nom", "adjectif"].includes(category) || !token.analyses.some(item => item.category === "préposition" || item.category === "conjonction")));
export const preserveCase = (source: string, replacement: string): string => source === source.toLocaleUpperCase("fr") ? replacement.toLocaleUpperCase("fr") : /^\p{Lu}/u.test(source) ? replacement[0].toLocaleUpperCase("fr") + replacement.slice(1) : replacement;

export class FinitionCorrector {
  private readonly lexicon: Lexicon;
  private readonly personalWords: Set<string>;
  private cache = new Map<string, readonly Correction[]>();

  constructor(lexicon: Lexicon, personalWords: readonly string[] = []) {
    this.lexicon = lexicon;
    if (personalWords.some(word => typeof word !== "string")) throw new TypeError("Mot personnel invalide.");
    this.personalWords = new Set(personalWords.map(wordKey));
  }

  async getCategories(words: readonly string[]): Promise<Record<string, string>> {
    return Object.fromEntries(words.map(word => [word, [...new Set(this.lookup(word).map(item => item.category).filter(Boolean))].sort().join("|")]));
  }

  private lookup(word: string): readonly Lexeme[] {
    const analyses = this.lexicon.lookup(word);
    if (analyses.length || !word.includes("-")) return analyses;
    const form = wordKey(word);
    const inversion = /^(\p{L}[\p{L}\p{M}]*)(-t)?-(je|tu|il|elle|on|nous|vous|ils|elles|ce)$/u.exec(form);
    if (inversion) {
      const [, verb, liaison, subject] = inversion;
      const needsLiaison = /^(?:il|elle|on)$/u.test(subject) && !/[dt]$/u.test(verb);
      if (Boolean(liaison) !== needsLiaison) return [];
      return this.lexicon.lookup(verb).filter(item => item.category === "verbe" && item.inflection.split(";").some(tag => !tag.startsWith("imp:") && (subject === "ce" ? /:3[sp]$/u.test(tag) : tag.endsWith(":" + persons[subject]))));
    }
    const imperative = /^(\p{L}[\p{L}\p{M}]*)-((?:le|la|les)(?:-(?:moi|toi|lui|nous|vous|leur))?|(?:moi|toi|lui|nous|vous|leur)(?:-y|-en)?|y(?:-en)?|en|[mt]'(?:en|y))$/u.exec(form);
    if (!imperative) return [];
    const [, verb, pronouns] = imperative;
    const head = /^(?:y|en)(?:-|$)/u.test(pronouns) && /es$/u.test(verb) ? verb.slice(0, -1) : verb;
    return this.lexicon.lookup(head).filter(item => item.category === "verbe" && item.inflection.split(";").some(tag => tag.startsWith("imp:")));
  }

  getNeuralAlternatives(groups: unknown): Record<string, string[]> {
    return buildNeuralAlternatives(groups, word => this.lexicon.lookup(word));
  }

  async parse(text: string): Promise<Correction[]> {
    if (typeof text !== "string") throw new TypeError("Le texte doit être une chaîne.");
    const nextCache = new Map<string, readonly Correction[]>();
    const results: Correction[] = [];
    for (const paragraph of text.matchAll(/[^\r\n]+/g)) {
      const local = nextCache.get(paragraph[0]) ?? this.cache.get(paragraph[0]) ?? this.analyseParagraph(paragraph[0]);
      nextCache.set(paragraph[0], local);
      for (const item of local) results.push({ ...item, aSuggestions: [...item.aSuggestions], nStart: item.nStart + paragraph.index, nEnd: item.nEnd + paragraph.index });
    }
    this.cache = nextCache;
    return results;
  }

  private analyseParagraph(text: string): Correction[] {
    const tokens: Token[] = [];
    const results: Correction[] = [];
    const add = (token: Token, rule: string, message: string, suggestions: string[], spelling = false) => {
      const replacements = [...new Set(suggestions.map(word => preserveCase(token.text, word)))].filter(word => word !== token.text);
      results.push({ nStart: token.start, nEnd: token.end, sType: spelling ? "orthographe" : "grammaire", sRuleId: rule, sMessage: message, aSuggestions: replacements, sOriginal: token.text, ...(spelling ? { sValue: token.text } : {}) });
    };
    for (const match of text.matchAll(/\p{L}[\p{L}\p{M}\u00ad]*(?:[-’'][\p{L}\p{M}\u00ad]+)*/gu)) {
      let word = match[0];
      let start = match.index;
      if (!this.lexicon.has(word)) {
        const prefix = /^(?:[cdjlmnst]|qu|jusqu|lorsqu|puisqu|quoiqu)['’]/iu.exec(word)?.[0] ?? "";
        word = word.slice(prefix.length);
        start += prefix.length;
      }
      const token = { text: word, start, end: start + word.length, analyses: this.lookup(word) };
      tokens.push(token);
    }
    let knownThrough = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      for (const length of this.lexicon.phraseLengths(token.text)) {
        const phrase = tokens.slice(i, i + length);
        if (phrase.length === length && phrase.every((item, j) => j === 0 || /^\s+$/u.test(text.slice(phrase[j - 1].end, item.start))) && this.lexicon.has(phrase.map(item => item.text).join(" "))) knownThrough = Math.max(knownThrough, phrase[phrase.length - 1].end);
      }
      if (token.end > knownThrough && !token.analyses.length && !this.lexicon.has(token.text) && !this.personalWords.has(wordKey(token.text))) add(token, "orthographe.inconnu", "Vérifier l’orthographe de ce mot.", this.lexicon.suggest(token.text), true);
    }
    for (let i = 0; i < tokens.length - 1; i++) {
      const token = tokens[i];
      const next = tokens[i + 1];
      if (!/^\s+$/u.test(text.slice(token.end, next.start))) continue;
      const key = wordKey(token.text);
      const startsClause = i === 0 || /[.!?;:]/u.test(text.slice(tokens[i - 1].end, token.start));
      let determiner = Object.prototype.hasOwnProperty.call(determiners, key) ? determiners[key] : undefined;
      const numeral = wordKey(tokens[i - 1]?.text ?? "") === "et" ? tokens[i - 2] : tokens[i - 1];
      const compoundNumber = Boolean((key === "un" || key === "une") && numeral && hasCategory(numeral, "nombre") && !/^(?:un|une|zéro)$/u.test(wordKey(numeral.text)) && /^\s+(?:et\s+)?$/iu.test(text.slice(numeral.end, token.start)));
      if (determiner && compoundNumber) determiner = [determiner[0], "p"];
      if (determiner && (compoundNumber || startsClause || !hasCategory(next, "verbe"))) {
        const nextAgreesAsNoun = next.analyses.some(item => item.category === "nom" && (!determiner[0] || !item.gender || item.gender === determiner[0]) && (!item.number || item.number === determiner[1]));
        const adjective = hasCategory(next, "adjectif") && hasCategory(tokens[i + 2], "nom") && (!hasCategory(tokens[i + 2], "adjectif") || !nextAgreesAsNoun) && /^\s+$/u.test(text.slice(next.end, tokens[i + 2].start)) ? next : undefined;
        const noun = adjective ? tokens[i + 2] : next;
        const nouns = hasCategory(noun, "nom") ? noun.analyses.filter(item => item.category === "nom" && (!compoundNumber || item.number)) : [];
        if (nouns.length) {
          const [gender, number] = determiner;
          const agrees = (item: Lexeme, g: string, n: string) => (!g || !item.gender || item.gender === g) && (!n || !item.number || item.number === n);
          const alternatives = (target: Token, category: string, g: string, n: string) => (category === "nom" ? nouns : target.analyses).filter(item => item.category === category).flatMap(item => this.lexicon.forms(item.lemma).filter(form => form.category === category && agrees(form, g, n)).map(form => form.form));
          if (!nouns.some(item => agrees(item, gender, number))) {
            const forms = alternatives(noun, "nom", gender, number);
            if (forms.length) add(noun, "accord.determinant-nom", "Vérifier l’accord avec le déterminant.", forms);
          }
          const nounGenders = [...new Set(nouns.map(item => item.gender).filter(Boolean))];
          const expectedGender = gender || (nounGenders.length === 1 ? nounGenders[0] : "");
          const target = adjective ?? (hasCategory(tokens[i + 2], "adjectif") && /^\s+$/u.test(text.slice(noun.end, tokens[i + 2].start)) ? tokens[i + 2] : undefined);
          if (target && !target.analyses.some(item => item.category === "adjectif" && agrees(item, expectedGender, number))) {
            // shortcut: rattachement local ; utiliser les dépendances syntaxiques pour les compléments imbriqués.
            const previous = tokens[i - 1];
            const elided = previous && /^\s+d['’]$/iu.test(text.slice(previous.end, token.start));
            const contracted = key === "des" && previous && /^\s+$/u.test(text.slice(previous.end, token.start));
            const preposition = previous && hasCategory(previous, "préposition") && tokens[i - 2] && /^\s+$/u.test(text.slice(tokens[i - 2].end, previous.start)) && /^\s+$/u.test(text.slice(previous.end, token.start));
            const parent = elided || contracted ? previous : preposition ? tokens[i - 2] : undefined;
            const parentAgrees = !adjective && hasCategory(parent, "nom") && parent?.analyses.some(item => item.category === "nom" && item.gender && item.number && target.analyses.some(form => form.category === "adjectif" && agrees(form, item.gender, item.number)));
            if (!parentAgrees) {
              const forms = alternatives(target, "adjectif", expectedGender, number);
              if (forms.length) add(target, "accord.nom-adjectif", "Vérifier l’accord de l’adjectif.", forms);
            }
          }
        }
      }
      if (startsClause && Object.prototype.hasOwnProperty.call(persons, key)) {
        const verbs = next.analyses.filter(item => item.category === "verbe");
        const finite = verbs.flatMap(item => item.inflection.split(";").filter(tag => /:\d[sp]$/u.test(tag)));
        if (finite.length && !finite.some(tag => tag.endsWith(":" + persons[key]))) {
          const tags = new Set(finite.map(tag => tag.replace(/\d[sp]$/u, persons[key])));
          const forms = verbs.flatMap(item => this.lexicon.forms(item.lemma).filter(form => form.category === "verbe" && form.inflection.split(";").some(tag => tags.has(tag))).map(form => form.form));
          if (forms.length) add(next, "accord.sujet-verbe", "Vérifier l’accord du verbe avec le pronom sujet.", forms);
        }
      }
    }
    return results.sort((a, b) => a.nStart - b.nStart || a.nEnd - b.nEnd || a.sRuleId.localeCompare(b.sRuleId));
  }
}
