const blank = (text: string): string => text.replace(/[^\r\n]/g, " ");

export function maskMarkdown(text: string): string {
	let prose = text.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, blank);
	const fences = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm;
	let opening: RegExpExecArray | null;
	while ((opening = fences.exec(prose))) {
		const marker = opening[1];
		const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*(?:\\r?\\n|$)`, "gm");
		closing.lastIndex = fences.lastIndex;
		const end = closing.exec(prose);
		const stop = end ? closing.lastIndex : prose.length;
		prose = prose.slice(0, opening.index) + blank(prose.slice(opening.index, stop)) + prose.slice(stop);
		fences.lastIndex = stop;
	}
	// shortcut: prose-oriented masking, use a Markdown parser if full syntax coverage becomes necessary.
	return prose.replace(/(`+)[^`]*?\1|!?\[\[[^\]\r\n]*\]\]|!?\[[^\]\r\n]*\]\([^)\r\n]*\)|https?:\/\/[^\s)]+/g, blank);
}
