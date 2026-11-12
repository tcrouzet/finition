import { Platform } from "obsidian";

export async function findCodex(configured = ""): Promise<string | null> {
	if (!Platform.isDesktop) return null;
	const fs = await import("fs/promises");
	const { constants } = await import("fs");
	const { homedir } = await import("os");
	const path = await import("path");
	const { env, platform } = await import("process");
	const home = homedir(), names = platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
	const custom = configured.trim().replace(/^~\//u, `${home}/`);
	if (custom && !path.isAbsolute(custom)) throw new Error("Codex : renseigne un chemin absolu, ou laisse le champ vide pour la détection automatique.");
	const candidates = custom ? [custom] : [
		...(env.PATH ?? "").split(path.delimiter).filter(Boolean).flatMap(directory => names.map(name => path.join(directory, name))),
		...[[".local", "bin"], [".volta", "bin"], [".npm-global", "bin"], ...(platform === "win32" ? [["AppData", "Roaming", "npm"]] : [])].flatMap(parts => names.map(name => path.join(home, ...parts, name))),
		"/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/Applications/Codex.app/Contents/Resources/codex",
	];
	if (!custom) for (const directory of [[".codex", "packages", "standalone", "releases"], [".nvm", "versions", "node"]]) {
		const root = path.join(home, ...directory);
		const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
		for (const entry of entries.filter(entry => entry.isDirectory()).sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))) {
			for (const name of names) candidates.push(path.join(root, entry.name, "bin", name));
		}
	}
	for (const candidate of new Set(candidates)) {
		try { await fs.access(candidate, constants.X_OK); if ((await fs.stat(candidate)).isFile()) return candidate; }
		catch { /* Essayer le prochain emplacement standard. */ }
	}
	if (custom) throw new Error("Codex : aucun exécutable accessible à ce chemin.");
	return null;
}

export async function codexExecutable(executable: string): Promise<string> {
	if (!Platform.isDesktop) throw new Error("Codex est disponible uniquement sur ordinateur.");
	const fs = await import("fs/promises");
	const { constants } = await import("fs");
	const path = await import("path");
	const { platform, arch } = await import("process");
	let resolved = await fs.realpath(executable);
	if (platform === "win32" && path.extname(resolved).toLowerCase() === ".cmd") resolved = path.join(path.dirname(resolved), "node_modules", "@openai", "codex", "bin", "codex.js");
	if (path.basename(resolved) !== "codex.js") return executable;
	const root = path.dirname(path.dirname(resolved));
	const metadata: unknown = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || (metadata as Record<string, unknown>).name !== "@openai/codex") throw new Error("Codex : ce lanceur ne correspond pas à Codex CLI.");
	const targets: Record<string, string> = {
		"darwin:arm64": "aarch64-apple-darwin", "darwin:x64": "x86_64-apple-darwin",
		"linux:arm64": "aarch64-unknown-linux-musl", "linux:x64": "x86_64-unknown-linux-musl",
		"win32:arm64": "aarch64-pc-windows-msvc", "win32:x64": "x86_64-pc-windows-msvc",
	};
	const target = targets[`${platform}:${arch}`], roots = [path.join(root, "vendor")];
	try {
		const { createRequire } = await import("module");
		const dependency = createRequire(resolved).resolve(`@openai/codex-${platform}-${arch}/package.json`);
		roots.unshift(path.join(path.dirname(dependency), "vendor"));
	} catch { /* Les anciennes installations npm embarquent le binaire dans leur propre dossier vendor. */ }
	if (target) for (const vendor of roots) for (const folder of ["bin", "codex"]) {
		const binary = path.join(vendor, target, folder, platform === "win32" ? "codex.exe" : "codex");
		try { await fs.access(binary, constants.X_OK); if ((await fs.stat(binary)).isFile()) return binary; }
		catch { /* Essayer la disposition suivante. */ }
	}
	throw new Error("Codex : binaire natif introuvable. Réinstalle Codex CLI ou renseigne le chemin de son exécutable.");
}
