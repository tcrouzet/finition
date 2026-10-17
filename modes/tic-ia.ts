import * as rulesData from "../data/tic-ia.json";
import { Highlight, PALETTE_SIZE } from "../types";
import { sentenceRanges, trimRange, WORD_RE } from "./clause-split";
import { GetCategory, analyzeSentenceStructure, tricolonMembership } from "./structure-signature";
import { tokenize } from "./tokenize";

interface Dictionary {
	expressions?: string[];
	lemmas?: string[];
	frames?: string[][];
	connectors?: string[];
	stopWords?: string[];
	minimumWords?: number;
	maximumWords?: number;
	minimum?: number;
	tolerance?: number;
	requireBoundary?: boolean;
	requireFrame?: boolean;
	end?: string;
}

interface Rule {
	id: string;
	label: string;
	detector: string;
	patterns?: string[];
	window?: number;
	position?: string;
	minimum?: number;
	scope?: string;
	dictionary?: Dictionary;
}

export interface TicSentence {
	from: number;
	to: number;
	text: string;
	structure: string;
	rules: string[];
}

export interface TicIAResult {
	sentences: TicSentence[];
	totalSentences: number;
	taggedSentences: number;
	percentage: number;
	highlights: Highlight[];
}

const rules: Rule[] = rulesData.rules;
interface Frame {
	markers: RegExp[];
	pattern: RegExp;
}

interface CompiledRule {
	rule: Rule;
	literal: RegExp[];
	lexical: RegExp[];
	connectors: RegExp[];
	frames: Frame[];
	lexicalFrames: Frame[];
}
const emptyLexicon = new Map<string, string>();
const dictionaries = new WeakMap<Map<string, string>, CompiledRule[]>();

function normalize(text: string): string {
	return text.toLowerCase().replace(/[’ʼ]/g, "'").replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
	return normalize(text).match(/[\p{L}]+/gu) ?? [];
}

function literalSource(expression: string): string {
	return normalize(expression).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
}

function bounded(source: string): RegExp {
	return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${source})${source.endsWith("'") ? "" : "(?![\\p{L}\\p{N}])"}`, "u");
}

function lexicalText(text: string, lexicon: Map<string, string>): string {
	return tokenize(text, lexicon).map((token) => token.lemma).join(" ");
}

function compileFrame(frame: string[], requireBoundary: boolean): Frame {
	return {
		markers: frame.map((marker) => bounded(literalSource(marker))),
		pattern: requireBoundary
			? new RegExp(`(?:^|[,;:.!?])\\s*${frame.map(literalSource).join(".+?[,;:]\\s*")}(?![\\p{L}\\p{N}])`, "u")
			: bounded(frame.map(literalSource).join(".+?")),
	};
}

function compileDictionaries(lexicon: Map<string, string>): CompiledRule[] {
	const cached = dictionaries.get(lexicon);
	if (cached) return cached;
	const compiled = rules.map((rule) => {
		const dictionary = rule.dictionary;
		const expressions = dictionary?.requireFrame ? [] : dictionary?.expressions ?? [];
		const lemmas = dictionary?.requireFrame ? [] : dictionary?.lemmas ?? [];
		return {
			rule,
			literal: [...(rule.patterns ?? []).map(bounded), ...expressions.map((entry) => bounded(literalSource(entry)))],
			lexical: [...new Set([...expressions, ...lemmas].map((entry) => lexicalText(entry, lexicon)))]
				.filter(Boolean).map((entry) => bounded(literalSource(entry))),
			connectors: (dictionary?.connectors ?? []).map((entry) => bounded(literalSource(entry))),
			frames: (dictionary?.frames ?? []).map((frame) => compileFrame(frame, dictionary?.requireBoundary ?? false)),
			lexicalFrames: (dictionary?.frames ?? []).map((frame) => compileFrame(frame.map((entry) => lexicalText(entry, lexicon)), dictionary?.requireBoundary ?? false)),
		};
	});
	dictionaries.set(lexicon, compiled);
	return compiled;
}

function parallelPair(text: string, connector: RegExp, getCategory: GetCategory, minimumWords: number): boolean {
	const match = connector.exec(text);
	if (!match) return false;
	const members = [text.slice(0, match.index), text.slice(match.index + match[0].length)];
	if (members.some((member) => words(member).length < minimumWords)) return false;
	const profiles = members.map((member) => analyzeSentenceStructure(member, 0, member.length, getCategory)
		.map((group) => group.displayTokens.filter((role) => role !== "COMPLÉMENT").join(" ")).join(" , "));
	return profiles[0] !== "" && profiles[0] === profiles[1];
}

function completeBinaryFrame(frame: Frame, text: string): boolean {
	let cursor = 0;
	for (let index = 0; index < frame.markers.length; index++) {
		const marker = frame.markers[index];
		const count = [...text.matchAll(new RegExp(marker.source, "gu"))].length;
		if (count !== (frame.markers[0].source === frame.markers[1]?.source ? 2 : 1)) return false;
		const match = marker.exec(text.slice(cursor));
		if (!match || (index > 0 && !/\p{L}/u.test(text.slice(cursor, cursor + match.index)))) return false;
		cursor += match.index + match[0].length;
	}
	return /\p{L}/u.test(text.slice(cursor));
}

export function analyzeTicIA(text: string, getCategory: GetCategory, lexicon: Map<string, string> = emptyLexicon): TicIAResult {
	// Masquage de même longueur : les plages de surlignage restent celles de la note.
	const mask = (block: string) => block.replace(/[^\r\n]/g, " ");
	const prose = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, mask)
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*(?:\n|$)/gm, mask);
	const sentences: TicSentence[] = [];
	const ternaries: Array<{ any: boolean; verbal: boolean }> = [];
	for (const [start, end] of sentenceRanges(prose)) {
		const [from, to] = trimRange(prose, start, end);
		const sentence = prose.slice(from, to);
		if (!/\p{L}/u.test(sentence)) continue;
		const groups = analyzeSentenceStructure(sentence, 0, sentence.length, getCategory);
		const structure = groups.map((group) => group.displayTokens.join(" ")).join(" , ");
		const membership = tricolonMembership(groups);
		ternaries.push({
			any: membership.some(Boolean),
			verbal: membership.some((member) => member !== null && membership.every((other, index) =>
				other?.groupId !== member.groupId || groups[index].displayTokens.includes("VERBE"))),
		});
		sentences.push({ from, to, text: text.slice(from, to), structure, rules: [] });
	}
	const normalized = sentences.map((sentence) => normalize(sentence.text));
	const lexical = sentences.map((sentence) => lexicalText(sentence.text, lexicon));
	const compiled = compileDictionaries(lexicon);
	const wordLists = sentences.map((sentence) => words(sentence.text));
	const tag = (index: number, id: string) => {
		if (!sentences[index].rules.includes(id)) sentences[index].rules.push(id);
	};

	for (const entry of compiled) {
		const { rule } = entry;
		if (!["pattern", "binary"].includes(rule.detector)) continue;
		for (let index = 0; index < sentences.length; index++) {
			if (rule.position === "last" && index !== sentences.length - 1) continue;
			if (rule.dictionary?.end && !normalized[index].endsWith(rule.dictionary.end)) continue;
			for (let size = 1; size <= (rule.window ?? 1) && index + size <= sentences.length; size++) {
				let found = false;
				for (const stream of [normalized, lexical]) {
					const window = stream.slice(index, index + size).join(" ");
					const frames = stream === normalized ? entry.frames : entry.lexicalFrames;
					const framePatterns = frames.filter((frame) => rule.detector !== "binary" || completeBinaryFrame(frame, window))
						.map((frame) => frame.pattern);
					const candidates = [...(stream === normalized ? entry.literal : entry.lexical), ...framePatterns];
					const match = candidates.map((pattern) => pattern.exec(window))
						.find((candidate) => candidate && candidate.index < stream[index].length);
					if (!match) continue;
					let offset = 0;
					for (let part = index; part < index + size; part++) {
						if (offset < match.index + match[0].length && offset + stream[part].length > match.index) tag(part, rule.id);
						offset += stream[part].length + 1;
					}
					found = true;
				}
				if (rule.detector === "binary" && size === 1 && entry.connectors.some((connector) =>
					parallelPair(normalized[index], connector, getCategory, rule.dictionary?.minimumWords ?? 3))) {
					tag(index, rule.id);
					found = true;
				}
				if (found) break;
			}
		}
	}

	for (let index = 0; index < sentences.length; index++) {
		const sentence = sentences[index];
		if (ternaries[index].any) {
			tag(index, "43");
			if (ternaries[index].verbal) tag(index, "06");
		}
		const answers = compiled.find((entry) => entry.rule.detector === "question-answer");
		if (sentence.text.includes("?") && index + 1 < sentences.length && answers?.literal.some((pattern) => pattern.exec(normalized[index + 1])?.index === 0)) {
			tag(index, "08"); tag(index + 1, "08");
		}
		const inversion = compiled.find((entry) => entry.rule.detector === "inversion");
		const separators = inversion?.connectors.map((connector) => connector.source).join("|") ?? ",|;|:";
		const halves = normalized[index].split(new RegExp(separators, "u")).filter((half) => half.trim());
		if (halves.length === 2) {
			const content = halves.map((half) => words(half).filter((word) => word.length > 3 && !(inversion?.rule.dictionary?.stopWords ?? []).includes(word)));
			if (content.every((part) => part.length >= 3) && content[0][0] === content[1][content[1].length - 1] && content[1][0] === content[0][content[0].length - 1]) tag(index, "05");
		}
	}

	for (const rule of rules.filter((rule) => ["anaphora", "fragments"].includes(rule.detector))) {
		const minimum = rule.minimum ?? rule.dictionary?.minimum ?? 3;
		const fragmentMaximum = rule.dictionary?.maximumWords ?? rulesData.settings.fragmentMaximumWords;
		for (let index = 0; index + minimum <= sentences.length; index++) {
			const indices = Array.from({ length: minimum }, (_, offset) => index + offset);
			if (rule.detector === "fragments") {
				if (indices.every((part) => wordLists[part].length <= fragmentMaximum && !sentences[part].structure.includes("VERBE"))) {
					for (const part of indices) tag(part, rule.id);
					const isFragment = (part: number) => sentences[part] && wordLists[part].length <= fragmentMaximum && !sentences[part].structure.includes("VERBE");
					if (!isFragment(index - 1) && !isFragment(index + minimum)) for (const part of indices) tag(part, "43");
				}
			} else {
				const prefixLength = wordLists[index][0] === "j" ? 3 : 2;
				const prefix = wordLists[index].slice(0, prefixLength).join(" ");
				const prefixes = compiled.find((entry) => entry.rule.id === rule.id);
				const knownPrefix = prefixes?.literal.some((pattern) => indices.every((part) => pattern.exec(normalized[part])?.index === 0)) ||
					prefixes?.lexical.some((pattern) => indices.every((part) => pattern.exec(lexical[part])?.index === 0));
				if (knownPrefix || (wordLists[index].length >= prefixLength && indices.every((part) => wordLists[part].slice(0, prefixLength).join(" ") === prefix))) {
					for (const part of indices) tag(part, rule.id);
				}
			}
		}
	}

	const shapes = new Map<string, number[]>();
	for (let index = 0; index < sentences.length; index++) {
		const sentence = sentences[index];
		if (!sentence.structure || wordLists[index].length < rulesData.settings.similarMinimumWords) continue;
		const neighbors = (shapes.get(sentence.structure) ?? []).filter((previous) => sentence.from - sentences[previous].from <= rulesData.settings.comparisonSpan);
		neighbors.push(index);
		shapes.set(sentence.structure, neighbors);
		if (neighbors.length >= rulesData.settings.similarMinimum) for (const part of neighbors) tag(part, "structure-repetee");
	}

	const paragraphs: Array<{ from: number; to: number; count: number }> = [];
	for (const match of prose.matchAll(/\S[\s\S]*?(?=\n[ \t]*\n|$)/g)) {
		const count = (match[0].match(WORD_RE) ?? []).length;
		if (/^#{1,6}\s/u.test(match[0])) continue;
		paragraphs.push({ from: match.index ?? 0, to: (match.index ?? 0) + match[0].length, count });
	}
	const paragraphRule = rules.find((rule) => rule.detector === "paragraphs");
	const minimum = paragraphRule?.minimum ?? paragraphRule?.dictionary?.minimum ?? 3;
	const tolerance = paragraphRule?.dictionary?.tolerance ?? rulesData.settings.paragraphTolerance;
	for (let index = 0; index + minimum <= paragraphs.length; index++) {
		const group = paragraphs.slice(index, index + minimum);
		const mean = group.reduce((sum, paragraph) => sum + paragraph.count, 0) / minimum;
		if (mean < (paragraphRule?.dictionary?.minimumWords ?? 20) || !group.every((paragraph) => Math.abs(paragraph.count - mean) <= mean * tolerance)) continue;
		for (let part = 0; part < sentences.length; part++) {
			if (sentences[part].from >= group[0].from && sentences[part].to <= group[group.length - 1].to) tag(part, "44");
		}
	}

	const tagged = sentences.filter((sentence) => sentence.rules.length > 0);
	return {
		sentences,
		totalSentences: sentences.length,
		taggedSentences: tagged.length,
		percentage: sentences.length === 0 ? 0 : tagged.length * 100 / sentences.length,
		highlights: tagged.map((sentence) => ({
			from: sentence.from, to: sentence.to, lemma: `tic-ia:${sentence.rules.join(",")}`,
			colorIndex: (rules.findIndex((rule) => rule.id === sentence.rules[0]) + PALETTE_SIZE) % PALETTE_SIZE,
			title: sentence.rules.map((id) => id === "structure-repetee" ? "Structure répétée" : rules.find((rule) => rule.id === id)?.label ?? id).join(" · "),
		})),
	};
}
