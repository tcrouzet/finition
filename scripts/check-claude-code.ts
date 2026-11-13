import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { posix as path } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

export async function checkClaudeCode(): Promise<void> {
	const compiled = await build({ stdin: { contents: 'export * from "./plugin/ai/claude-code"; export * from "./plugin/ai/provider"; export { DEFAULT_SETTINGS } from "./plugin/types";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", supported: { "dynamic-import": false }, loader: { ".md": "text" }, write: false, external: ["obsidian"] });
	const platform = { isDesktop: true };
	let available = true, launcher = false, scenario = "success";
	const launches: Array<{ args: string[]; child: Child }> = [];
	const prompts: string[] = [];
	class Child extends EventEmitter {
		pid = 12345; exitCode: number | null = null; signalCode: string | null = null;
		stdout = new PassThrough(); stderr = new PassThrough();
		reply(message: unknown) {
			const line = `${JSON.stringify(message)}\n`;
			for (let offset = 0; offset < line.length; offset += 5) this.stdout.write(line.slice(offset, offset + 5));
		}
		stdin = new Writable({ write: (data: Buffer, _encoding, done) => {
			const message = JSON.parse(data.toString()) as { type: string; message: { role: string; content: string }; parent_tool_use_id: null };
			assert.equal(message.type, "user"); assert.equal(message.message.role, "user"); assert.equal(message.parent_tool_use_id, null);
			prompts.push(message.message.content);
			queueMicrotask(() => {
				if (scenario === "wait") return;
				if (scenario === "exit") { this.close(1); return; }
				if (scenario === "invalid") { this.stdout.write("{invalide}\n"); return; }
				if (scenario === "control") { this.reply({ type: "control_request" }); return; }
				if (scenario === "tool") { this.reply({ type: "assistant", message: { content: [{ type: "tool_use" }] } }); return; }
				this.reply({ type: "assistant", message: { content: [{ type: "text", text: "Brouillon à ignorer" }] } });
				this.reply({ type: "result", subtype: scenario === "failure" ? "error_during_execution" : "success", is_error: scenario === "failure", result: scenario === "empty" ? "\u200b" : scenario === "short" ? "x" : message.message.content.replace("fote", "faute") });
			});
			done();
		} });
		close(code: number) { this.exitCode = code; this.emit("close", code); }
		kill(signal: string) { this.signalCode = signal; this.emit("close", null); return true; }
	}
	const timers = new Map<number, () => void>();
	let timerId = 0;
	const modules: Record<string, unknown> = {
		obsidian: { Platform: platform },
		"fs/promises": {
			access: async () => { if (!available) throw new Error("Absent"); }, stat: async () => ({ isFile: () => true }),
			realpath: async (file: string) => launcher ? "/npm/cli.js" : file,
		},
		fs: { constants: { X_OK: 1 } }, os: { homedir: () => "/home/test", tmpdir: () => "/tmp" }, path,
		process: { env: { PATH: "/usr/bin" }, platform: "darwin", kill: (pid: number, signal: string) => { assert.equal(pid, -12345); launches.at(-1)!.child.kill(signal); } },
		child_process: { spawn: (executable: string, args: string[], options: Record<string, unknown>) => {
			assert.ok(path.isAbsolute(executable)); assert.equal(options.cwd, "/tmp"); assert.equal(options.shell, undefined);
			assert.equal((options.env as Record<string, string>).DISABLE_AUTOUPDATER, "1");
			const child = new Child(); launches.push({ args, child });
			queueMicrotask(() => {
				if (args[0] === "--version") { child.stdout.write("2.1.300 (Claude Code)\n"); child.close(0); return; }
				if (args[0] === "auth") { assert.deepEqual(Array.from(args), ["auth", "status"]); child.stdout.write(JSON.stringify({ loggedIn: scenario !== "login" })); child.close(scenario === "login" ? 1 : 0); return; }
				for (const flag of ["--print", "--verbose", "--safe-mode", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) assert.ok(args.includes(flag), flag);
				for (const [flag, value] of [["--tools", ""], ["--disallowedTools", "*"], ["--permission-mode", "dontAsk"], ["--input-format", "stream-json"], ["--output-format", "stream-json"]]) assert.equal(args[args.indexOf(flag) + 1], value);
				assert.deepEqual(JSON.parse(args[args.indexOf("--mcp-config") + 1]), { mcpServers: {} });
				assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), { disableAllHooks: true });
				child.reply({ type: "system", subtype: "init", model: "claude-modele-test", tools: scenario === "unsafe" ? ["Bash"] : [], mcp_servers: [] });
			});
			return child;
		} },
	};
	const module = { exports: {} };
	runInNewContext(compiled.outputFiles[0].text, { module, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; }, window: { setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 1500, "Seul l’arrêt forcé après fermeture doit avoir un délai"); timers.set(++timerId, callback); return timerId; }, clearTimeout: (id: number) => timers.delete(id) } });
	const api = module.exports as typeof import("../plugin/ai/claude-code") & typeof import("../plugin/ai/provider") & Pick<typeof import("../plugin/types"), "DEFAULT_SETTINGS">;
	const connection = api.getAIConnection({ ...api.DEFAULT_SETTINGS, aiModel: api.CLAUDE_CODE_MODEL, claudeCodePath: " /usr/bin/claude ", claudeCodeModel: " sonnet ", localAIServer: "http://localhost:11434" }, { getSecret: () => { throw new Error("Le fournisseur local ne doit pas lire les clés API"); } });
	assert.equal(connection.provider, "claude-code"); assert.equal(connection.model, "sonnet"); assert.equal(connection.executable, "/usr/bin/claude"); assert.equal(connection.apiKey, "");
	assert.equal(api.detectProvider(api.CLAUDE_CODE_MODEL), "claude-code"); assert.equal(api.detectProvider("claude-test"), "anthropic");
	assert.equal(api.aiModelName(connection), "Claude Code · sonnet");
	assert.equal(await api.findClaudeCode(), "/usr/bin/claude"); assert.equal(await api.findClaudeCode("~/bin/claude"), "/home/test/bin/claude");
	await assert.rejects(api.findClaudeCode("claude"), /absolu/);
	launcher = true; await assert.rejects(api.findClaudeCode(), /installation native/); launcher = false;
	assert.equal(await api.testClaudeCode(), "2.1.300"); assert.equal(prompts.length, 0, "Tester ne doit pas lancer de génération");
	scenario = "login"; await assert.rejects(api.testClaudeCode(), /claude auth login/); scenario = "success";
	let model = "";
	const reply = await api.callClaudeCode({ ...connection, system: "Corrige.", userText: "Une fote, un œil.", onModel: value => { model = value; } });
	assert.equal(reply.text, "Une faute, un œil."); assert.equal(reply.error, null); assert.equal(model, "claude-modele-test");
	assert.equal(launches.at(-1)!.args[launches.at(-1)!.args.indexOf("--model") + 1], "sonnet");
	const beforeSession = launches.length;
	await api.withClaudeCodeSession({ system: "Corrige." }, async revise => {
		for (const text of ["Première fote.", "Deuxième fote."]) assert.equal((await revise(text)).text, text.replace("fote", "faute"));
	});
	assert.equal(launches.length, beforeSession + 1, "Les tronçons doivent partager le même processus");
	scenario = "short";
	await api.withClaudeCodeSession({ system: "Corrige." }, async revise => { const result = await revise("Texte à conserver."); assert.equal(result.text, "Texte à conserver."); assert.match(result.error!, /trop courte/); });
	for (const failure of ["invalid", "control", "tool", "unsafe", "empty", "failure", "exit"]) {
		scenario = failure;
		assert.ok((await api.callClaudeCode({ system: "Corrige.", userText: "Une fote." })).error, failure);
	}
	scenario = "wait";
	const controller = new AbortController();
	const waiting = api.callClaudeCode({ system: "Corrige.", userText: "Une fote.", signal: controller.signal, onModel: () => controller.abort() });
	assert.match((await waiting).error!, /annulée/);
	scenario = "success";
	await assert.rejects(api.withClaudeCodeSession({ system: "Corrige." }, async revise => {
		await revise("Une fote.");
		api.cancelClaudeCode();
		assert.match((await revise("Autre fote.")).error!, /annulée/);
	}), /annulée/);
	const stopped = new AbortController(); stopped.abort();
	const beforeAbort = launches.length;
	assert.match((await api.callClaudeCode({ system: "Corrige.", userText: "Une fote.", signal: stopped.signal })).error!, /annulée/);
	assert.equal(launches.length, beforeAbort);
	available = false; assert.equal(await api.findClaudeCode(), null);
	assert.ok((await api.callClaudeCode({ system: "Corrige.", userText: "Une fote." })).error);
	platform.isDesktop = false;
	assert.equal(await api.findClaudeCode(), null);
	assert.match((await api.callClaudeCode({ system: "Corrige.", userText: "Une fote." })).error!, /ordinateur/);
	assert.equal(timers.size, 0);
	assert.ok(launches.every(({ child }) => child.exitCode !== null || child.signalCode !== null), "Un processus reste ouvert");
}
