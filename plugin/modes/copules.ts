import copules from "../data/copules.json";
import type { SharedDictionary } from "../lexicon/shared";
import type { Highlight } from "../types";
import { maskMarkdown } from "./finition-corrector/markdown";
import { tokenize, type Token } from "./tokenize";

export interface CopuleLexicon {
	forms: Map<string, string[]>;
	participles: Set<string>;
	adverbs: Set<string>;
}
export const emptyCopuleLexicon = (): CopuleLexicon => ({ forms: new Map(), participles: new Set(), adverbs: new Set() });
const lemmaKey = (lemma: string) => lemma.toLowerCase().replace(/^(?:se\s+|s['’])/u, "").normalize("NFD").replace(/\u0302/gu, "").normalize("NFC");
const pronominal = (lemma: string) => /^(?:se\s+|s['’])/u.test(lemma);

export function buildCopuleLexicon(dictionary: SharedDictionary): CopuleLexicon {
	const patterns = new Map(copules.map(lemma => [lemmaKey(lemma), lemma]));
	const lexicon = emptyCopuleLexicon();
	for (const [form, lemma, category, , , inflection] of dictionary.entries) {
		const key = form.toLowerCase().normalize("NFC");
		if (category === "adverbe") lexicon.adverbs.add(key);
		if (category !== "verbe" && category !== "participe") continue;
		if (inflection.split(";").includes("par:pas")) lexicon.participles.add(key);
		const pattern = patterns.get(lemmaKey(lemma));
		if (!pattern) continue;
		const matches = lexicon.forms.get(key) ?? [];
		if (!matches.includes(pattern)) matches.push(pattern);
		lexicon.forms.set(key, matches);
	}
	return lexicon;
}

function reflexiveBefore(tokens: Token[], index: number, text: string, forms: CopuleLexicon["forms"], subjects: string[]): boolean {
	for (let previous = index - 1; previous >= 0; previous--) {
		const token = tokens[previous];
		if (!/^[\s'’]*$/u.test(text.slice(token.end, tokens[previous + 1].start))) return false;
		if (token.lemma === "se") return true;
		if (["me", "te", "nous", "vous"].includes(token.lemma)) return subjects[previous] === ({ me: "je", te: "tu", nous: "nous", vous: "vous" } as Record<string, string>)[token.lemma];
		if (!forms.get(token.form)?.some(lemma => ["être", "avoir"].includes(lemma)) && !["ne", "pas", "plus", "jamais", "déjà", "bien"].includes(token.lemma) && !token.form.endsWith("ment")) return false;
	}
	return false;
}

function isAuxiliary(tokens: Token[], index: number, text: string, lexicon: CopuleLexicon): boolean {
	// shortcut: adjectival past participles remain ambiguous; use contextual tagging to distinguish states and passives.
	for (let next = index + 1; next < tokens.length; next++) {
		const gap = text.slice(tokens[next - 1].end, tokens[next].start);
		if (!/^[\s'’*_]*$/u.test(gap) || /\n[ \t]*\n/u.test(gap)) return false;
		if (lexicon.participles.has(tokens[next].form)) return true;
		if (!lexicon.adverbs.has(tokens[next].form)) return false;
	}
	return false;
}

export function computeCopuleHighlights(text: string, lexicon: CopuleLexicon): Highlight[] {
	const { forms } = lexicon;
	const prose = maskMarkdown(text).replace(/^#{1,6}[ \t].*$/gm, line => " ".repeat(line.length));
	const tokens = tokenize(prose, new Map());
	const highlights: Highlight[] = [];
	const subjects: string[] = [];
	let subject = "";
	for (const [index, token] of tokens.entries()) {
		if (index > 0 && /[.!?;:\n]/u.test(prose.slice(tokens[index - 1].end, token.start))) subject = "";
		subjects.push(subject);
		const candidate = token.form.includes("-") ? token.form.split("-").at(-1)! : token.lemma;
		if (["je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ce", "ça", "cela", "personne"].includes(candidate)) subject = candidate;
		if (token.lemma !== token.form) continue;
		const form = token.form.replace(/-(?:(?:t|je|tu|il|elle|on|nous|vous|ils|elles|ce|moi|toi|le|la|les|lui|leur|en|y)-?)+$/u, "");
		// shortcut: nominal homographs share these forms; use contextual tagging if false positives become frequent.
		const matches = (forms.get(form) ?? []).filter(lemma =>
			(!["être", "avoir"].includes(lemma) || !isAuxiliary(tokens, index, text, lexicon)) &&
			(!pronominal(lemma) || /-(?:toi|nous|vous)(?:-|$)/u.test(token.form) || reflexiveBefore(tokens, index, prose, forms, subjects)));
		if (!matches.length) continue;
		highlights.push({ from: token.start, to: token.start + form.length, lemma: matches[0], title: matches.join(" · "), colorIndex: 0 });
	}
	return highlights;
}
