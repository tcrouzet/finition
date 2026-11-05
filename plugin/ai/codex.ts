/// <reference types="node" />

import { Platform } from "obsidian";
import { hasResponseText } from "./clean";

export const CODEX_MODEL = "__codex__";
export interface CodexModel { value: string; label: string; efforts?: string[] }
interface CodexSessionOptions { system: string; model?: string; effort?: string; onModel?: (model: string) => void }
interface CodexCallOptions extends CodexSessionOptions { userText: string }
type CodexReply = { text: string | null; error: string | null };
export type CodexRevision = (chunk: string) => Promise<{ text: string; error: string | null }>;
type CodexTask = { kind: "models" } | ({ kind: "text" } & CodexCallOptions) | ({ kind: "session"; work: (revise: CodexRevision) => Promise<void> } & CodexSessionOptions);
interface CodexResult { text: string | null; error: string | null; models?: CodexModel[] }
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const cancellations = new Set<() => void>();

export async function findCodex(): Promise<string | null> {
	if (!Platform.isDesktop) return null;
	const fs = await import("fs/promises");
	const { constants } = await import("fs");
	const { homedir } = await import("os");
	const path = await import("path");
	const { env, platform } = await import("process");
	const home = homedir(), name = platform === "win32" ? "codex.exe" : "codex";
	const candidates = [
		...(env.PATH ?? "").split(path.delimiter).filter(Boolean).map(directory => path.join(directory, name)),
		...[[".local", "bin"], [".volta", "bin"], [".npm-global", "bin"]].map(parts => path.join(home, ...parts, name)),
		"/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/Applications/Codex.app/Contents/Resources/codex",
	];
	for (const directory of [[".codex", "packages", "standalone", "releases"], [".nvm", "versions", "node"]]) {
		const root = path.join(home, ...directory);
		const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
		for (const entry of entries.filter(entry => entry.isDirectory()).sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))) candidates.push(path.join(root, entry.name, "bin", name));
	}
	for (const candidate of new Set(candidates)) {
		try { await fs.access(candidate, constants.X_OK); if ((await fs.stat(candidate)).isFile()) return candidate; }
		catch { /* Essayer le prochain emplacement standard. */ }
	}
	return null;
}

export function cancelCodex(): void { for (const cancel of cancellations) cancel(); }

export async function listCodexModels(): Promise<CodexModel[]> {
	const result = await runCodex({ kind: "models" });
	if (result.error || !result.models) throw new Error(result.error ?? "Liste des modèles Codex absente.");
	return result.models;
}

export function callCodex(opts: CodexCallOptions): Promise<CodexResult> { return runCodex({ ...opts, kind: "text" }); }

export async function withCodexSession(opts: CodexSessionOptions, work: (revise: CodexRevision) => Promise<void>): Promise<void> {
	const result = await runCodex({ ...opts, kind: "session", work });
	if (result.error) throw new Error(result.error);
}

async function runCodex(opts: CodexTask): Promise<CodexResult> {
	if (!Platform.isDesktop) return { text: null, error: "Codex est disponible uniquement sur ordinateur." };
	let hostProcess: typeof import("process") | undefined;
	let child: import("child_process").ChildProcessWithoutNullStreams | undefined;
	let buffer = "", threadId = "", answer = "";
	let turnId = "";
	const finishedTurns = new Set<string>();
	let nextId = 0, stopped = false;
	const pending = new Map<number, { resolve: (value: ObjectValue) => void; reject: (error: Error) => void }>();
	let complete: ((value: CodexReply) => void) | undefined;
	let failure: string | null = null;
	const fail = (message: string) => {
		stopped = true;
		failure = message;
		complete?.({ text: null, error: message });
		for (const request of pending.values()) request.reject(new Error(message));
		pending.clear();
	};
	const cancel = () => fail("Requête Codex annulée.");
	cancellations.add(cancel);
	const write = (value: ObjectValue) => {
		if (stopped || !child || child.stdin.destroyed) throw new Error("Connexion Codex fermée.");
		child.stdin.write(`${JSON.stringify(value)}\n`);
	};
	const request = (method: string, params: ObjectValue): Promise<ObjectValue> => new Promise((resolve, reject) => {
		const id = ++nextId;
		pending.set(id, { resolve, reject });
		try { write({ id, method, params }); }
		catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
	});
	try {
		const { spawn } = await import("child_process");
		const { tmpdir } = await import("os");
		const process = hostProcess = await import("process");
		if (stopped) return { text: null, error: failure };
		const executable = await findCodex();
		if (stopped) return { text: null, error: failure };
		if (!executable) throw new Error("Codex introuvable. Installe Codex CLI et connecte-le avant de réessayer.");
		// Les outils et intégrations ne sont pas nécessaires à une réponse éditoriale.
		const disabled = ["apps", "plugins", "hooks", "multi_agent", "multi_agent_v2", "shell_tool", "unified_exec", "code_mode", "code_mode_host", "computer_use", "browser_use", "image_generation", "view_image"];
		child = spawn(executable, ["app-server", "--listen", "stdio://", "-c", "notify=[]", "-c", "project_doc_max_bytes=0", ...disabled.flatMap(feature => ["--disable", feature])], {
			cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
		});
		child.once("error", error => fail(`Impossible de lancer Codex : ${error.message}`));
		child.once("close", () => { if (!stopped) fail("La connexion Codex s’est arrêtée avant la fin de la réponse."); });
		child.stdin.on("error", error => fail(`Connexion Codex : ${error.message}`));
		child.stderr.resume();
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			buffer += chunk;
			if (buffer.length > 4 * 1024 * 1024) { fail("Réponse Codex trop volumineuse."); return; }
			let end: number;
			while ((end = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
				if (!line.trim()) continue;
				try {
					const message = object(JSON.parse(line)), params = object(message.params);
					if (typeof message.method === "string") {
						if (stopped) continue;
						if (message.id !== undefined) { fail("Codex a demandé un outil ou une autorisation au lieu de répondre. Requête arrêtée."); return; }
						if (params.threadId !== threadId || !threadId || !complete) continue;
						const eventTurn = message.method.startsWith("turn/") ? object(params.turn).id : params.turnId;
						if (typeof eventTurn === "string") {
							if (finishedTurns.has(eventTurn) || turnId && eventTurn !== turnId) continue;
							turnId = eventTurn;
						}
						if (message.method === "item/started" || message.method === "item/completed") {
							const item = object(params.item);
							if (item.type === "agentMessage" && message.method === "item/completed" && item.phase !== "commentary" && typeof item.text === "string") answer = item.text;
							else if (item.type !== "agentMessage" && item.type !== "userMessage" && item.type !== "reasoning" && item.type !== "contextCompaction") { fail("Codex a tenté d’utiliser un outil. Requête arrêtée."); return; }
						} else if (message.method === "turn/completed") {
							const turn = object(params.turn);
							if (turn.status !== "completed") fail(typeof object(turn.error).message === "string" ? String(object(turn.error).message) : "Réponse Codex interrompue ou en échec.");
							else if (!hasResponseText(answer)) fail("Codex n’a renvoyé aucun texte.");
							else { if (turnId) finishedTurns.add(turnId); complete({ text: answer, error: null }); complete = undefined; }
						}
					} else if (typeof message.id === "number") {
						const response = pending.get(message.id);
						if (!response) continue;
						pending.delete(message.id);
						if (message.error) {
							const detail = object(message.error).message;
							response.reject(new Error(typeof detail === "string" ? detail : "Erreur Codex."));
						} else response.resolve(object(message.result));
					}
				} catch { fail("Réponse Codex invalide."); }
			}
		});
		await request("initialize", { clientInfo: { name: "finition", title: "Finition", version: "1.0.0" } });
		write({ method: "initialized" });
		const account = await request("account/read", { refreshToken: false });
		if (account.requiresOpenaiAuth === true && !account.account) throw new Error("Codex n’est pas connecté. Lance « codex login » dans le terminal, puis réessaie.");
		if (opts.kind === "models") {
			const models = new Map<string, CodexModel>(), cursors = new Set<string>();
			let cursor: string | null = null;
			do {
				if (cursor && cursors.has(cursor)) throw new Error("Pagination des modèles Codex invalide.");
				if (cursor) cursors.add(cursor);
				const page = await request("model/list", { limit: 100, includeHidden: false, cursor });
				if (!Array.isArray(page.data) || (page.nextCursor != null && typeof page.nextCursor !== "string")) throw new Error("Liste des modèles Codex invalide.");
				for (const entry of page.data) {
					const model = object(entry);
					if (model.hidden === true) continue;
					if (typeof model.model !== "string" || !model.model.trim() || model.model.length > 200 || typeof model.displayName !== "string" || !model.displayName.trim() || model.displayName.length > 200) throw new Error("Modèle Codex invalide.");
					const efforts = model.supportedReasoningEfforts;
					if (efforts !== undefined && !Array.isArray(efforts)) throw new Error("Efforts de raisonnement Codex invalides.");
					const values = Array.isArray(efforts) ? efforts.map((entry: unknown) => {
						const value = object(entry).reasoningEffort;
						if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/u.test(value)) throw new Error("Effort de raisonnement Codex invalide.");
						return value;
					}) : undefined;
					models.set(model.model, { value: model.model, label: model.displayName, ...(values?.length ? { efforts: [...new Set(values)] } : {}) });
				}
				cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
			} while (cursor);
			return { text: null, error: null, models: [...models.values()] };
		}
		const { config } = await request("config/read", { cwd: tmpdir(), includeLayers: false });
		if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Configuration Codex incompatible. Mets Codex à jour.");
		const thread = await request("thread/start", {
			...(opts.model?.trim() ? { model: opts.model.trim() } : {}),
			cwd: tmpdir(), ephemeral: true, approvalPolicy: "never", sandbox: "read-only", baseInstructions: opts.system,
			developerInstructions: "Réponds uniquement avec le texte demandé, sans outils ni accès aux fichiers." + (opts.kind === "session" ? " Chaque message contient un nouveau tronçon : réponds uniquement avec ce tronçon, sans répéter les précédents." : ""),
			config: { project_doc_max_bytes: 0, web_search: "disabled", ...(opts.effort ? { model_reasoning_effort: opts.effort } : {}), mcp_servers: Object.fromEntries(Object.keys(object(object(config).mcp_servers)).map(name => [name, { enabled: false }])) },
		});
		threadId = typeof object(thread.thread).id === "string" ? String(object(thread.thread).id) : "";
		if (!threadId || object(thread.sandbox).type !== "readOnly" || thread.approvalPolicy !== "never" || object(thread.thread).ephemeral !== true) throw new Error("Codex n’a pas appliqué les restrictions demandées. Requête arrêtée.");
		if (typeof thread.model === "string" && thread.model.trim()) opts.onModel?.(thread.model);
		const runTurn = async (userText: string): Promise<CodexReply> => {
			if (stopped) return { text: null, error: failure };
			if (complete) throw new Error("Une requête Codex est déjà en cours.");
			answer = "";
			turnId = "";
			const completed = new Promise<CodexReply>(resolve => { complete = resolve; });
			try {
				await request("turn/start", { threadId, input: [{ type: "text", text: userText, text_elements: [] }], ...(opts.effort ? { effort: opts.effort } : {}), sandboxPolicy: { type: "readOnly", networkAccess: false } });
				return await completed;
			} finally { complete = undefined; }
		};
		if (opts.kind === "text") return await runTurn(opts.userText);
		await opts.work(async chunk => codexRevision(chunk, await runTurn(chunk)));
		return { text: null, error: failure };
	} catch (error) {
		return { text: null, error: `Codex : ${error instanceof Error ? error.message : String(error)}` };
	} finally {
		stopped = true;
		cancellations.delete(cancel);
		if (child && hostProcess && child.exitCode === null && child.signalCode === null) {
			const process = hostProcess;
			child.stdin.destroy();
			const running = child;
			const kill = (signal: "SIGTERM" | "SIGKILL") => {
				try { if (process.platform !== "win32" && running.pid) process.kill(-running.pid, signal); else running.kill(signal); }
				catch { /* Le processus peut déjà être arrêté. */ }
			};
			const fallback = window.setTimeout(() => kill("SIGKILL"), 1500);
			running.once("close", () => window.clearTimeout(fallback));
			kill("SIGTERM");
		}
	}
}

function codexRevision(chunk: string, result: CodexReply): { text: string; error: string | null } {
	return result.text && result.text.length >= 0.8 * chunk.length
		? { text: result.text, error: null }
		: { text: chunk, error: result.error ?? "Réponse Codex trop courte par rapport au texte d’origine." };
}

export async function reviseChunkWithCodex(chunk: string, system: string, opts?: { model?: string; effort?: string; onModel?: (model: string) => void }): Promise<{ text: string; error: string | null }> {
	return codexRevision(chunk, await callCodex({ system, userText: chunk, ...opts }));
}
