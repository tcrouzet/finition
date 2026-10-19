import * as assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createRequire } from "node:module";
import { resourcePacks } from "../plugin/linguistic-files";

const yaml = createRequire(import.meta.url)("js-yaml") as { load: (source: string) => unknown };
const workflow = yaml.load(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")) as {
	on: { push: { tags: string[] } }; permissions: { contents: string };
	jobs: { build: { permissions: Record<string, string>; steps: Array<{ name?: string; uses?: string; run?: string; with?: Record<string, string> }> } };
};
assert.deepEqual(workflow.on.push.tags, ["[0-9]*"]);
assert.equal(workflow.permissions.contents, "read");
assert.equal(workflow.jobs.build.permissions["attestations"], "write");
assert.equal(workflow.jobs.build.permissions["id-token"], "write");
for (const step of workflow.jobs.build.steps.filter(step => step.uses)) assert.match(step.uses!, /^[^@]+@[a-f0-9]{40}$/);
const setup = workflow.jobs.build.steps.find(step => step.uses?.startsWith("actions/setup-node@"));
assert.equal(setup?.with?.["node-version-file"], ".nvmrc");
const attest = workflow.jobs.build.steps.find(step => step.uses?.startsWith("actions/attest@"));
assert.deepEqual(attest?.with?.["subject-path"].trim().split(/\s+/).sort(), ["main.js", "manifest.json", "styles.css"]);
const publication = workflow.jobs.build.steps.find(step => step.name === "Publish data and plugin separately")?.run;
assert.ok(publication, "Étape de publication absente");
const directory = mkdtempSync(path.join(tmpdir(), "finition-release-"));
const scenarios = ["mismatch", "ok", "trunk", "api-failure", "build-failure", "resource-failure", "push-failure", "tag-push-failure", "lint-failure", "typecheck-failure", "wrong-branch", "dirty"];
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
		const scripts = path.join(repository, "scripts");
		mkdirSync(scripts, { recursive: true });
		const script = path.join(repository, "release.sh");
		copyFileSync(new URL("../release.sh", import.meta.url), script);
		writeFileSync(path.join(repository, "manifest.json"), JSON.stringify({ id: "test", version: "1.2.3", minAppVersion: "1.4.0", description: "Test." }));
		writeFileSync(path.join(repository, "package.json"), JSON.stringify({ name: "release-fixture", version: "1.2.3", scripts: { lint: scenario === "lint-failure" ? "node -e 'process.exit(1)'" : "node -e 'process.exit(0)'", typecheck: scenario === "typecheck-failure" ? "node -e 'process.exit(1)'" : "node -e 'process.exit(0)'", build: scenario === "build-failure" ? "node -e 'process.exit(1)'" : "node build.cjs", resources: scenario === "resource-failure" ? "node -e 'process.exit(1)'" : "node package-resources.cjs" } }));
		writeFileSync(path.join(repository, "package-lock.json"), JSON.stringify({ name: "release-fixture", version: "1.2.3", lockfileVersion: 3, packages: { "": { name: "release-fixture", version: "1.2.3" } } }));
		writeFileSync(path.join(repository, "package-resources.cjs"), `const fs=require("node:fs"),path=require("node:path"); fs.mkdirSync(process.argv[2],{recursive:true}); for(const name of ${JSON.stringify(resourcePacks.map(pack => `${pack}-resources.json`))}) fs.writeFileSync(path.join(process.argv[2],name),"{}");`);
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
  'release create')
    node - "$@" <<'JS'
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2), tag = args[2];
const files = args.slice(3).filter(arg => fs.existsSync(arg) && fs.statSync(arg).isFile()).map(file => path.basename(file));
const output = process.env.RELEASE_TEST_ASSET + (tag.startsWith("resources-") ? ".resources" : "");
fs.writeFileSync(output, JSON.stringify({ tag, files, manifest: JSON.parse(fs.readFileSync("manifest.json","utf8")), args }));
JS
    ;;
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
		if (scenario === "tag-push-failure") writeFileSync(path.join(remote, "hooks", "pre-receive"), "#!/bin/bash\nwhile read -r old new ref; do if [[ \"$ref\" == refs/tags/* ]]; then exit 1; fi; done\n", { mode: 0o755 });
		if (scenario === "wrong-branch") run("git", ["checkout", "-b", "feature"]);
		if (scenario === "dirty" || scenario === "wrong-branch") writeFileSync(path.join(repository, "styles.css"), ".changed {}\n");
		if (scenario === "dirty") writeFileSync(path.join(repository, "new.txt"), "À publier.\n");
		const cwd = scenario === "trunk" ? scripts : scenario === "dirty" ? root : repository;
		const result = spawnSync("bash", [path.relative(cwd, script)], { cwd, env, encoding: "utf8", timeout: 20000 });
		assert.ifError(result.error);
		const succeeds = scenario === "ok" || scenario === "trunk" || scenario === "dirty";
		assert.equal(result.status, succeeds ? 0 : 1, `${scenario} : ${result.stdout}\n${result.stderr}`);
		const remoteTag = spawnSync("git", ["--git-dir", remote, "rev-parse", "--verify", "refs/tags/1.2.4"], { env, encoding: "utf8" });
		assert.equal(remoteTag.status === 0, succeeds, `${scenario} : tag distant incorrect`);
		assert.ok(!readdirSync(root).some(name => name.startsWith("finition-resources.")), "Ressources temporaires non nettoyées");
		assert.ok(!readFileSync(log, "utf8").includes("release create"), "release.sh téléverse encore des fichiers locaux");
		if (succeeds) {
			assert.equal(remoteTag.stdout.trim(), run("git", ["rev-parse", "HEAD"]));
			const dataDirectory = path.join(root, "finition-resources");
			run("npm", ["run", "resources", "--", dataDirectory]);
			const publicationResult: SpawnSyncReturns<string> = spawnSync("bash", ["-euo", "pipefail", "-c", publication], { cwd: repository, env: { ...env, RELEASE_TAG: "1.2.4", GITHUB_SHA: remoteTag.stdout.trim(), RUNNER_TEMP: root }, encoding: "utf8", timeout: 20000 });
			assert.equal(publicationResult.status, 0, `${scenario} : ${publicationResult.stderr}`);
		}
		assert.equal(existsSync(release), succeeds, `${scenario} : publication incorrecte`);
		if (scenario === "mismatch") assert.match(result.stderr, /le manifest GitHub diffère/);
		const local = JSON.parse(readFileSync(path.join(repository, "manifest.json"), "utf8")) as { version: string };
		if (scenario === "tag-push-failure") {
			assert.equal(local.version, "1.2.4", "Le refus doit intervenir après le bump");
			assert.equal(run("git", ["rev-parse", "refs/tags/1.2.4"]), run("git", ["rev-parse", "HEAD"]));
			assert.equal(run("git", ["--git-dir", remote, "rev-parse", branch]), run("git", ["rev-parse", "HEAD"]), "Le push de branche doit précéder le refus du tag");
		}
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
			const artifact = JSON.parse(readFileSync(release, "utf8")) as { tag: string; files: string[]; manifest: unknown; args: string[] };
			assert.deepEqual(artifact.manifest, published);
			assert.equal(artifact.tag, "1.2.4");
			assert.deepEqual(artifact.files.sort(), ["main.js", "manifest.json", "styles.css"]);
			assert.ok(artifact.args.includes("--verify-tag"));
			const data = JSON.parse(readFileSync(`${release}.resources`, "utf8")) as { tag: string; files: string[]; args: string[] };
			assert.equal(data.tag, "resources-1.2.4");
			assert.deepEqual(data.files.sort(), resourcePacks.map(pack => `${pack}-resources.json`).sort());
			assert.ok(data.args.includes("--prerelease") && data.args.includes("--latest=false"));
			assert.ok(data.args.includes(run("git", ["rev-parse", "HEAD"])));
			const lock = JSON.parse(readFileSync(path.join(repository, "package-lock.json"), "utf8")) as { version: string; packages: Record<string, { version: string }> };
			assert.equal(lock.version, "1.2.4");
			assert.equal(lock.packages[""].version, "1.2.4");
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
	process.stdout.write(`Release : ${scenarios.length} cas vérifiés, ressources séparées, attestations et tag CI ; aucune publication distante\n`);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
