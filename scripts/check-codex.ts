import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import modelPresets from "../plugin/ai/models.json";

export async function checkCodex(): Promise<void> {
	const compiled = await build({ stdin: { contents: 'export * from "./plugin/ai/codex"; export * from "./plugin/ai/provider"; export { cancelSynonyms, runSynonyms } from "./plugin/ai/synonyms"; export { DEFAULT_SETTINGS } from "./plugin/types";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", supported: { "dynamic-import": false }, loader: { ".md": "text" }, write: false, external: ["obsidian"] });
	const platform = { isDesktop: true };
	let available = true, scenario = "success", launches = 0;
	const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
	const timers = new Map<number, { callback: () => void; delay: number }>();
	let timerId = 0;
	const children: Array<{ closed: boolean; reply: (message: unknown) => void }> = [];
	class Child extends EventEmitter {
		pid = 12345; exitCode: number | null = null; signalCode: string | null = null;
		stdout = new PassThrough(); stderr = new PassThrough();
		closed = false;
		reply = (message: unknown) => {
			const line = `${JSON.stringify(message)}\n`;
			for (let offset = 0; offset < line.length; offset += 7) this.stdout.write(line.slice(offset, offset + 7));
		};
		stdin = new Writable({ write: (data: Buffer, _encoding, done) => {
			const message = JSON.parse(data.toString()) as { id?: number; method: string; params: Record<string, unknown> };
			requests.push(message);
			queueMicrotask(() => {
				if (this.closed || message.id === undefined) return;
				const result: Record<string, unknown> = message.method === "account/read" ? { requiresOpenaiAuth: true, account: scenario === "login" ? null : { type: "chatgpt" } }
					: message.method === "model/list" ? { data: scenario === "invalid-models" ? [{ model: 42, displayName: "Invalide" }] : message.params.cursor ? [{ model: "codex-b", displayName: "Modèle B" }] : [{ model: "codex-a", displayName: "Modèle A" }, { model: "cache", displayName: "Masqué", hidden: true }], nextCursor: scenario === "loop-models" || !message.params.cursor ? "page-2" : null }
					: message.method === "config/read" ? { config: { mcp_servers: { unsafe: { enabled: true } } } }
					: message.method === "thread/start" ? { model: message.params.model ?? "codex-modele-test", thread: { id: "test-thread", ephemeral: true }, sandbox: { type: scenario === "permissions" ? "workspaceWrite" : "readOnly" }, approvalPolicy: "never" }
					: message.method === "turn/start" ? { turn: { id: "test-turn" } } : {};
				if (scenario === "rpc-error" && message.method === "account/read") { this.reply({ id: message.id, error: { message: "Version incompatible" } }); return; }
				this.reply({ id: message.id, result });
				if (message.method !== "turn/start") return;
				if (scenario === "wait") return;
				if (scenario === "exit") { this.kill("SIGTERM"); return; }
				if (scenario === "invalid") { this.stdout.write("{invalide}\n"); return; }
				if (scenario === "large") { this.stdout.write("x".repeat(4 * 1024 * 1024 + 1)); return; }
				if (scenario === "approval") { this.reply({ id: "approval", method: "item/commandExecution/requestApproval", params: { threadId: "test-thread" } }); return; }
				if (scenario === "tool") { this.reply({ method: "item/completed", params: { threadId: "test-thread", item: { type: "commandExecution" } } }); return; }
				this.reply({ method: "item/completed", params: { threadId: "other-thread", item: { type: "agentMessage", text: "À ignorer." } } });
				this.reply({ method: "item/completed", params: { threadId: "test-thread", item: { type: "agentMessage", phase: "commentary", text: "Je réfléchis." } } });
				this.reply({ method: "item/completed", params: { threadId: "test-thread", item: { type: "agentMessage", phase: "final_answer", text: scenario === "empty" ? "" : "Une faute, un œil.\n- vif\n- véloce" } } });
				this.reply({ method: "turn/completed", params: { threadId: "test-thread", turn: { id: "test-turn", status: scenario === "failed" ? "failed" : scenario === "interrupted" ? "interrupted" : "completed", error: { message: "Quota atteint" } } } });
			});
			done();
		} });
		kill(signal: string) { if (!this.closed) { this.closed = true; this.signalCode = signal; this.emit("close", null); } return true; }
	}
	const notices: string[] = [];
	let modalAttempts = 0;
	let replyHttp: () => Promise<{ status: number; text: string; json: unknown }> = async () => ({ status: 503, text: "Indisponible", json: { error: { message: "Indisponible" } } });
	const progressNotices: Array<{ message: string; spinning: boolean; hidden: boolean }> = [];
	const stopButtons: Array<() => void> = [];
	class Notice {
		message = ""; spinning = false; hidden = false;
		constructor(message: string | { textContent: string }, duration?: number) { this.setMessage(message); if (duration === 0) progressNotices.push(this); }
		setMessage(message: string | { textContent: string }) { this.spinning = typeof message !== "string"; this.message = typeof message === "string" ? message : message.textContent; notices.push(this.message); }
		hide() { this.hidden = true; }
	}
	const modules: Record<string, unknown> = {
		obsidian: { Platform: platform, Modal: class { constructor() { modalAttempts++; } }, MarkdownView: class {}, Notice, setIcon() {}, requestUrl: () => replyHttp() },
		"fs/promises": { readdir: async () => [], access: async () => { if (!available) throw new Error("Absent"); }, stat: async () => ({ isFile: () => true }) },
		fs: { constants: { X_OK: 1 } },
		os: { homedir: () => "/home/test", tmpdir: () => "/tmp" },
		path: { delimiter: ":", join: (...parts: string[]) => parts.join("/") },
		process: { env: { PATH: "/usr/bin" }, platform: "darwin", kill: (pid: number, signal: string) => { assert.equal(pid, -12345); (children.at(-1) as Child).kill(signal); } },
		child_process: { spawn: (executable: string, args: string[], options: Record<string, unknown>) => {
			launches++;
			assert.equal(executable, "/usr/bin/codex");
			assert.equal(options.cwd, "/tmp", "Le modèle ne doit pas travailler dans le coffre");
			assert.equal(options.windowsHide, true);
			assert.equal(options.shell, undefined, "Aucune commande ne doit passer par un shell");
			assert.ok(!args.includes("danger-full-access"));
			for (const feature of ["apps", "plugins", "hooks", "shell_tool", "unified_exec", "multi_agent", "multi_agent_v2"]) assert.equal(args[args.indexOf(feature) - 1], "--disable");
			const child = new Child(); children.push(child); return child;
		} },
	};
	const module = { exports: {} };
	runInNewContext(compiled.outputFiles[0].text, { module, URL, require: (name: string) => { assert.ok(name in modules, `Module inattendu : ${name}`); return modules[name]; }, window: {
		setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; }, clearTimeout: (id: number) => timers.delete(id),
	}, createFragment: () => ({ textContent: "", append(...nodes: Array<string | { textContent: string }>) { this.textContent += nodes.map(node => typeof node === "string" ? node : node.textContent).join(""); } }), createSpan: () => ({ textContent: "" }), createEl: () => ({ textContent: "", addEventListener(_event: string, callback: (event: MouseEvent) => void) { stopButtons.push(() => callback({ preventDefault() {}, stopPropagation() {} } as MouseEvent)); } }) });
	const api = module.exports as typeof import("../plugin/ai/codex") & typeof import("../plugin/ai/provider") & typeof import("../plugin/ai/synonyms") & Pick<typeof import("../plugin/types"), "DEFAULT_SETTINGS">;
	const options = { system: "Corrige seulement le texte.", userText: "Une fote, un œil." };
	const connection = api.getAIConnection({ ...api.DEFAULT_SETTINGS, aiModel: api.CODEX_MODEL, localAIServer: "http://localhost:11434", aiApiKey: "secret-anthropic", openaiApiKey: "secret-openai" });
	assert.equal(connection.provider, "codex", "Le choix explicite de Codex doit prendre le pas sur le serveur local");
	assert.equal(connection.apiKey, "");
	assert.equal(api.detectProvider(api.CODEX_MODEL), "codex");
	assert.equal(api.detectProvider("gpt-test"), "openai");
	assert.equal(api.detectProvider("claude-test"), "anthropic");
	for (const preset of modelPresets) assert.equal(api.aiModelName({ provider: api.detectProvider(preset.value), model: preset.value }), preset.label);
	assert.equal(await api.findCodex(), "/usr/bin/codex");
	const result = await api.callCodex(options);
	assert.equal(result.error, null);
	assert.equal(result.text, "Une faute, un œil.\n- vif\n- véloce", "Seule la réponse finale doit être conservée, avec Unicode et retours à la ligne");
	const thread = requests.find(request => request.method === "thread/start")!.params;
	assert.equal(thread.baseInstructions, options.system);
	assert.equal(thread.model, undefined, "Le modèle configuré dans Codex doit être conservé");
	assert.equal(thread.ephemeral, true);
	assert.equal(thread.sandbox, "read-only");
	assert.equal(thread.approvalPolicy, "never");
	assert.deepEqual(JSON.parse(JSON.stringify(thread.config)), { project_doc_max_bytes: 0, web_search: "disabled", mcp_servers: { unsafe: { enabled: false } } });
	assert.deepEqual(JSON.parse(JSON.stringify(requests.find(request => request.method === "turn/start")!.params)), { threadId: "test-thread", input: [{ type: "text", text: options.userText, text_elements: [] }], sandboxPolicy: { type: "readOnly", networkAccess: false } });
	assert.ok(!JSON.stringify(requests).includes("secret-"), "Les clés API de Finition ne doivent pas être envoyées à Codex");
	assert.ok(children.every(child => child.closed), "Le processus Codex doit être arrêté après la réponse");
	requests.length = 0;
	assert.deepEqual(JSON.parse(JSON.stringify(await api.listCodexModels())), [{ value: "codex-a", label: "Modèle A" }, { value: "codex-b", label: "Modèle B" }], "Le catalogue doit inclure toutes les pages et exclure les modèles masqués");
	assert.equal(requests.filter(request => request.method === "model/list").length, 2);
	assert.ok(!requests.some(request => request.method === "thread/start" || request.method === "turn/start"), "Charger les modèles ne doit pas envoyer de prompt ni lancer une génération");
	assert.ok(children.at(-1)!.closed, "La lecture du catalogue doit arrêter son processus");
	for (const [value, message] of [["login", /codex login/], ["invalid-models", /Modèle Codex invalide/], ["loop-models", /Pagination/]] as const) {
		scenario = value;
		await assert.rejects(api.listCodexModels(), message);
		assert.ok(children.at(-1)!.closed);
	}
	scenario = "success";
	const selectedConnection = api.getAIConnection({ ...api.DEFAULT_SETTINGS, aiModel: api.CODEX_MODEL, codexModel: " codex-b " });
	assert.equal(selectedConnection.model, "codex-b");
	await api.reviseChunkWithCodex("Une fote.", "Corrige.", selectedConnection);
	assert.equal(requests.filter(request => request.method === "thread/start").at(-1)!.params.model, "codex-b", "Les corrections doivent transmettre le choix exact de modèle à Codex");
	let correctionModel = "";
	assert.equal((await api.reviseChunkWithCodex("x".repeat(1000), "Corrige.", { onModel: model => { correctionModel = model; } })).text, "x".repeat(1000), "Une réponse tronquée ne doit pas remplacer le texte");
	assert.equal(correctionModel, "codex-modele-test", "Le modèle Codex doit aussi être transmis à la progression des corrections");
	for (const [value, expected] of [["login", /codex login/], ["permissions", /restrictions/], ["rpc-error", /Version incompatible/], ["failed", /Quota atteint/], ["interrupted", /Quota atteint/], ["empty", /aucun texte/], ["approval", /autorisation/], ["tool", /outil/], ["invalid", /invalide/], ["large", /volumineuse/], ["exit", /arrêtée/]] as const) {
		scenario = value; requests.length = 0;
		const failure = await api.callCodex(options);
		assert.equal(failure.text, null, value);
		assert.match(failure.error!, expected, value);
		assert.ok(children.at(-1)!.closed, value);
		if (["login", "permissions", "rpc-error"].includes(value)) assert.ok(!requests.some(request => request.method === "turn/start"), "Le texte ne doit pas être envoyé après un échec de connexion");
	}
	for (const timeout of [false, true]) {
		scenario = "wait"; requests.length = 0;
		const waiting = api.callCodex(options);
		for (let round = 0; round < 100 && !requests.some(request => request.method === "turn/start"); round++) await new Promise(resolve => setImmediate(resolve));
		assert.ok(requests.some(request => request.method === "turn/start"));
		if (timeout) { const timer = [...timers.values()].find(timer => timer.delay === 120_000); assert.ok(timer); timer.callback(); }
		else api.cancelCodex();
		assert.match((await waiting).error!, timeout ? /deux minutes/ : /annulée/);
		assert.ok(children.at(-1)!.closed);
	}
	scenario = "success";
	const beforeImmediateCancel = launches;
	const immediate = api.callCodex(options);
	api.cancelCodex();
	assert.match((await immediate).error!, /annulée/, "Une annulation pendant le chargement doit arrêter la requête");
	assert.equal(launches, beforeImmediateCancel, "Une requête annulée avant le lancement ne doit pas créer de processus");
	const source = "Avant.\n\nUn pas rapide.\n\nAprès.";
	const from = source.indexOf("rapide"), to = from + "rapide".length;
	const view = { file: { path: "note.md" }, editor: { getValue: () => source, getSelection: () => "rapide", listSelections: () => [{}], getCursor: (side: string) => ({ ch: side === "from" ? from : to }), posToOffset: (position: { ch: number }) => position.ch } };
	const app = { workspace: { getActiveViewOfType: () => view } } as unknown as import("obsidian").App;
	scenario = "failed";
	for (const [model, server, localModel, label] of [[api.CODEX_MODEL, "", "", "Codex"], ["claude-modele-test", "", "", "claude-modele-test"], ["gpt-modele-test", "", "", "gpt-modele-test"], ["claude-modele-test", "http://localhost:11434", "local-test", "local-test"]]) {
		const waiting = api.runSynonyms(app, { ...api.DEFAULT_SETTINGS, aiModel: model, codexModel: "codex-a", localAIServer: server, localAIModel: localModel, aiApiKey: "test", openaiApiKey: "test" });
		const progress = progressNotices.at(-1)!;
		assert.ok(progress.spinning && !progress.hidden, "Synonymes IA doit afficher une roue pendant la recherche");
		assert.ok(progress.message.includes(label), `Le modèle ${label} doit être affiché dès le lancement`);
		await waiting;
		assert.equal(progress.hidden, true, "La roue doit disparaître après une erreur");
		if (model === api.CODEX_MODEL) {
			assert.ok(progress.message.includes("codex-a"), "Le modèle choisi doit être affiché dans la progression");
			assert.equal(requests.filter(request => request.method === "thread/start").at(-1)!.params.model, "codex-a", "Les synonymes doivent utiliser le modèle Codex choisi");
		}
	}
	let releaseHttp!: () => void;
	replyHttp = () => new Promise(resolve => { releaseHttp = () => resolve({ status: 200, text: "", json: { choices: [{ message: { content: "- vif" } }] } }); });
	let outdatedStop: (() => void) | undefined;
	for (const cancel of [() => api.cancelSynonyms(), () => stopButtons.at(-1)!()]) {
		const delayed = api.runSynonyms(app, { ...api.DEFAULT_SETTINGS, aiModel: "gpt-test", openaiApiKey: "test" });
		const delayedProgress = progressNotices.at(-1)!;
		assert.equal(delayedProgress.hidden, false);
		outdatedStop?.();
		assert.equal(delayedProgress.hidden, false, "Une ancienne croix arrête la nouvelle recherche");
		outdatedStop = stopButtons.at(-1)!;
		cancel();
		assert.equal(delayedProgress.hidden, true, "Reset ou la croix doit fermer immédiatement la roue des synonymes");
		const beforeReply = notices.length;
		const beforeModal = modalAttempts;
		releaseHttp(); await delayed;
		assert.equal(notices.length, beforeReply, "Un résultat de synonymes arrivé après arrêt doit être ignoré");
		assert.equal(modalAttempts, beforeModal, "Un résultat arrivé après arrêt ne doit pas ouvrir de fenêtre");
	}
	scenario = "wait";
	requests.length = 0;
	const stoppedCodex = api.runSynonyms(app, { ...api.DEFAULT_SETTINGS, aiModel: api.CODEX_MODEL });
	for (let round = 0; round < 100 && !requests.some(request => request.method === "turn/start"); round++) await new Promise(resolve => setImmediate(resolve));
	assert.ok(requests.some(request => request.method === "turn/start"));
	stopButtons.at(-1)!();
	await stoppedCodex;
	assert.ok(children.at(-1)!.closed, "La croix des synonymes doit arrêter le processus Codex");
	available = false;
	const before = launches;
	assert.equal(await api.findCodex(), null);
	assert.match((await api.callCodex(options)).error!, /introuvable/);
	platform.isDesktop = false;
	assert.equal(await api.findCodex(), null);
	assert.match((await api.callCodex(options)).error!, /ordinateur/);
	await api.runSynonyms({ workspace: { getActiveViewOfType: () => view } } as unknown as import("obsidian").App, { ...api.DEFAULT_SETTINGS, aiModel: api.CODEX_MODEL, aiApiKey: "", openaiApiKey: "" });
	assert.match(notices.at(-1)!, /Codex.*ordinateur/, "Synonymes IA doit appeler Codex sans exiger de clé API ni basculer vers une API");
	assert.equal(launches, before, "Aucun processus ne doit démarrer sur mobile ou sans Codex");
	assert.equal(timers.size, 0, "Les temporisations ne doivent pas survivre à la requête");
	process.stdout.write("Codex : protocole simulé, configuration, permissions, erreurs, Unicode, annulation et mobile vérifiés\n");
}

if (process.argv[1]?.endsWith("check-codex.ts")) void checkCodex();
