import { Platform } from "obsidian";
import { hasResponseText } from "./clean";

export const CLAUDE_CODE_MODEL = "__claude_code__";
interface LaunchOptions { executable?: string; signal?: AbortSignal }
interface SessionOptions extends LaunchOptions { system: string; model?: string; onModel?: (model: string) => void }
type Reply = { text: string | null; error: string | null };
type Revision = (text: string) => Promise<{ text: string; error: string | null }>;
type Task = ({ kind: "version" } & LaunchOptions) | ({ kind: "auth" } & LaunchOptions) | ({ kind: "text"; userText: string } & SessionOptions) | ({ kind: "session"; work: (revise: Revision) => Promise<void> } & SessionOptions);
const cancellations = new Set<() => void>();

export function cancelClaudeCode(): void { for (const cancel of cancellations) cancel(); }

export async function findClaudeCode(configured = ""): Promise<string | null> {
	if (!Platform.isDesktop) return null;
	const fs = await import("fs/promises"), path = await import("path");
	const { constants } = await import("fs");
	const { homedir } = await import("os");
	const { env, platform } = await import("process");
	const home = homedir(), names = platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
	const custom = configured.trim().replace(/^~\//u, `${home}/`);
	if (custom && !path.isAbsolute(custom)) throw new Error("Claude Code : renseigne un chemin absolu, ou laisse le champ vide pour la détection automatique.");
	const candidates = custom ? [custom] : [
		...(env.PATH ?? "").split(path.delimiter).filter(Boolean).flatMap(directory => names.map(name => path.join(directory, name))),
		...[[".local", "bin"], ...(platform === "win32" ? [["AppData", "Local", "Microsoft", "WinGet", "Links"], ["AppData", "Roaming", "npm"]] : [])].flatMap(parts => names.map(name => path.join(home, ...parts, name))),
		"/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude",
	];
	let launcher = false;
	for (const candidate of new Set(candidates)) {
		try {
			await fs.access(candidate, constants.X_OK);
			if (!(await fs.stat(candidate)).isFile()) continue;
			const resolved = await fs.realpath(candidate);
			// shortcut: les anciens lanceurs npm nécessitent Node ; utiliser l’installation native recommandée.
			if (/\.(?:[cm]?js|cmd|bat)$/iu.test(resolved)) { launcher = true; continue; }
			return resolved;
		} catch { /* Essayer le prochain emplacement standard. */ }
	}
	if (launcher) throw new Error("Claude Code : utilise l’installation native, ou renseigne le chemin de son binaire natif. Les anciens lanceurs npm ne sont pas pris en charge.");
	if (custom) throw new Error("Claude Code : aucun exécutable accessible à ce chemin.");
	return null;
}

export async function testClaudeCode(executable = "", signal?: AbortSignal): Promise<string> {
	const version = await runClaudeCode({ kind: "version", executable, signal });
	if (version.error) throw new Error(version.error);
	const number = version.text?.match(/\b\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?\b/u)?.[0];
	if (!number) throw new Error("Claude Code : version non reconnue. Mets Claude Code à jour.");
	const auth = await runClaudeCode({ kind: "auth", executable, signal });
	if (auth.error) throw new Error(auth.error);
	return number;
}

export function callClaudeCode(opts: SessionOptions & { userText: string }): Promise<Reply> { return runClaudeCode({ ...opts, kind: "text" }); }

export async function withClaudeCodeSession(opts: SessionOptions, work: (revise: Revision) => Promise<void>): Promise<void> {
	const result = await runClaudeCode({ ...opts, kind: "session", work });
	if (result.error) throw new Error(result.error);
}

async function runClaudeCode(opts: Task): Promise<Reply> {
	if (!Platform.isDesktop) return { text: null, error: "Claude Code est disponible uniquement sur ordinateur." };
	let child: import("child_process").ChildProcessWithoutNullStreams | undefined;
	let hostProcess: typeof import("process") | undefined;
	let buffer = "", stopped = false, failure: string | null = null;
	let complete: ((reply: Reply) => void) | undefined;
	let finish: (reply: Reply) => void = () => {};
	const ended = new Promise<Reply>(resolve => { finish = resolve; });
	const fail = (message: string) => {
		stopped = true;
		failure = message;
		complete?.({ text: null, error: message });
		complete = undefined;
		finish({ text: null, error: message });
	};
	const cancel = () => fail("Requête Claude Code annulée.");
	cancellations.add(cancel);
	opts.signal?.addEventListener("abort", cancel, { once: true });
	if (opts.signal?.aborted) cancel();
	const diagnostic = opts.kind === "version" || opts.kind === "auth";
	const receive = (line: string) => {
		if (stopped || !line.trim() || diagnostic) return;
		try {
			const value: unknown = JSON.parse(line);
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Message invalide.");
			const message = value as Record<string, unknown>;
			if (message.type === "control_request") throw new Error("Demande d’outil ou d’autorisation inattendue.");
			if (message.type === "system" && message.subtype === "init") {
				if (!Array.isArray(message.tools) || message.tools.length || !Array.isArray(message.mcp_servers) || message.mcp_servers.length) throw new Error("Les outils de Claude Code n’ont pas été désactivés.");
				if (typeof message.model === "string" && "onModel" in opts) opts.onModel?.(message.model);
			}
			if (message.type === "assistant") {
				const assistant = message.message as { content?: Array<{ type?: unknown }> } | undefined;
				if (assistant?.content?.some(block => block.type === "tool_use")) throw new Error("Claude Code a demandé un outil au lieu de répondre.");
			}
			if (message.type === "result" && complete) {
				if (message.subtype !== "success" || message.is_error !== false) throw new Error("La génération a échoué. Vérifie la connexion et les limites de ton compte Claude Code.");
				if (!hasResponseText(message.result)) throw new Error("Claude Code n’a renvoyé aucun texte.");
				const resolve = complete;
				complete = undefined;
				resolve({ text: message.result, error: null });
			}
		} catch (error) { fail(`Claude Code : ${error instanceof Error ? error.message : String(error)}`); }
	};
	try {
		const { spawn } = await import("child_process");
		const { tmpdir } = await import("os");
		const process = hostProcess = await import("process");
		if (stopped) return { text: null, error: failure };
		const executable = await findClaudeCode(opts.executable);
		if (stopped) return { text: null, error: failure };
		if (!executable) throw new Error("Claude Code introuvable. Installe-le et connecte-le avant de réessayer.");
		const args = opts.kind === "version" ? ["--version"] : opts.kind === "auth" ? ["auth", "status"] : [
			"--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
			"--safe-mode", "--settings", JSON.stringify({ disableAllHooks: true }),
			"--tools", "", "--disallowedTools", "*", "--permission-mode", "dontAsk",
			"--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
			"--no-session-persistence", "--no-chrome", "--disable-slash-commands",
			"--system-prompt", `${opts.system}\nChaque message contient un nouveau texte indépendant. Réponds uniquement à ce texte, sans reprendre les textes précédents et sans utiliser d’outils.`,
			...(opts.model ? ["--model", opts.model] : []),
		];
		child = spawn(executable, args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32", env: { ...process.env, DISABLE_AUTOUPDATER: "1" } });
		child.once("error", () => fail("Impossible de lancer Claude Code. Vérifie son chemin et sa version dans les réglages."));
		child.stdin.on("error", () => fail("Connexion Claude Code interrompue."));
		child.stderr.resume();
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			buffer += chunk;
			if (buffer.length > 4 * 1024 * 1024) { fail("Réponse Claude Code trop volumineuse."); return; }
			if (diagnostic) return;
			let end: number;
			while (!stopped && (end = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
				receive(line);
			}
		});
		child.once("close", code => {
			if (stopped) return;
			if (diagnostic) {
				if (code === 0) finish({ text: opts.kind === "version" ? buffer : null, error: null });
				else fail(opts.kind === "auth" ? "Claude Code : connecte-toi avec claude auth login avant de réessayer." : "Claude Code : commande incompatible ou interrompue. Mets Claude Code à jour.");
			} else {
				if (buffer.trim()) receive(buffer);
				fail("La connexion Claude Code s’est arrêtée avant la fin du traitement.");
			}
		});
		if (diagnostic) { child.stdin.end(); return await ended; }
		const runTurn = (text: string): Promise<Reply> => {
			if (stopped) return Promise.resolve({ text: null, error: failure });
			if (complete) throw new Error("Une requête Claude Code est déjà en cours.");
			return new Promise(resolve => {
				complete = resolve;
				child!.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null })}\n`);
			});
		};
		if (opts.kind === "text") return await runTurn(opts.userText);
		if (opts.kind === "session") await opts.work(async text => {
			const reply = await runTurn(text);
			return reply.text && reply.text.length >= 0.8 * text.length ? { text: reply.text, error: null } : { text, error: reply.error ?? "Réponse Claude Code trop courte par rapport au texte d’origine." };
		});
		return { text: null, error: failure };
	} catch (error) {
		return { text: null, error: `Claude Code : ${error instanceof Error ? error.message : String(error)}` };
	} finally {
		stopped = true;
		cancellations.delete(cancel);
		opts.signal?.removeEventListener("abort", cancel);
		if (child && hostProcess && child.exitCode === null && child.signalCode === null) {
			const process = hostProcess, running = child;
			running.stdin.destroy();
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
