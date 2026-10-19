import type { TextRange } from "./markdown-links";

export function hashtagRanges(text: string): TextRange[] {
	const tags = /(?<![\p{L}\p{M}\p{N}_/#\\])#[\p{L}\p{M}\p{N}\p{S}\u200d_-]+(?:\/[\p{L}\p{M}\p{N}\p{S}\u200d_-]+)*/gu;
	return [...text.matchAll(tags)].filter(match => !/^\p{N}+$/u.test(match[0].slice(1))).map(match => [match.index, match.index + match[0].length]);
}

export function maskHashtags(text: string, ranges = hashtagRanges(text)): string {
	let masked = "", cursor = 0;
	for (const [from, to] of ranges) {
		masked += text.slice(cursor, from) + " ".repeat(to - from);
		cursor = to;
	}
	return masked + text.slice(cursor);
}
