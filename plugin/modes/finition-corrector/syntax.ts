import { sentenceRanges } from "../clause-split";
import { wordKey } from "./lexicon";
import type { Lexeme } from "./lexicon";

export interface SyntaxToken { text: string; start: number; end: number; analyses: readonly Lexeme[] }
interface NominalGroup { head: SyntaxToken; end: number }
interface Dependency { head: SyntaxToken; dependent: SyntaxToken; role: "sujet" | "complément" | "infinitif"; boundary: [SyntaxToken, SyntaxToken] }
export interface SyntaxSentence { start: number; end: number; dependencies: Dependency[]; interrogative: boolean }

const subjects = new Set(["je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ce"]);
const modifiers = new Set(["ne", "pas", "plus", "jamais", "rien", "bien", "vraiment", "déjà", "encore", "toujours", "me", "te", "se", "le", "la", "les", "lui", "leur", "nous", "vous", "en", "y"]);
const deInfinitive = new Set(["proposer", "suggérer", "demander", "conseiller", "recommander", "permettre", "interdire", "ordonner"]);
const bareInfinitive = new Set(["falloir", "vouloir", "pouvoir", "devoir", "savoir", "souhaiter", "désirer", "préférer", "oser", "espérer", "aimer"]);
const thatComplement = new Set(["penser", "croire", "savoir", "vouloir", "souhaiter", "espérer", "dire", "demander"]);
const auxiliaries = new Set(["avoir", "être"]);
const prenominal = new Set(["beau", "bon", "grand", "gros", "jeune", "joli", "mauvais", "nouveau", "petit", "premier", "dernier", "vieux"]);
const has = (token: SyntaxToken | undefined, category: string) => Boolean(token?.analyses.some(item => item.category === category));
const verbTag = (token: SyntaxToken | undefined, tag: RegExp) => Boolean(token?.analyses.some(item => item.category === "verbe" && item.inflection.split(";").some(part => tag.test(part))));
const infinitive = (token: SyntaxToken | undefined) => verbTag(token, /^inf$/u);
const finite = (token: SyntaxToken | undefined) => verbTag(token, /^(?:ind|sub|cond):/u);
const hasLemma = (token: SyntaxToken, lemmas: ReadonlySet<string>) => token.analyses.some(item => item.category === "verbe" && lemmas.has(item.lemma));
const space = /^[ \t\u00a0\u202f]*(?:d['’])?$/iu;
const junction = /^[ \t\u00a0\u202f]*,?[ \t\u00a0\u202f]*(?:[mtslj]['’])?$/iu;

export function nominalParents(text: string, words: readonly SyntaxToken[], index: number): SyntaxToken[] {
  const parents: SyntaxToken[] = [];
  for (let depth = 0; index > 0 && depth < 8; depth++) {
    const anchor = has(words[index - 1], "déterminant") && /^\s+$/u.test(text.slice(words[index - 1].end, words[index].start)) ? index - 1 : index;
    const previous = words[anchor - 1];
    if (!previous) break;
    const gap = text.slice(previous.end, words[anchor].start);
    const elided = /^\s+d['’]$/iu.test(gap);
    const contracted = wordKey(words[anchor].text) === "des" && /^\s+$/u.test(gap);
    const preposition = has(previous, "préposition") && /^\s+$/u.test(gap) && anchor > 1 && /^\s+$/u.test(text.slice(words[anchor - 2].end, previous.start));
    const parent = elided || contracted ? anchor - 1 : preposition ? anchor - 2 : -1;
    if (parent < 0 || !has(words[parent], "nom") || has(words[parent], "préposition") || has(words[parent], "conjonction")) break;
    parents.push(words[parent]);
    index = parent;
  }
  return parents;
}

export function infinitiveCoordinations(text: string, words: readonly SyntaxToken[]): Array<{ head: SyntaxToken; dependent: SyntaxToken }> {
  // shortcut: seuls les régissants explicites sont suivis ; analyser les subordonnées pour couvrir les dépendances plus longues.
  const relations: Array<{ head: SyntaxToken; dependent: SyntaxToken }> = [];
  let governed = false, head: SyntaxToken | undefined;
  for (let i = 0; i < words.length; i++) {
    const word = words[i], key = wordKey(word.text);
    const gap = text.slice(words[i - 1]?.end ?? 0, word.start);
    if (/[.!?;:«»“”"()—]/u.test(gap) || /qu['’]/iu.test(gap) || ["qui", "que", "dont", "si", "lorsque"].includes(key)) { governed = false; head = undefined; }
    if (governed && head && ["puis", "et", "ou"].includes(key)) {
      let next = i + 1;
      while (["ne", "pas", "bien", "encore", "vraiment"].includes(wordKey(words[next]?.text ?? ""))) next++;
      const target = words[next];
      if (!target || !/^[\p{L}\p{M}'’\s]+$/u.test(text.slice(word.end, target.end))) continue;
      const object = has(words[next + 1], "déterminant") && /^\s+$/u.test(text.slice(target.end, words[next + 1].start)) ? nominalGroup(text, words, next + 1, words.length) : undefined;
      const directObject = object && !object.head.analyses.some(item => ["heure", "jour", "semaine", "mois", "an", "année", "fois"].includes(item.lemma));
      if (verbTag(target, /^par:pas$/u) && !hasLemma(head, auxiliaries) && (infinitive(words[i - 1]) || directObject)) relations.push({ head, dependent: target });
      continue;
    }
    const afterSubject = i > 0 && subjects.has(wordKey(words[i - 1].text)) && /^\s+$/u.test(gap);
    if (finite(word) && (afterSubject || !has(word, "nom") && !has(word, "adjectif") && !has(word, "adverbe") && !has(word, "conjonction") || hasLemma(word, auxiliaries))) {
      governed = hasLemma(word, bareInfinitive);
      head = undefined;
    } else if (head && subjects.has(key)) { governed = false; head = undefined; }
    if (governed && infinitive(word)) head = word;
  }
  return relations;
}

function nominalGroup(text: string, words: readonly SyntaxToken[], start: number, limit: number, bare = false, depth = 0): NominalGroup | undefined {
  const first = words[start];
  if (!first || start >= limit || depth > 8) return;
  if (subjects.has(wordKey(first.text))) return { head: first, end: start + 1 };
  if (!bare && !has(first, "déterminant") && !/^\p{Lu}/u.test(first.text)) return;
  let head: SyntaxToken | undefined, end = start;
  for (let i = start; i < limit; i++) {
    const word = words[i], key = wordKey(word.text);
    if (i > start && !space.test(text.slice(words[i - 1].end, word.start))) break;
    if (head && hasLemma(word, auxiliaries)) break;
    if (head && ["de", "du", "des"].includes(key)) {
      const nested = nominalGroup(text, words, i + 1, limit, true, depth + 1);
      if (!nested) break;
      end = nested.end;
      i = end - 1;
    } else if (!head && (has(word, "déterminant") || (word.analyses.some(item => item.category === "adjectif" && prenominal.has(item.lemma)) && has(words[i + 1], "nom")))) {
      continue;
    } else if (has(word, "nom") || (!word.analyses.length && /^\p{Lu}/u.test(word.text))) {
      if (head && !has(word, "adjectif") && !(/^\p{Lu}/u.test(head.text) && /^\p{Lu}/u.test(word.text))) break;
      head ??= word;
      end = i + 1;
    } else if (has(word, "déterminant") || has(word, "adjectif") || has(word, "nombre")) {
      if (head && (has(word, "déterminant") || !has(word, "adjectif"))) break;
      if (head) end = i + 1;
    } else break;
  }
  return head ? { head, end } : undefined;
}

export function analyzeSyntax(text: string, tokens: readonly SyntaxToken[]): SyntaxSentence[] {
  const sentences: SyntaxSentence[] = [];
  let cursor = 0;
  for (const [start, end] of sentenceRanges(text)) {
    while (cursor < tokens.length && tokens[cursor].start < start) cursor++;
    const first = cursor;
    while (cursor < tokens.length && tokens[cursor].end <= end) cursor++;
    const words = tokens.slice(first, cursor);
    if (!words.length) continue;
    const introduction = /^[ \t\u00a0\u202f«“"]*est-ce[ \t\u00a0\u202f]+qu(?:e[ \t\u00a0\u202f]+|['’])/iu.exec(text.slice(start, end));
    const body = introduction ? words.findIndex(word => word.start >= start + introduction[0].length) : 0;
    if (body < 0) continue;
    const nominal = new Set<number>();
    for (let i = 0; i < words.length; i++) {
      if (!has(words[i], "déterminant")) continue;
      const group = nominalGroup(text, words, i, words.length);
      if (group) {
        for (let j = i; j < group.end; j++) if (has(words[j], "nom")) nominal.add(j);
        i = group.end - 1;
      }
    }
    const verbal = (i: number) => !nominal.has(i) && (i === 0 || !/^\p{Lu}/u.test(words[i].text)) && (finite(words[i]) || infinitive(words[i]));
    let root = -1, subject: NominalGroup | undefined, interrogative = false;
    for (let i = body; i < words.length; i++) {
      if (!verbal(i)) continue;
      let subjectEnd = i;
      while (subjectEnd > body && modifiers.has(wordKey(words[subjectEnd - 1].text)) && !subjects.has(wordKey(words[subjectEnd - 1].text))) subjectEnd--;
      const candidate = nominalGroup(text, words, body, subjectEnd);
      const prefix = wordKey(text.slice(start, words[i].start).trim()).replace(/^[«“"]\s*/u, "");
      const direct = /^(?:pourquoi|comment|où|quand|combien)(?:\s+(?:ne|pas|plus|jamais|le|la|les|lui|leur|nous|vous|en|y))*\s*$/u.test(prefix);
      const inversion = /-(?:t-)?(?:je|tu|il|elle|on|nous|vous|ils|elles|ce)$/u.test(wordKey(words[i].text)) && /^(?:(?:qu|n)['’])?$/u.test(prefix);
      const declarative = candidate?.end === subjectEnd && finite(words[i]) && junction.test(text.slice(words[Math.max(0, subjectEnd - 1)].end, words[i].start));
      if (declarative || direct || inversion) {
        root = i;
        subject = declarative ? candidate : undefined;
        interrogative = Boolean(introduction) || direct || inversion;
        break;
      }
    }
    if (root < 0) continue;
    let head = root;
    if (hasLemma(words[root], auxiliaries)) {
      let participle = root + 1;
      while (modifiers.has(wordKey(words[participle]?.text ?? ""))) participle++;
      if (verbTag(words[participle], /^par:pas$/u) && /^[\p{L}\p{M}'’ \t\u00a0\u202f]+$/u.test(text.slice(words[root].end, words[participle].end))) head = participle;
    }
    const dependencies: Dependency[] = [];
    if (subject) dependencies.push({ head: words[root], dependent: subject.head, role: "sujet", boundary: [words[subject.end - 1], words[root]] });
    let next = head + 1;
    while (modifiers.has(wordKey(words[next]?.text ?? ""))) next++;
    let previous = words[head];
    if (hasLemma(words[head], deInfinitive) && /^(?:à|au|aux)$/u.test(wordKey(words[next]?.text ?? ""))) {
      const group = nominalGroup(text, words, next + 1, words.length, true);
      if (group) {
        dependencies.push({ head: words[head], dependent: group.head, role: "complément", boundary: [previous, words[next]] });
        next = group.end;
        previous = words[next - 1];
      }
    }
    const nextWord = words[next];
    if (nextWord) {
      const de = wordKey(nextWord.text) === "de";
      const elidedDe = /d['’]$/iu.test(text.slice(previous.end, nextWord.start));
      const complement = de ? words[next + 1] : nextWord;
      if (infinitive(complement) && (hasLemma(words[head], deInfinitive) && (de || elidedDe) || hasLemma(words[head], bareInfinitive) && !de && !elidedDe)) {
        dependencies.push({ head: words[head], dependent: complement, role: "infinitif", boundary: [previous, nextWord] });
      } else if (wordKey(nextWord.text) === "que" && hasLemma(words[head], thatComplement)) {
        dependencies.push({ head: words[head], dependent: nextWord, role: "complément", boundary: [previous, nextWord] });
      }
    }
    if (words.some((word, i) => i > head && !nominal.has(i) && finite(word))) interrogative = false;
    if (wordKey(words[0].text) === "quand" && finite(words[root]) && text.slice(start, end).includes(",")) interrogative = false;
    if (/[«“"]/u.test(text.slice(start, words[root].start)) && /[»”"]/u.test(text.slice(words[root].end, end).replace(/[ \t\u00a0\u202f]*\.[ \t\u00a0\u202f]*[»”"]?[ \t\u00a0\u202f]*$/u, ""))) interrogative = false;
    // shortcut: les incises et énumérations à plusieurs virgules restent ambiguës sans analyse des subordonnées.
    sentences.push({ start, end, dependencies: (text.slice(start, end).match(/,/gu)?.length ?? 0) > 1 ? [] : dependencies, interrogative });
  }
  return sentences;
}
