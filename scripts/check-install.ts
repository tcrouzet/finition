import * as assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(path.join(tmpdir(), "finition-installer-"));
try {
	const bin = path.join(directory, "bin");
	mkdirSync(bin);
	copyFileSync(new URL("../install.sh", import.meta.url), path.join(directory, "install.sh"));
	writeFileSync(path.join(bin, "curl"), `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$INSTALL_TEST_LOG"
if [[ "$*" == *api.github.com* ]]; then
  if [ "$INSTALL_TEST_CASE" = incomplete ]; then printf '%s' '{"tag_name":"1.2.3","draft":false,"prerelease":false,"assets":[]}'; exit; fi
  printf '%s' '{"tag_name":"1.2.3","draft":false,"prerelease":false,"assets":[{"name":"main.js"},{"name":"manifest.json"},{"name":"styles.css"}]}'
  exit
fi
url=''; output=''
while [ "$#" -gt 0 ]; do
  case "$1" in https:*) url=$1 ;; --output) shift; output=$1 ;; esac
  shift
done
[[ "$url" == https://github.com/tcrouzet/finition/releases/download/1.2.3/* ]] || exit 99
file=$(basename "$url")
[ "$INSTALL_TEST_CASE" != download ] || [ "$file" != styles.css ] || exit 22
case "$file" in
  main.js) printf 'module.exports = "new";' > "$output" ;;
  styles.css) printf '.new {}' > "$output" ;;
  manifest.json)
    if [ "$INSTALL_TEST_CASE" = invalid ]; then printf '{"id":"other","version":"1.2.3"}' > "$output";
    else printf '{"id":"finition","version":"1.2.3"}' > "$output"; fi ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
	writeFileSync(path.join(bin, "uname"), '#!/bin/bash\nprintf "%s\\n" "$INSTALL_TEST_OS"\n', { mode: 0o755 });
	writeFileSync(path.join(bin, "cygpath"), `#!/bin/bash
case "$2" in
  C:*/obsidian/obsidian.json) printf '%s/registry/obsidian.json\\n' "$INSTALL_TEST_ROOT" ;;
  C:*) printf '%s/Mon coffre é ô\\n' "$INSTALL_TEST_ROOT" ;;
  *) printf '%s\\n' "$2" ;;
esac
`, { mode: 0o755 });
	const realMv = spawnSync("/bin/sh", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();
	writeFileSync(path.join(bin, "mv"), `#!/bin/bash
set -eu
if [ "$INSTALL_TEST_CASE" = rollback ] && [[ "$2" == */styles.css ]] && [ ! -e "$INSTALL_TEST_FAILED" ]; then
  touch "$INSTALL_TEST_FAILED"
  exit 1
fi
exec "${realMv}" "$@"
`, { mode: 0o755 });
	const scenarios = ["new", "update", "download", "invalid", "rollback", "cancel", "missing", "custom", "mac", "linux", "windows", "choice", "incomplete", "symlink"];
	for (const scenario of scenarios) {
		const root = path.join(directory, scenario);
		const home = path.join(root, "user");
		const vault = path.join(root, "Mon coffre é ô");
		const config = scenario === "custom" ? ".obsidian-perso" : ".obsidian";
		const target = path.join(vault, config, "plugins", "finition");
		mkdirSync(home, { recursive: true });
		mkdirSync(path.join(root, "tmp"));
		if (scenario !== "missing") mkdirSync(path.join(vault, config), { recursive: true });
		if (scenario !== "missing") writeFileSync(path.join(vault, "note.md"), "Ma note intacte.");
		const old = !["new", "custom", "mac", "linux", "windows", "choice", "missing", "symlink"].includes(scenario);
		if (old) {
			mkdirSync(target, { recursive: true });
			for (const file of ["main.js", "manifest.json", "styles.css"]) writeFileSync(path.join(target, file), `old:${file}`);
			writeFileSync(path.join(target, "data.json"), "réglages personnels");
		}
		if (scenario === "symlink") {
			const outside = path.join(root, "autre dossier");
			mkdirSync(outside);
			writeFileSync(path.join(outside, "main.js"), "ne pas toucher");
			mkdirSync(path.dirname(target), { recursive: true });
			symlinkSync(outside, target);
		}
		const automatic = ["mac", "linux", "windows", "choice"].includes(scenario);
		if (automatic) {
			const registry = scenario === "windows" ? path.join(root, "registry") : path.join(home, scenario === "mac" ? "Library/Application Support/obsidian" : ".config/obsidian");
			mkdirSync(registry, { recursive: true });
			writeFileSync(path.join(registry, "obsidian.json"), JSON.stringify({ vaults: { fixture: { path: scenario === "windows" ? "C:\\MyVault" : vault }, stale: { path: path.join(root, "absent") } } }));
		}
		const args = automatic ? [] : [vault, config];
		const log = path.join(root, "network.log");
		const result = spawnSync("/bin/bash", [path.join(directory, "install.sh"), ...args], { encoding: "utf8", timeout: 10000,
			input: scenario === "cancel" ? "n\n" : scenario === "choice" ? "99999999999999999999999999\n" : automatic ? "1\no\n" : "o\n",
			env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), TMPDIR: path.join(root, "tmp"), PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
				INSTALL_TEST_CASE: scenario, INSTALL_TEST_OS: scenario === "mac" ? "Darwin" : scenario === "windows" ? "MINGW64_NT" : "Linux", APPDATA: "C:\\Profile\\AppData\\Roaming", INSTALL_TEST_ROOT: root, INSTALL_TEST_LOG: log, INSTALL_TEST_FAILED: path.join(root, "failed") } });
		assert.ifError(result.error);
		const success = ["new", "update", "custom", "mac", "linux", "windows"].includes(scenario);
		assert.equal(result.status, success || scenario === "cancel" ? 0 : scenario === "download" ? 22 : 1, `${scenario}: ${result.stderr}`);
		if (success) {
			assert.equal(readFileSync(path.join(target, "main.js"), "utf8"), 'module.exports = "new";', scenario);
			assert.match(result.stdout, /1\.2\.3 installé/, scenario);
		} else if (old) {
			for (const file of ["main.js", "manifest.json", "styles.css"]) assert.equal(readFileSync(path.join(target, file), "utf8"), `old:${file}`, scenario);
		} else if (scenario === "symlink") assert.equal(readFileSync(path.join(target, "main.js"), "utf8"), "ne pas toucher");
		else assert.ok(!existsSync(target), scenario);
		if (scenario !== "missing") assert.equal(readFileSync(path.join(vault, "note.md"), "utf8"), "Ma note intacte.", scenario);
		if (old) assert.equal(readFileSync(path.join(target, "data.json"), "utf8"), "réglages personnels", scenario);
		if (["update", "rollback"].includes(scenario)) {
			const backups = path.join(vault, config, "finition-backups");
			const backup = path.join(backups, readdirSync(backups)[0]);
			assert.equal(readFileSync(path.join(backup, "main.js"), "utf8"), "old:main.js", scenario);
		}
		if (["cancel", "missing", "choice", "symlink"].includes(scenario)) assert.ok(!existsSync(log), scenario);
		assert.deepEqual(readdirSync(path.join(root, "tmp")), [], `Nettoyage : ${scenario}`);
	}
	process.stdout.write(`Installation : ${scenarios.length} cas vérifiés ; aucun vrai coffre modifié\n`);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
