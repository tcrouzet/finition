import { Notice, setIcon } from "obsidian";

export function loadingMessage(text: string, cancel?: () => void): DocumentFragment {
	const message = createFragment();
	const spinner = createSpan({ cls: "finition-correction-spinner", attr: { "aria-hidden": "true" } });
	setIcon(spinner, "loader-circle");
	message.append(spinner, text);
	if (cancel) {
		const button = createEl("button", { cls: "clickable-icon finition-loading-cancel", attr: { type: "button", "aria-label": "Arrêter l’opération", title: "Arrêter l’opération" } });
		setIcon(button, "x");
		button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); cancel(); });
		message.append(button);
	}
	return message;
}

export class LoadingNotice extends Notice {
	cancelled = false;
	constructor(text: string, private readonly onCancel?: () => void) {
		super("", 0);
		this.setMessage(text);
	}
	setMessage(message: string | DocumentFragment): this {
		if (!this.cancelled) super.setMessage(typeof message === "string" ? loadingMessage(message, () => this.cancel()) : message);
		return this;
	}
	cancel(): void {
		if (this.cancelled) return;
		this.cancelled = true;
		this.hide();
		this.onCancel?.();
	}
}
