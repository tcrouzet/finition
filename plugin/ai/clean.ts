import { protectSpans, fixPunctuationSpacing, fixBlankLines } from "../modes/punctuation";

export function hasResponseText(text: unknown): text is string {
	return typeof text === "string" && /[^\s\p{Cf}]/u.test(text);
}

export function cleanTypography(text: string): string {
	const protectedText = protectSpans(text);
	const fixed = fixBlankLines(fixPunctuationSpacing(protectedText.text)).replace(/[\u200b\ufeff]/g, "");
	return protectedText.restore(fixed);
}
