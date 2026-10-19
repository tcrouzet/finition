import * as assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(path.join(tmpdir(), "finition-release-"));
const scenarios = ["mismatch", "ok", "trunk", "api-failure", "build-failure", "resource-failure", "push-failure", "wrong-branch", "dirty"];
try {
	for (const scenario of scenarios) {
		const root = path.join(directory, scenario);
		const repository = path.join(root, "plugin test");
		const remote = path.join(root, "remote.git");
		const bin = path.join(root, "bin");
		const log = path.join(root, "calls.log");
		const release = path.join(root, "released.json");
		const branch = scenario === "trunk" ? "trunk" : "main";
		mkdirSync(repository, { recursive: true });
		mkdirSync(bin);
		const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, TMPDIR: root, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
			RELEASE_TEST_CASE: scenario, RELEASE_TEST_REMOTE: remote, RELEASE_TEST_BRANCH: branch, RELEASE_TEST_LOG: log, RELEASE_TEST_ASSET: release };
		const run = (command: string, args: string[]) => {
			const result = spawnSync(command, args, { cwd: repository, env, encoding: "utf8", timeout: 20000 });
			assert.ifError(result.error);
			assert.equal(result.status, 0, `${scenario} : ${command} ${args.join(" ")} : ${result.stderr}`);
			return result.stdout.trim();
		};
		const scripts = path.join(repository, "helper");
		mkdirSync(scripts, { recursive: true });
		const script = path.join(repository, "release.sh");
		copyFileSync(new URL("../release.sh", import.meta.url), script);
		writeFileSync(path.join(repository, "manifest.json"), JSON.stringify({ id: "test", version: "1.2.3", minAppVersion: "1.4.0", description: "Test." }));
		writeFileSync(path.join(repository, "package.json"), JSON.stringify({ version: "1.2.3", scripts: { build: scenario === "build-failure" ? "node -e 'process.exit(1)'" : "node build.cjs", resources: scenario === "resource-failure" ? "node -e 'process.exit(1)'" : "node package-resources.cjs" } }));
		writeFileSync(path.join(repository, "package-resources.cjs"), 'const fs=require("node:fs"),path=require("node:path"); for(const name of ["grammalecte-resources.json","finition-corrector-resources.json","synonymes-resources.json"]) fs.writeFileSync(path.join(process.argv[2],name),"{}");');
		if (scenario !== "ok") writeFileSync(path.join(repository, "versions.json"), '{"1.2.3":"1.4.0"}');
		writeFileSync(path.join(repository, "build.cjs"), 'require("node:fs").writeFileSync("main.js", "module.exports = {};");');
		writeFileSync(path.join(repository, ".gitignore"), "main.js\n");
		writeFileSync(path.join(repository, "styles.css"), ".test {}\n");
		writeFileSync(path.join(bin, "gh"), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$RELEASE_TEST_LOG"
case "$1 $2" in
  'repo view') jq -n --arg branch "$RELEASE_TEST_BRANCH" '{nameWithOwner:"test/plugin",defaultBranchRef:{name:$branch}}' ;;
  'api '*)
    [ "$RELEASE_TEST_CASE" != api-failure ] || exit 1
    manifest=$(git --git-dir="$RELEASE_TEST_REMOTE" show "$RELEASE_TEST_BRANCH:manifest.json")
    if [ "$RELEASE_TEST_CASE" = mismatch ]; then jq '.description="Différent."' <<< "$manifest"; else printf '%s\\n' "$manifest"; fi ;;
  'release create') cp manifest.json "$RELEASE_TEST_ASSET" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
		run("git", ["init", "--bare", remote]);
		run("git", ["init", "-b", branch]);
		run("git", ["config", "user.name", "Release test"]);
		run("git", ["config", "user.email", "release@example.invalid"]);
		run("git", ["config", "commit.gpgsign", "false"]);
		run("git", ["config", "core.hooksPath", path.join(root, "no-hooks")]);
		run("git", ["add", "."]);
		run("git", ["commit", "-m", "Initial test"]);
		run("git", ["remote", "add", "origin", remote]);
		run("git", ["push", "origin", branch]);
		if (scenario === "push-failure") writeFileSync(path.join(remote, "hooks", "pre-receive"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
		if (scenario === "wrong-branch") run("git", ["checkout", "-b", "feature"]);
		if (scenario === "dirty" || scenario === "wrong-branch") writeFileSync(path.join(repository, "styles.css"), ".changed {}\n");
		if (scenario === "dirty") writeFileSync(path.join(repository, "new.txt"), "À publier.\n");
		const cwd = scenario === "trunk" ? scripts : scenario === "dirty" ? root : repository;
		const result = spawnSync("bash", [path.relative(cwd, script)], { cwd, env, encoding: "utf8", timeout: 20000 });
		assert.ifError(result.error);
		const succeeds = scenario === "ok" || scenario === "trunk" || scenario === "dirty";
		assert.equal(result.status, succeeds ? 0 : 1, `${scenario} : ${result.stdout}\n${result.stderr}`);
		assert.equal(existsSync(release), succeeds, `${scenario} : publication incorrecte`);
		if (scenario === "mismatch") assert.match(result.stderr, /le manifest GitHub diffère/);
		const local = JSON.parse(readFileSync(path.join(repository, "manifest.json"), "utf8")) as { version: string };
		if (scenario === "wrong-branch") {
			assert.equal(local.version, "1.2.3", scenario);
			assert.equal(run("git", ["rev-list", "--count", "HEAD"]), "1", "La mauvaise branche ne doit pas être commitée");
		}
		if (scenario === "resource-failure") {
			assert.equal(local.version, "1.2.3", scenario);
			assert.equal(run("git", ["rev-list", "--count", "HEAD"]), "1", "Un pack incomplet ne doit pas déclencher de commit");
		}
		if (succeeds) {
			const published = JSON.parse(run("git", ["--git-dir", remote, "show", `${branch}:manifest.json`])) as unknown;
			assert.deepEqual(JSON.parse(readFileSync(release, "utf8")), published);
			assert.equal(local.version, "1.2.4");
			assert.equal(run("git", ["rev-list", "--count", "HEAD"]), scenario === "dirty" ? "3" : "2", "Commit initial manquant ou vide");
			if (scenario === "dirty") {
				assert.equal(run("git", ["--git-dir", remote, "show", `${branch}:new.txt`]), "À publier.");
				assert.equal(run("git", ["--git-dir", remote, "show", `${branch}:styles.css`]), ".changed {}");
			}
			assert.match(readFileSync(log, "utf8"), new RegExp(`--target ${run("git", ["rev-parse", "HEAD"])}`));
			assert.match(readFileSync(log, "utf8"), /grammalecte-resources\.json/);
			assert.match(readFileSync(log, "utf8"), /finition-corrector-resources\.json/);
			assert.match(readFileSync(log, "utf8"), /synonymes-resources\.json/);
			assert.equal(run("git", ["status", "--porcelain"]), "");
		}
	}
	process.stdout.write(`Release : ${scenarios.length} cas vérifiés ; aucune publication distante\n`);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
