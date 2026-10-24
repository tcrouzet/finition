import * as assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { build, stop, type PluginBuild } from "esbuild";
import { rawAssets } from "../plugin/raw-assets.mjs";
import { resourceFiles, resourceAssetName } from "../plugin/linguistic-files";
import type { ResourcePack } from "../plugin/linguistic-files";
import { packageResources } from "./package-resources";
import { specializedFiles } from "../plugin/modes/finition-corrector/neural-assets";
import { personalDictionaryPath, personalDictionaryFile } from "../plugin/lexicon/shared";

async function main() {
	const releaseSize = ["main.js", "manifest.json", "styles.css"].reduce((sum, name) => sum + statSync(name).size, 0);
	assert.ok(releaseSize < 5_000_000, `Release trop volumineuse : ${releaseSize} octets`);
	const directory = mkdtempSync(path.join(tmpdir(), "finition-click-"));
	const resources = path.join(directory, "resources");
	await packageResources(resources);
	const privateFixtures = ["pack.json", ...specializedFiles].map(file => {
		const destination = path.join(directory, `private-${file.replace(/\//gu, "__")}`);
		copyFileSync(path.join(process.cwd(), "Antidote/model", file), destination);
		return destination;
	});
	if (existsSync(personalDictionaryPath)) {
		const destination = path.join(directory, `private-${personalDictionaryFile}`);
		copyFileSync(personalDictionaryPath, destination);
		privateFixtures.push(destination);
	}
	copyFileSync(new URL("./check-tic-click.html", import.meta.url), path.join(directory, "index.html"));
	copyFileSync(new URL("../styles.css", import.meta.url), path.join(directory, "styles.css"));
	copyFileSync(new URL("../main.js", import.meta.url), path.join(directory, "main.js"));
	copyFileSync(new URL("../manifest.json", import.meta.url), path.join(directory, "manifest.json"));
	await build({
		stdin: { resolveDir: process.cwd(), contents: `
	import { EditorView } from "@codemirror/view";
	import { EditorState } from "@codemirror/state";
	import { finitionEditorExtension } from "./plugin/editor-extension";
	import { structureCategoryWords } from "./plugin/modes/structure-signature";
	import { DEFAULT_SETTINGS } from "./plugin/types";
	import { notices, menuOpenCount, setRequestHandler, requests, modals, lastMenu } from "obsidian";
	import { checkAnalysisNavigation } from "./scripts/check-analysis-navigation";
	import { checkAICorrections } from "./scripts/check-ai-corrections";
	import { checkSynonyms } from "./scripts/check-synonyms";
	import { checkLocalSynonyms } from "./scripts/check-local-synonyms";
	import { checkWordDictionaries } from "./scripts/check-word-dictionaries";
	import { checkGrammalecteRelease } from "./scripts/check-grammalecte-release";
	import { checkFinitionCorrector } from "./scripts/check-finition-corrector";
	import { checkDictionaryCore } from "./scripts/check-finition-dictionnaire";
	import { checkFinitionNeural } from "./scripts/check-finition-neural";
	import { checkLinguisticInstallation } from "./scripts/check-linguistic-resources";
	import { checkNeuralModels } from "./scripts/check-neural-models";
	import { checkLexiconDictionaries } from "./scripts/check-lexicon-dictionaries";
	import { checkPromptModels } from "./scripts/check-prompt-models";
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
	    console.error("finition-test-step", "start", Math.round(performance.now()));
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
	    await checkAnalysisNavigation(() => menuOpenCount, () => lastMenu.items);
	    const grammarChecks = checkGrammalecteRelease(ReleasedPlugin).then(() => console.error("finition-test-step", "grammalecte", Math.round(performance.now())));
	    const neuralChecks = checkFinitionNeural(ReleasedPlugin).then(() => console.error("finition-test-step", "neural", Math.round(performance.now())));
	    const lexiconChecks = checkLexiconDictionaries(ReleasedPlugin);
	    checkAICorrections();
	    await checkPromptModels(ReleasedPlugin);
	    await checkSynonyms(setRequestHandler, requests, notices, modals);
	    await checkLinguisticInstallation(ReleasedPlugin, () => lastMenu.items, setRequestHandler);
	    await checkLocalSynonyms(ReleasedPlugin, () => lastMenu.items, setRequestHandler, requests, notices, modals);
	    await checkWordDictionaries(ReleasedPlugin, () => lastMenu.items, notices, modals, setRequestHandler);
	    checkDictionaryCore();
	    await Promise.all([
	      grammarChecks,
	      lexiconChecks,
	      checkFinitionCorrector(ReleasedPlugin, (engine = "finition-corrector") => lastMenu.items.find(item => item.title === (engine === "grammalecte" ? "Grammalecte" : engine === "ia" ? "Corrections IA" : "Neuronal"))).then(() => console.error("finition-test-step", "corrections-menu", Math.round(performance.now()))),
	      neuralChecks,
	      checkNeuralModels(ReleasedPlugin).then(() => console.error("finition-test-step", "neural-models", Math.round(performance.now())))
	    ]);
	    document.querySelector("#result").textContent = "PASS: clics Tic IA ; navigation des analyses ; synonymes et dictionnaires locaux ; réglages repliables ; release Grammalecte ; finition-corrector";
	  } catch (error) { document.querySelector("#result").textContent = "FAIL: " + error.message; }
	});` },
		bundle: true, outfile: path.join(directory, "check.js"), loader: { ".md": "text" }, nodePaths: [path.join(process.cwd(), "node_modules")],
		external: ["fs/promises", "fs", "os", "path", "process", "child_process"],
		plugins: [rawAssets, { name: "obsidian-notice", setup(plugin: PluginBuild) {
			plugin.onResolve({ filter: /^release-plugin$/ }, () => ({ path: path.join(directory, "main.js") }));
			plugin.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
			plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({ resolveDir: process.cwd(), contents: `
				import { StateField } from "@codemirror/state";
				export const Platform = { isDesktop: false };
				export const editorInfoField = StateField.define({ create: () => ({ file: null }), update: value => value });
				const configure = (element, options = {}) => {
				  element.className = options.cls ?? "";
				  if (options.text) element.textContent = options.text;
				  if (options.href) element.setAttribute("href", options.href);
				  for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
				  return element;
				};
				HTMLElement.prototype.createEl = function(tag, options) { return this.appendChild(configure(document.createElement(tag), options)); };
				HTMLElement.prototype.createSpan = function(options) { return this.createEl("span", options); };
				globalThis.createEl = (tag, options) => configure(document.createElement(tag), options);
				globalThis.createSpan = options => configure(document.createElement("span"), options);
				globalThis.createDiv = options => configure(document.createElement("div"), options);
				globalThis.createFragment = callback => { const fragment = document.createDocumentFragment(); callback?.(fragment); return fragment; };
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
				  extensions = []; cleanup = []; commands = []; saved = null;
				  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
				  async loadData() { return this.saved; }
				  async saveData(settings) { this.saved = settings; }
				  addStatusBarItem() { return document.body.appendChild(document.createElement("div")); }
				  registerDomEvent(element, name, callback) { element.addEventListener(name, callback); this.cleanup.push(() => element.removeEventListener(name, callback)); }
				  registerEditorExtension(extension) { this.extensions.push(extension); }
				  registerEvent() {} addCommand(command) { this.commands.push(command); } addSettingTab() {}
				  register(callback) { this.cleanup.push(callback); }
				}
				export class MarkdownView {} export class PluginSettingTab {
				  update() { this.settingItems = this.getSettingDefinitions(); this.containerEl.empty(); for (const definition of this.settingItems) { const setting = new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc ?? ""); definition.render?.(setting); } }
				} export class FileSystemAdapter {}
				export class ColorComponent {
				  constructor(parent) { this.inputEl = parent.createEl("input", { attr: { type: "color" } }); }
				  setValue(value) { this.inputEl.value = value; return this; }
				  onChange(callback) { this.inputEl.addEventListener("input", () => callback(this.inputEl.value)); return this; }
				}
				export class DropdownComponent {
				  constructor(parent) { this.selectEl = parent.createEl("select"); }
				  addOption(value, label) { const option = this.selectEl.createEl("option", { text: label }); option.value = value; return this; }
				  setValue(value) { this.selectEl.value = value; return this; }
				  setDisabled(disabled) { this.selectEl.disabled = disabled; return this; }
				  onChange(callback) { this.selectEl.addEventListener("change", () => callback(this.selectEl.value)); return this; }
				}
				export class Setting {
				  constructor(parent) { this.settingEl = parent.createDiv({ cls: "setting-item" }); this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" }); this.descEl = this.settingEl.createDiv(); this.controlEl = this.settingEl.createDiv(); }
				  setName(name) { this.nameEl.textContent = name; return this; }
				  setDesc(text) { this.descEl.replaceChildren(text); return this; }
				  setClass(name) { this.settingEl.classList.add(name); return this; }
				  setHeading() { this.settingEl.classList.add("setting-item-heading"); return this; }
				  addDropdown(callback) { callback(new DropdownComponent(this.controlEl)); return this; }
				  addText(callback) {
				    const input = this.controlEl.createEl("input", { attr: { type: "text" } });
				    callback({ inputEl: input, setValue(value) { input.value = value; return this; }, setPlaceholder(value) { input.placeholder = value; return this; }, setDisabled(value) { input.disabled = value; return this; }, onChange(action) { input.addEventListener("input", () => action(input.value)); return this; } }); return this;
				  }
				  addTextArea(callback) {
				    const input = this.controlEl.createEl("textarea");
				    callback({ inputEl: input, setValue(value) { input.value = value; return this; }, onChange(action) { input.addEventListener("input", () => action(input.value)); return this; } }); return this;
				  }
				  addToggle(callback) {
				    const input = this.controlEl.createEl("input", { attr: { type: "checkbox" } });
				    callback({ setValue(value) { input.checked = value; return this; }, onChange(action) { input.addEventListener("change", () => action(input.checked)); return this; } }); return this;
				  }
				  addButton(callback) {
				    const button = this.controlEl.createEl("button");
				    callback({ setButtonText(text) { button.textContent = text; return this; }, setDisabled(value) { button.disabled = value; return this; }, setDestructive() { return this; }, setCta() { button.classList.add("mod-cta"); return this; }, setTooltip(text) { button.title = text; return this; }, onClick(action) { button.addEventListener("click", action); return this; } }); return this;
				  }
				}
				export const normalizePath = (path) => path;
				export const requests = []; let requestHandler = null;
				export const setRequestHandler = (handler) => { requestHandler = handler; };
				export const requestUrl = (request) => { requests.push(request); if (!requestHandler) throw new Error("Requête réseau inattendue"); return requestHandler(request); };
				export let menuOpenCount = 0;
				export let lastMenu;
				export class Menu {
				  entries = [];
				  get items() { return this.entries.flatMap(item => item.submenu ? item.submenu.items : [item]); }
				  addItem(callback) {
				    const item = { title: "", checked: false, click: () => {},
				      setTitle(title) { this.title = title; return this; }, setIcon() { return this; },
				      setSubmenu() { return this.submenu = new Menu(); },
				      setChecked(checked) { this.checked = checked; return this; }, setDisabled(disabled) { this.disabled = disabled; return this; }, onClick(click) { this.click = click; return this; } };
				    callback(item); this.entries.push(item);
				  }
				  addSeparator() {} showAtMouseEvent() { lastMenu = this; menuOpenCount++; }
				}
				export const setIcon = (element, name) => { element.dataset.icon = name; };
				export const notices = []; export class Notice {
				  constructor(message) { this.noticeEl = document.body.createDiv({ cls: "notice" }); this.setMessage(message); }
				  setMessage(message) { notices.push(message); this.noticeEl.replaceChildren(message); }
				  hide() { this.noticeEl.remove(); }
				}
			` }));
		} }],
	});
	stop();
	const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
		"--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(directory, "profile")}`,
		"--disable-background-networking", "--disable-component-update",
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
			const response = JSON.parse(buffer.slice(0, end)) as { id?: number; method?: string; sessionId?: string; params?: { sessionId?: string; args?: Array<{ value?: unknown }> }; result?: Record<string, unknown>; error?: { message: string } };
			buffer = buffer.slice(end + 1);
			if (response.method === "Page.loadEventFired") onPageLoad?.();
			if (response.method === "Runtime.consoleAPICalled" && response.params?.args?.[0]?.value === "finition-test-step") process.stdout.write(response.params.args.map(item => item.value).join(" ") + "\n");
			if (response.method === "Runtime.consoleAPICalled" && response.params?.args?.[0]?.value === "finition-file-picker-click") {
				void command("Runtime.evaluate", { expression: 'document.querySelector("[data-finition-test-picker]").click()', userGesture: true }, response.sessionId);
			}
			if (response.method === "Page.fileChooserOpened") {
				void command("Runtime.evaluate", { expression: 'window.dispatchEvent(new Event("finition-file-picker-opened"))' }, response.sessionId);
			}
			if (response.method === "Target.attachedToTarget") {
				const workerSession = response.params!.sessionId!;
				void command("Runtime.enable", {}, workerSession).then(() => command("Network.enable", {}, workerSession))
					.then(() => command("Network.setBlockedURLs", { urls: ["http://*", "https://*"] }, workerSession))
					.then(() => command("Runtime.runIfWaitingForDebugger", {}, workerSession));
			}
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
		await command("Page.setInterceptFileChooserDialog", { enabled: true }, session);
		await command("Runtime.enable", {}, session);
		await command("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, session);
		await command("Network.enable", {}, session);
		await command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, session);
		const loaded = new Promise<void>(resolve => { onPageLoad = resolve; });
		await command("Page.navigate", { url: `file://${path.join(directory, "index.html")}` }, session);
		await Promise.race([loaded, exited.then(code => { throw new Error(`Chromium arrêté avant chargement : ${code}; ${stderr}`); })]);
		const dom = await command("DOM.getDocument", {}, session);
		const inputNode = await command("DOM.querySelector", { nodeId: (dom.root as { nodeId: number }).nodeId, selector: "#neural-files" }, session);
		await command("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [...Object.entries(resourceFiles).flatMap(([engine, files]) => [`${engine}-resources.json`, ...files.map(file => resourceAssetName(engine as ResourcePack, file))]).map(file => path.join(resources, file)), ...privateFixtures] }, session);
		const evaluation = await command("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `new Promise(resolve => {
		  const observer = new MutationObserver(check);
		  function check() { const result = document.querySelector("#result"); if (result && result.textContent !== "PENDING") { observer.disconnect(); resolve(result.textContent); } }
		  observer.observe(document, { subtree: true, childList: true, characterData: true }); check();
		})` }, session);
		const result = (evaluation.result as { value?: string } | undefined)?.value;
		assert.equal(result, "PASS: clics Tic IA ; navigation des analyses ; synonymes et dictionnaires locaux ; réglages repliables ; release Grammalecte ; finition-corrector", JSON.stringify(evaluation));
		const metrics = await command("Runtime.evaluate", { returnByValue: true, expression: 'document.querySelector("#neural-metrics").textContent' }, session);
		process.stdout.write(String((metrics.result as { value: unknown }).value) + "\n");
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
