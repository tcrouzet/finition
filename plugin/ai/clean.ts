import { protectSpans, fixPunctuationSpacing, fixBlankLines } from "../modes/punctuation";

export function hasResponseText(text: unknown): text is string {
	return typeof text === "string" && /[^\s\p{Cf}]/u.test(text);
}

export function cleanParagraphStarts(text: string): string {
	// L’indentation ASCII reste intacte pour les listes et le code Markdown.
	return text.replace(/^([ \t]*)[\p{Cf}\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000][\p{Cf}\p{Zs}\t]*/gmu, "$1");
}

export function cleanTypography(text: string): string {
	const protectedText = protectSpans(text);
	const fixed = fixPunctuationSpacing(cleanParagraphStarts(protectedText.text)).replace(/[\u200b\ufeff]/g, "");
	return protectedText.restore(fixBlankLines(cleanParagraphStarts(fixed)));
}
