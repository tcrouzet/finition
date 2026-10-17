import * as assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { build, type PluginBuild } from "esbuild";
import { rawAssets } from "../raw-assets.mjs";

async function main() {
	const directory = mkdtempSync(path.join(tmpdir(), "finition-click-"));
	copyFileSync(new URL("./check-tic-click.html", import.meta.url), path.join(directory, "index.html"));
	copyFileSync(new URL("../styles.css", import.meta.url), path.join(directory, "styles.css"));
	copyFileSync(new URL("../main.js", import.meta.url), path.join(directory, "main.js"));
	copyFileSync(new URL("../manifest.json", import.meta.url), path.join(directory, "manifest.json"));
	await build({
		stdin: { resolveDir: process.cwd(), contents: `
	import { EditorView } from "@codemirror/view";
	import { EditorState } from "@codemirror/state";
	import { finitionEditorExtension } from "./editor-extension";
	import { structureCategoryWords } from "./modes/structure-signature";
	import { DEFAULT_SETTINGS } from "./types";
	import { notices, menuOpenCount, setRequestHandler, requests, modals } from "obsidian";
	import { checkAnalysisNavigation } from "./scripts/check-analysis-navigation";
	import { checkSynonyms } from "./scripts/check-synonyms";
	import { checkGrammalecteRelease } from "./scripts/check-grammalecte-release";
	import ReleasedPlugin from "release-plugin";
	const text = "Il est important de noter que tout change.\\n\\nLe chat dort.";
	const runtime = {
	  settings: { ...DEFAULT_SETTINGS, mode: "tic-ia" }, settingsVersion: 0,
	  lexicon: new Map(), wordCategoryCacheVersion: 0,
	  wordCategoryCache: new Map(structureCategoryWords(text).map(word => [word, ""])),
	  ensureWordCategories() {}, updateTicIAStats() {}, updateAnalysisHighlights() {}
	};
	const view = new EditorView({ parent: document.querySelector("#editor"),
	  state: EditorState.create({ doc: text, extensions: [finitionEditorExtension(runtime)] }) });
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	requestAnimationFrame(async () => {
	  try {
	    const press = (position, target) => {
	      const coords = view.coordsAtPos(position);
	      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true,
	        clientX: coords.left + 1, clientY: (coords.top + coords.bottom) / 2, button: 0 }));
	    };
	    check(view.dom.querySelector(".finition-tic-ia"), "Surlignage absent");
	    press(5, view.contentDOM);
	    check(notices.length === 1 && notices[0].includes("Précaution permanente"), "Type absent quand la cible DOM ne porte pas le marqueur");
	    press(text.length - 3, view.contentDOM);
	    check(notices.length === 1, "Notification hors tic");
	    press(5, view.dom.querySelector(".finition-tic-ia"));
	    check(notices.length === 2, "Deuxième appui sans type");
	    runtime.settings.mode = "none";
	    press(5, view.contentDOM);
	    check(notices.length === 2, "Notification hors mode Tic IA");
	    view.destroy();
	    await checkAnalysisNavigation(() => menuOpenCount);
	    await checkSynonyms(setRequestHandler, requests, notices, modals);
	    await checkGrammalecteRelease(ReleasedPlugin);
	    document.querySelector("#result").textContent = "PASS: clics Tic IA ; navigation des analyses ; synonymes IA ; release Grammalecte";
	  } catch (error) { document.querySelector("#result").textContent = "FAIL: " + error.message; }
	});` },
		bundle: true, outfile: path.join(directory, "check.js"), loader: { ".md": "text" }, nodePaths: [path.join(process.cwd(), "node_modules")],
		plugins: [rawAssets, { name: "obsidian-notice", setup(plugin: PluginBuild) {
			plugin.onResolve({ filter: /^release-plugin$/ }, () => ({ path: path.join(directory, "main.js") }));
			plugin.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
			plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
				const configure = (element, options = {}) => {
				  element.className = options.cls ?? "";
				  if (options.text) element.textContent = options.text;
				  for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
				  return element;
				};
				HTMLElement.prototype.createEl = function(tag, options) { return this.appendChild(configure(document.createElement(tag), options)); };
				HTMLElement.prototype.createSpan = function(options) { return this.createEl("span", options); };
				HTMLElement.prototype.createDiv = function(options) { return this.createEl("div", options); };
				HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
				HTMLElement.prototype.toggleClass = function(name, value) { this.classList.toggle(name, value); };
				HTMLElement.prototype.setText = function(text) { this.textContent = text; };
				HTMLElement.prototype.empty = function() { this.replaceChildren(); };
				export class Component {
				  cleanup = []; load() {}
				  unload() { for (const cleanup of this.cleanup) cleanup(); this.cleanup = []; }
				  registerDomEvent(element, name, callback) { element.addEventListener(name, callback); this.cleanup.push(() => element.removeEventListener(name, callback)); }
				}
				export const modals = [];
				export class Modal {
				  constructor(app) {
				    this.app = app; this.containerEl = document.createElement("div");
				    this.containerEl.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center";
				    this.modalEl = this.containerEl.createDiv({ cls: "modal" });
				    this.modalEl.style.cssText = "width:400px;max-height:90vh;display:flex;flex-direction:column";
				    this.titleEl = this.modalEl.createEl("h2"); this.contentEl = this.modalEl.createDiv(); modals.push(this);
				  }
				  setTitle(title) { this.titleEl.textContent = title; return this; }
				  open() { document.body.appendChild(this.containerEl); this.onOpen(); }
				  close() { this.onClose(); this.containerEl.remove(); }
				}
				export class Plugin {
				  extensions = []; cleanup = []; saved = null;
				  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
				  async loadData() { return this.saved; }
				  async saveData(settings) { this.saved = settings; }
				  addStatusBarItem() { return document.body.appendChild(document.createElement("div")); }
				  registerDomEvent(element, name, callback) { element.addEventListener(name, callback); this.cleanup.push(() => element.removeEventListener(name, callback)); }
				  registerEditorExtension(extension) { this.extensions.push(extension); }
				  registerEvent() {} addCommand() {} addSettingTab() {}
				}
				export class MarkdownView {} export class PluginSettingTab {}
				export class ColorComponent {} export class DropdownComponent {} export class Setting {}
				export const normalizePath = (path) => path;
				export const requests = []; let requestHandler = null;
				export const setRequestHandler = (handler) => { requestHandler = handler; };
				export const requestUrl = (request) => { requests.push(request); if (!requestHandler) throw new Error("Requête réseau inattendue"); return requestHandler(request); };
				export let menuOpenCount = 0;
				export class Menu { addItem() {} addSeparator() {} showAtMouseEvent() { menuOpenCount++; } }
				export const setIcon = (element, name) => { element.dataset.icon = name; };
				export const notices = []; export class Notice { constructor(message) { notices.push(message); } hide() {} }
			` }));
		} }],
	});
	const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
		"--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(directory, "profile")}`,
		"--remote-debugging-pipe",
	], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
	const input = chrome.stdio[3] as Writable, output = chrome.stdio[4] as Readable;
	const pending = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>();
	let sequence = 0, buffer = "", stderr = "";
	let onPageLoad: (() => void) | undefined;
	chrome.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
	const exited = new Promise<number | null>(resolve => chrome.once("close", (code, signal) => {
		for (const request of pending.values()) request.reject(new Error(`Chromium arrêté : ${signal ?? code}; ${stderr}`));
		resolve(code);
	}));
	chrome.on("error", error => { for (const request of pending.values()) request.reject(error); });
	output.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		let end: number;
		while ((end = buffer.indexOf("\0")) !== -1) {
			const response = JSON.parse(buffer.slice(0, end)) as { id?: number; method?: string; result?: Record<string, unknown>; error?: { message: string } };
			buffer = buffer.slice(end + 1);
			if (response.method === "Page.loadEventFired") onPageLoad?.();
			if (response.id === undefined) continue;
			const request = pending.get(response.id);
			pending.delete(response.id);
			if (response.error) request?.reject(new Error(response.error.message));
			else request?.resolve(response.result ?? {});
		}
	});
	const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
		const id = ++sequence;
		pending.set(id, { resolve, reject });
		input.write(JSON.stringify({ id, method, params, sessionId }) + "\0");
	});
	const timer = setTimeout(() => { chrome.kill(); }, 20000);
	try {
		const target = await command("Target.createTarget", { url: "about:blank" });
		const { sessionId } = await command("Target.attachToTarget", { targetId: target.targetId, flatten: true });
		assert.equal(typeof sessionId, "string");
		const session = sessionId as string;
		await command("Page.enable", {}, session);
		const loaded = new Promise<void>(resolve => { onPageLoad = resolve; });
		await command("Page.navigate", { url: `file://${path.join(directory, "index.html")}` }, session);
		await Promise.race([loaded, exited.then(code => { throw new Error(`Chromium arrêté avant chargement : ${code}; ${stderr}`); })]);
		const evaluation = await command("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `new Promise(resolve => {
		  const observer = new MutationObserver(check);
		  function check() { const result = document.querySelector("#result"); if (result && result.textContent !== "PENDING") { observer.disconnect(); resolve(result.textContent); } }
		  observer.observe(document, { subtree: true, childList: true, characterData: true }); check();
		})` }, session);
		const result = (evaluation.result as { value?: string } | undefined)?.value;
		assert.equal(result, "PASS: clics Tic IA ; navigation des analyses ; synonymes IA ; release Grammalecte", JSON.stringify(evaluation));
		input.write(JSON.stringify({ id: ++sequence, method: "Browser.close" }) + "\0");
		assert.equal(await exited, 0, stderr);
		process.stdout.write(`${result}\n`);
	} finally {
		clearTimeout(timer);
		if (chrome.exitCode === null) chrome.kill();
		await exited;
		rmSync(directory, { recursive: true, force: true });
	}
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
