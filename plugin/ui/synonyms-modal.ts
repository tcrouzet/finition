import { App, Component, MarkdownView, Modal, setIcon } from "obsidian";
import { synonymKey, type SynonymGroup } from "../synonyms";

type DisplayGroup = Omit<SynonymGroup, "sources">;

export class SynonymsModal extends Modal {
	private events = new Component();
	private restoreFocus: () => void;

	constructor(app: App, view: MarkdownView, private selectedText: string, private synonyms: string[], private replace: (synonym: string) => boolean, private insertRemark: (text: string) => boolean, private title = "Synonymes IA", private groups: SynonymGroup[] = []) {
		super(app);
		this.shouldRestoreSelection = false;
		const editor = view.editor, file = view.file;
		this.restoreFocus = () => {
			if (app.workspace.getActiveViewOfType(MarkdownView) === view && view.file === file && view.editor === editor) editor.focus();
		};
	}

	onOpen(): void {
		this.events.load();
		this.setTitle(this.title);
		this.enableDragging();
		this.contentEl.addClass("finition-synonyms-content");
		this.contentEl.createEl("p", { text: this.selectedText, cls: "finition-synonyms-selection" });
		const groups: DisplayGroup[] = this.groups.length ? this.groups : [{ category: "", label: "", words: this.synonyms }];
		const sections = this.sections(groups);
		for (const section of sections) {
			const container = this.contentEl.createDiv({ cls: "finition-synonyms-section" });
			if (section.category) container.createEl("h3", { text: section.category, cls: "finition-synonyms-category" });
			for (const sense of section.senses) {
				const block = container.createDiv({ cls: "finition-synonyms-sense" });
				if (sense.definition) block.createEl(section.category ? "h4" : "h3", { text: sense.definition, cls: "finition-synonyms-definition" });
				const list = block.createEl("ul", { cls: "finition-synonyms-groups" });
				for (const group of sense.groups) {
					const item = list.createEl("li", { cls: "finition-synonyms-group" });
					this.wordList(item, this.baseWords(group), group.label);
					const branches = new Map<string, { item: HTMLElement; list: HTMLUListElement }>();
					for (const row of group.registers ?? []) {
						let parent: HTMLElement = item;
						for (let depth = 0; depth < row.labels.length; depth++) {
							const key = JSON.stringify(row.labels.slice(0, depth + 1));
							if (!branches.has(key)) {
								const nested = parent.querySelector<HTMLUListElement>(":scope > .finition-synonyms-registers") ?? parent.createEl("ul", { cls: "finition-synonyms-registers" });
								const child = nested.createEl("li");
								branches.set(key, { item: child, list: this.wordList(child, [], row.labels[depth], true) });
							}
							parent = branches.get(key)!.item;
						}
						this.appendWords(branches.get(JSON.stringify(row.labels))!.list, row.words);
					}
				}
			}
		}
		const footer = this.modalEl.createDiv({ cls: "modal-button-container finition-synonyms-footer" });
		const insert = footer.createEl("button", { cls: "clickable-icon finition-synonyms-insert", attr: { "aria-label": "Insérer la liste en remarque", title: "Insérer la liste en remarque" } });
		setIcon(insert, "message-square-plus");
		this.events.registerDomEvent(insert, "click", () => {
			const escape = (text: string) => text.replace(/([\\*_`[\]<>])/gu, "\\$1");
			const text = sections.map(section => [
				section.category ? `**${escape(section.category)}**` : "",
				...section.senses.map(sense => [
					sense.definition ? `**${escape(sense.definition)}**` : "",
					sense.groups.map(group => {
						const words = this.baseWords(group);
						return [
							`- ${group.label ? `**${escape(group.label)}**${words.length ? " — " : ""}` : ""}${words.map(escape).join(", ")}`,
							...(group.registers ?? []).map(row => `${"  ".repeat(row.labels.length)}- **${escape(row.labels.at(-1) ?? "")}** — ${row.words.map(escape).join(", ")}`),
						].join("\n");
					}).join("\n"),
				].filter(Boolean).join("\n\n")),
			].filter(Boolean).join("\n\n")).join("\n\n");
			if (this.insertRemark(`${this.title} — ${this.selectedText}\n\n${text}`)) this.close();
		});
	}

	private sections(groups: DisplayGroup[]) {
		const order = ["nom", "adjectif", "verbe", "adverbe", "pronom", "déterminant", "préposition", "conjonction", "interjection", "abréviation", "nombre", "onomatopée", "participe passé"];
		const aliases = new Map([["adj", "adjectif"], ["interj", "interjection"], ["determinant", "déterminant"], ["preposition", "préposition"], ["abreviation", "abréviation"]]);
		const sections = new Map<string, { category: string; groups: typeof groups }>();
		for (const group of groups) {
			const tags = group.category.trim().toLocaleLowerCase("fr").split(/\s+/u).map(tag => aliases.get(tag) ?? tag);
			const category = tags.every(tag => order.includes(tag))
				? [...new Set(tags)].sort((left, right) => order.indexOf(left) - order.indexOf(right)).join(" ou ")
				: tags.join(" ").replace(/^\?$/u, "");
			if (!sections.has(category)) sections.set(category, { category: category.charAt(0).toLocaleUpperCase("fr") + category.slice(1), groups: [] });
			sections.get(category)!.groups.push(group);
		}
		const rank = (category: string) => order.includes(category) ? order.indexOf(category) : order.length;
		return [...sections].sort(([left], [right]) => rank(left) - rank(right)).map(([, section]) => {
			const senses = new Map<string, DisplayGroup[]>();
			for (const group of section.groups) {
				const definition = group.sense ?? "";
				if (!senses.has(definition)) senses.set(definition, []);
				senses.get(definition)!.push(group);
			}
			return { category: section.category, senses: [...senses].map(([definition, groups]) => ({ definition, groups })) };
		});
	}

	private baseWords(group: DisplayGroup): string[] {
		if (group.unmarked) return group.unmarked;
		const marked = new Set(group.registers?.flatMap(row => row.words.map(synonymKey)));
		return group.words.filter(word => !marked.has(synonymKey(word)));
	}

	private wordList(parent: HTMLElement, words: string[], label = "", register = false): HTMLUListElement {
		const list = parent.createEl("ul", { cls: "finition-synonyms" });
		if (label) list.createEl("li", { cls: "finition-synonyms-label-item" }).createEl(register ? "span" : "strong", { text: label, cls: register ? "finition-synonyms-register" : "finition-synonyms-label" });
		this.appendWords(list, words);
		return list;
	}

	private appendWords(list: HTMLUListElement, words: string[]): void {
		if (words.length && list.children.length === 1 && list.firstElementChild?.classList.contains("finition-synonyms-label-item")) list.firstElementChild.createSpan({ text: " — " });
		for (const synonym of words) {
			const choice = list.createEl("li").createEl("button", { text: synonym, cls: "finition-synonym-replace", attr: { "aria-label": `Remplacer par ${synonym}`, title: `Remplacer par ${synonym}` } });
			this.events.registerDomEvent(choice, "click", () => { if (this.replace(synonym)) this.close(); });
		}
	}

	onClose(): void {
		this.events.unload();
		this.contentEl.empty();
		this.modalEl.querySelector(".finition-synonyms-footer")?.remove();
		this.restoreFocus();
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
}
