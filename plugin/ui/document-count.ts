export function countDocument(text: string): { words: number; characters: number } {
	return {
		words: (text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[-’'][\p{L}\p{M}\p{N}]+)*/gu) ?? []).length,
		characters: Array.from(text).length,
	};
}

export function formatDocumentCount(value: number, unit: "mot" | "signe"): string {
	return value >= 1000 ? `${String(Math.round(value / 100) / 10).replace(".", ",")}K` : `${value}${unit === "mot" ? "W" : "S"}`;
}
