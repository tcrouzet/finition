import { cleanTypography, hasResponseText } from "./clean";
import { diffToGroups, type DiffGroup } from "./diff";
import { markdownLinks, linkRanges, mergeRanges, type MarkdownLink } from "../markdown-links";
import { frontmatterRanges, hashtagRanges } from "../markdown-tags";
import { annotationRanges, htmlTagRanges, stripHTMLTags } from "./annotations";

function preserveNumberSpaces(source: string, revised: string): string {
	const numbers = /(\d+(?:[.,]\d+)?)([\u00a0\u202f \t]+)/gu;
	const originals = Array.from(source.matchAll(numbers));
	const sameCount = originals.length === Array.from(revised.matchAll(numbers)).length;
	const unique = new Map<string, string | null>();
	for (const match of originals) unique.set(match[1], unique.has(match[1]) ? null : match[2]);
	let index = 0;
	return revised.replace(numbers, (match: string, number: string) => {
		const spaces = sameCount ? originals[index++][2] : unique.get(number);
		const nonbreaking = spaces?.match(/[\u00a0\u202f]/u)?.[0];
		return nonbreaking ? number + nonbreaking : match;
	});
}

export function protectLinks(original: string, from = 0, to = original.length, links: readonly MarkdownLink[] = markdownLinks(original)): { text: string; diff: (revised: string) => DiffGroup[] } {
	const tags = hashtagRanges(original);
	const spans: MarkdownLink[] = [...frontmatterRanges(original).map(([from, to]) => ({ from, to })), ...links, ...annotationRanges(original), ...htmlTagRanges(original), ...tags.map(([start, stop]) => {
		let end = stop;
		while (/[ \t\u00a0\u202f]/u.test(original[end] ?? "")) end++;
		if (end === original.length || /[\r\n]/u.test(original[end])) while (start > 0 && /[ \t\u00a0\u202f]/u.test(original[start - 1])) start--;
		return { from: start, to: end };
	})].sort((left, right) => left.from - right.from || right.to - left.to);
	let text = "", cursor = from;
	const parts: Array<{ from: number; to: number; source: number }> = [];
	const append = (end: number) => {
		if (end <= cursor) return;
		parts.push({ from: text.length, to: text.length + end - cursor, source: cursor - from });
		text += original.slice(cursor, end);
	};
	for (const link of spans) {
		if (link.to <= cursor || link.from >= to) continue;
		append(Math.max(from, link.from));
		if (link.label) {
			let label = original.slice(Math.max(from, cursor, link.label[0]), Math.min(to, link.label[1]));
			label = stripHTMLTags(label);
			for (const [start, end] of mergeRanges([...linkRanges(label), ...hashtagRanges(label)]).reverse()) label = label.slice(0, start) + label.slice(end);
			text += label;
		}
		cursor = Math.min(to, link.to);
	}
	append(to);
	return { text, diff(revised) {
		const groups: DiffGroup[] = [];
		// Les séparateurs Markdown en fin de plage restent ceux du texte source.
		const cleaned = cleanTypography(stripHTMLTags(revised)).replace(/[\r\n]*$/u, text.match(/[\r\n]*$/u)?.[0] ?? "");
		for (const group of diffToGroups(text, preserveNumberSpaces(text, cleaned))) {
			let start = group.delFrom, end = group.delTo, replacement = group.insText ?? "";
			if (!parts.some(part => start >= part.from && end <= part.to)) {
				while (start < end && replacement && text[start] === replacement[0]) { start++; replacement = replacement.slice(1); }
				while (end > start && replacement && text[end - 1] === replacement[replacement.length - 1]) { end--; replacement = replacement.slice(0, -1); }
			}
			if (start === end && !replacement) continue;
			// Seule une plage de prose contiguë est modifiable ; les liens restent intacts.
			const part = parts.find(part => start >= part.from && end <= part.to);
			if (!part) continue;
			const delFrom = part.source + start - part.from, delTo = part.source + end - part.from;
			// Une modification voisine ne doit pas accoler un mot au hashtag.
			if (tags.some(([start, end]) => delFrom + from === end && !/^\s/u.test(replacement) || delTo + from === start && !/\s$/u.test(replacement))) continue;
			// Regrouper après filtrage évite d’absorber le texte protégé d’un lien.
			const previous = groups[groups.length - 1];
			const gap = previous ? original.slice(from + previous.delTo, from + delFrom) : "";
			if (previous && /^[ \t\u00a0\u202f]*$/.test(gap)) {
				previous.delText += gap + original.slice(from + delFrom, from + delTo);
				previous.insText = (previous.insText ?? "") + gap + replacement || null;
				previous.delTo = delTo;
			} else groups.push({ delFrom, delTo, delText: original.slice(from + delFrom, from + delTo), insText: replacement || null });
		}
		for (const group of groups) {
			const position = from + group.delFrom;
			const lineStart = position === 0 ? 0 : original.lastIndexOf("\n", position - 1) + 1;
			if (!hasResponseText(original.slice(lineStart, position))) {
				if (!hasResponseText(group.delText + (group.insText ?? "")) && !/[\r\n]/u.test(group.delText + (group.insText ?? ""))) { group.delText = ""; group.insText = null; continue; }
				if (group.insText) group.insText = (group.delText.match(/^[ \t]*/u)?.[0] ?? "") + group.insText.replace(/^[\p{Zs}\p{Cf}\t]+/u, "");
			}
			while (group.delText && group.insText && group.delText[0] === group.insText[0] && /^[ \t\u00a0\u202f]$/.test(group.delText[0])) {
				group.delFrom++; group.delText = group.delText.slice(1); group.insText = group.insText.slice(1);
			}
			while (group.delText && group.insText && group.delText.slice(-1) === group.insText.slice(-1) && /^[ \t\u00a0\u202f]$/.test(group.delText.slice(-1))) {
				group.delTo--; group.delText = group.delText.slice(0, -1); group.insText = group.insText.slice(0, -1);
			}
			group.insText = group.insText || null;
		}
		return groups.filter(group => group.delText || group.insText);
	} };
}
