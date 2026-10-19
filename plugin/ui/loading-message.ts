import { setIcon } from "obsidian";

export function loadingMessage(text: string): DocumentFragment {
	const message = createFragment();
	const spinner = createSpan({ cls: "finition-correction-spinner", attr: { "aria-hidden": "true" } });
	setIcon(spinner, "loader-circle");
	message.append(spinner, text);
	return message;
}
