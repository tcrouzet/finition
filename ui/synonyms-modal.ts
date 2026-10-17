import { App, Component, Modal, Notice } from "obsidian";

export class SynonymsModal extends Modal {
	private events = new Component();

	constructor(app: App, private selection: string, private synonyms: string[], private replace: (synonym: string) => boolean) {
		super(app);
		this.shouldRestoreSelection = false;
	}

	onOpen(): void {
		this.events.load();
		this.setTitle("Synonymes IA");
		this.enableDragging();
		this.contentEl.createEl("blockquote", { text: this.selection });
		this.contentEl.createEl("p", { text: "Choisis une proposition pour remplacer la sélection, ou copie-la." });
		const list = this.contentEl.createEl("ul", { cls: "finition-synonyms" });
		for (const synonym of this.synonyms) {
			const row = list.createEl("li");
			const choice = row.createEl("button", { text: synonym, cls: "finition-synonym-replace", attr: { "aria-label": `Remplacer par ${synonym}` } });
			const copy = row.createEl("button", { text: "Copier", attr: { "aria-label": `Copier ${synonym}` } });
			this.events.registerDomEvent(choice, "click", () => { if (this.replace(synonym)) this.close(); });
			this.events.registerDomEvent(copy, "click", () => {
				void this.copyText(synonym, "Synonyme copié.");
			});
		}
		const footer = this.modalEl.createDiv({ cls: "modal-button-container finition-synonyms-footer" });
		const copyAll = footer.createEl("button", { text: "Copier toute la liste" });
		this.events.registerDomEvent(copyAll, "click", () => {
			void this.copyText(this.synonyms.map(synonym => `- ${synonym}`).join("\n"), "Liste copiée.");
		});
	}

	onClose(): void {
		this.events.unload();
		this.contentEl.empty();
		this.modalEl.querySelector(".finition-synonyms-footer")?.remove();
	}

	private enableDragging(): void {
		const doc = this.modalEl.ownerDocument;
		const win = doc.defaultView!;
		let x = 0, y = 0;
		let drag: { id: number; startX: number; startY: number; x: number; y: number; bounds: DOMRect } | null = null;
		this.modalEl.style.removeProperty("translate");
		this.titleEl.addClass("finition-synonyms-drag-handle");
		this.titleEl.title = "Déplacer la fenêtre";
		this.events.registerDomEvent(this.titleEl, "pointerdown", event => {
			if (event.button !== 0) return;
			drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x, y, bounds: this.modalEl.getBoundingClientRect() };
			event.preventDefault();
		});
		this.events.registerDomEvent(doc, "pointermove", event => {
			if (!drag || event.pointerId !== drag.id) return;
			if (!(event.buttons & 1)) { drag = null; return; }
			const { bounds } = drag;
			const left = Math.max(0, Math.min(bounds.left + event.clientX - drag.startX, win.innerWidth - bounds.width));
			const top = Math.max(0, Math.min(bounds.top + event.clientY - drag.startY, win.innerHeight - bounds.height));
			x = drag.x + left - bounds.left;
			y = drag.y + top - bounds.top;
			this.modalEl.style.translate = `${x}px ${y}px`;
		});
		const stop = () => { drag = null; };
		this.events.registerDomEvent(doc, "pointerup", stop);
		this.events.registerDomEvent(doc, "pointercancel", stop);
		this.events.registerDomEvent(win, "blur", stop);
	}

	private async copyText(text: string, message: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			new Notice(message);
		} catch {
			new Notice("Copie impossible.");
		}
	}
}
