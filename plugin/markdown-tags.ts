import { mergeRanges, type TextRange } from "./markdown-links";

export function frontmatterRanges(text: string): TextRange[] {
	const opening = /^\ufeff?---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!opening) return [];
	const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
	closing.lastIndex = opening[0].length;
	const end = closing.exec(text);
	return [[0, end ? closing.lastIndex : text.length]];
}

export function markdownExclusionRanges(text: string): TextRange[] {
	return mergeRanges([...frontmatterRanges(text), ...hashtagRanges(text)]);
}

export function maskMarkdownExclusions(text: string, ranges = markdownExclusionRanges(text)): string {
	return maskHashtags(text, ranges);
}

export function hashtagRanges(text: string): TextRange[] {
	const tags = /(?<![\p{L}\p{M}\p{N}_/#\\])#[\p{L}\p{M}\p{N}\p{S}\u200d_-]+(?:\/[\p{L}\p{M}\p{N}\p{S}\u200d_-]+)*/gu;
	return [...text.matchAll(tags)].filter(match => !/^\p{N}+$/u.test(match[0].slice(1))).map(match => [match.index, match.index + match[0].length]);
}

export function maskHashtags(text: string, ranges = hashtagRanges(text)): string {
	let masked = "", cursor = 0;
	for (const [from, to] of ranges) {
		masked += text.slice(cursor, from) + text.slice(from, to).replace(/[^\r\n]/g, " ");
		cursor = to;
	}
	return masked + text.slice(cursor);
}
