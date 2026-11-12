import type { MarkdownLink } from "../markdown-links";

const annotationTag = /<(\/?)(sup|sub)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const htmlMarkup = /<!--[\s\S]*?(?:-->|$)|<\/?[a-z][a-z0-9._-]*(?::[a-z][a-z0-9._-]*)?(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>|<![a-z](?:[^"'<>]|"[^"]*"|'[^']*')*>|<\?[\s\S]*?\?>/gi;

export function stripHTMLTags(text: string): string {
	return text.replace(htmlMarkup, "");
}

export function htmlTagRanges(text: string): MarkdownLink[] {
	return Array.from(text.matchAll(htmlMarkup), match => ({ from: match.index, to: match.index + match[0].length }));
}

export function annotationRanges(text: string): MarkdownLink[] {
	const spans: MarkdownLink[] = [];
	const openings: Array<{ name: string; from: number }> = [];
	for (const match of text.matchAll(annotationTag)) {
		const from = match.index, to = from + match[0].length, name = match[2].toLowerCase();
		spans.push({ from, to });
		if (match[1]) {
			const index = openings.map(open => open.name).lastIndexOf(name);
			if (index < 0) continue;
			const open = openings[index];
			openings.splice(index);
			let start = open.from, end = to;
			while (start > 0 && /[\p{L}\p{M}\p{N}_]/u.test(text[start - 1])) start--;
			while (end < text.length && /[\p{L}\p{M}\p{N}_]/u.test(text[end])) end++;
			spans.push({ from: start, to: end, label: [start, end] });
		} else if (!/\/\s*>$/.test(match[0])) openings.push({ name, from });
	}
	return spans;
}
