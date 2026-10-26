import type { Text } from "@codemirror/state";
import type { AIGroup } from "./ai-extension";
import { hasResponseText } from "./clean";

export function whitespaceDisplay(document: Text, group: AIGroup) {
	const text = group.delText + (group.insText ?? "");
	if (!text || hasResponseText(text)) return null;
	let anchor = group.delTo;
	if (/[\r\n]/u.test(text)) {
		anchor = group.delFrom;
		for (let number = document.lineAt(group.delFrom).number; number > 0; number--) {
			const line = document.line(number), end = Math.min(line.to, group.delFrom);
			if (hasResponseText(document.sliceString(line.from, end))) { anchor = end; break; }
		}
	}
	const label = (value: string) => value.replace(/\r\n?/g, "\n").replace(/\n/g, "¶").replace(/\s/gu, "·").replace(/\p{Cf}/gu, "◌");
	return { anchor, removed: label(group.delText), added: label(group.insText ?? "") };
}
