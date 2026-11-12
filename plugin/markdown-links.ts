export type TextRange = readonly [number, number];
export interface MarkdownLink { from: number; to: number; label?: TextRange }
const definitions = /^ {0,3}\[((?:\\.|[^\]\\\r\n])+)\]:[^\r\n]+/gm;
const candidates = /!\[\[[^\]\r\n]*\]\]|\[\[[^\]\r\n]*\]\]|!?\[(?:\\.|[^\]\\])*\]|<a\b[^>]*>[\s\S]*?<\/a\s*>|<[a-z][a-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>|<(?:[a-z][a-z0-9+.-]*:[^<>\r\n]*|[^<>\s]+@[^<>\s]+)>/gi;
const addresses = /[a-z][a-z0-9+.-]*:\/\/[^\s<>]+|(?:mailto|tel|sms):[^\s<>]+|www\.[^\s<>]+|[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu;
const referenceKey = (label: string) => label.replace(/\\(.)/g, "$1").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

function closingEnd(text: string, start: number, opening: string, closing: string): number {
	let depth = 0, quote = "";
	for (let index = start; index < text.length; index++) {
		const char = text[index];
		if (char === "\\") { index++; continue; }
		if (quote) { if (char === quote) quote = ""; continue; }
		if (opening === "(" && depth && (char === "<" || ((char === '"' || char === "'") && /\s/.test(text[index - 1])))) { quote = char === "<" ? ">" : char; continue; }
		if (char === opening) depth++;
		if (char === closing && --depth === 0) return index + 1;
	}
	return -1;
}

export function markdownLinks(text: string): MarkdownLink[] {
	const references = [...text.matchAll(definitions)];
	const links: MarkdownLink[] = references.map(match => {
		const end = match.index + match[0].length;
		return { from: match.index, to: end + (text[end] === "\r" && text[end + 1] === "\n" ? 2 : Number(text[end] === "\n")) };
	});
	const ids = new Set(references.map(match => referenceKey(match[1])));
	for (const match of [...text.matchAll(candidates), ...text.matchAll(addresses)]) {
		const start = match.index;
		if (links.some(({ from, to }) => start >= from && start < to)) continue;
		let end = start + match[0].length;
		let label: TextRange | undefined;
		if (/^!?\[/.test(match[0])) {
			const bracket = start + Number(text[start] === "!");
			let escapes = 0;
			for (let index = start - 1; index >= 0 && text[index] === "\\"; index--) escapes++;
			if (escapes % 2) continue;
			end = closingEnd(text, bracket, "[", "]");
			if (end < 0) continue;
			if (/^!?\[\[/.test(match[0]) && text[end] !== "(") {
				const alias = text.indexOf("|", bracket + 2);
				label = [alias >= 0 && alias < end ? alias + 1 : bracket + 2, end - 2];
			} else {
				label = [bracket + 1, end - 1];
				if (text[end] === "(") end = closingEnd(text, end, "(", ")");
				else if (/^[ \t]*(?:\r?\n[ \t]*)?\[/.test(text.slice(end))) end = closingEnd(text, end + text.slice(end).search(/\[/), "[", "]");
				else if (!ids.has(referenceKey(text.slice(bracket + 1, end - 1)))) continue;
			}
			if (end < 0) continue;
		} else if (/^<a\b/i.test(match[0])) {
			const opening = /^<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(match[0]);
			if (opening) label = [start + opening[0].length, start + match[0].search(/<\/a\s*>$/i)];
		} else if (/^<img\b/i.test(match[0])) {
			const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(match[0]);
			if (alt) { const from = start + alt.index + alt[0].indexOf(alt[1]) + 1; label = [from, from + alt[2].length]; }
		}
		links.push({ from: start, to: end, label });
	}
	return links.sort((left, right) => left.from - right.from);
}

export function linkRanges(text: string): TextRange[] {
	return mergeRanges(markdownLinks(text).map(({ from, to }) => [from, to]));
}

export function selectionTouchesLink(text: string, from: number, to: number): boolean {
	return linkRanges(text).some(([start, end]) => from < end && to > start);
}

export function mergeRanges(ranges: readonly TextRange[]): Array<[number, number]> {
	const merged: Array<[number, number]> = [];
	for (const [from, to] of [...ranges].sort((left, right) => left[0] - right[0])) {
		const previous = merged[merged.length - 1];
		if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to);
		else merged.push([from, to]);
	}
	return merged;
}

