import { markdownLinks, mergeRanges, type TextRange } from "../markdown-links";
import { frontmatterRanges, maskMarkdownExclusions } from "../markdown-tags";
import { htmlTagRanges } from "../ai/annotations";

let parsed: { text: string; excluded: TextRange[] } | undefined;

export function countDocument(text: string, from = 0, to = text.length): { words: number; characters: number } {
	if (parsed?.text !== text) {
		const comments: TextRange[] = [...frontmatterRanges(text)];
		for (const match of text.matchAll(/<!--[\s\S]*?(?:-->|$)|%%[\s\S]*?(?:%%|$)/gu)) comments.push([match.index, match.index + match[0].length]);
		const source = maskMarkdownExclusions(text, mergeRanges(comments));
		const excluded: TextRange[] = [...comments, ...htmlTagRanges(source).map(({ from, to }) => [from, to] as const)];
		for (const link of markdownLinks(source)) {
			if (link.label) excluded.push([link.from, link.label[0]], [link.label[1], link.to]);
			else excluded.push([link.from, link.to]);
		}
		parsed = { text, excluded: mergeRanges(excluded) };
	}
	let visible = "", cursor = from;
	for (const [start, end] of parsed.excluded) {
		if (end <= cursor || start >= to) continue;
		visible += text.slice(cursor, Math.max(cursor, start));
		cursor = Math.min(to, end);
	}
	visible += text.slice(cursor, to);
	return {
		words: (visible.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[-’'][\p{L}\p{M}\p{N}]+)*/gu) ?? []).length,
		characters: Array.from(visible).length,
	};
}

export function formatDocumentCount(value: number, unit: "mot" | "signe"): string {
	return value >= 1000 ? `${String(Math.round(value / 100) / 10).replace(".", ",")}K` : `${value}${unit === "mot" ? "W" : "S"}`;
}
