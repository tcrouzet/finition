import * as assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(path.join(tmpdir(), "finition-submit-"));
try {
	copyFileSync(new URL("../submit.sh", import.meta.url), path.join(directory, "submit.sh"));
	copyFileSync(new URL("../manifest.json", import.meta.url), path.join(directory, "manifest.json"));
	const bin = path.join(directory, "bin");
	mkdirSync(bin);
	writeFileSync(path.join(bin, "gh"), `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$SUBMIT_TEST_LOG"
case "$1 $2" in
  'auth status') [ "$SUBMIT_TEST_CASE" != auth ] ;;
  'repo view') jq -n --argjson private "$([ "$SUBMIT_TEST_CASE" = private ] && echo true || echo false)" '{nameWithOwner:"test/plugin",isPrivate:$private}' ;;
  'api repos/test/plugin/contents/manifest.json')
    if [ "$SUBMIT_TEST_CASE" = source ]; then jq '.version="99.0.0"' manifest.json; else jq . manifest.json; fi ;;
  'release view')
    if [ "$SUBMIT_TEST_CASE" = network ]; then exit 1; fi
    jq -n --arg version "$(jq -r .version manifest.json)" --arg scenario "$SUBMIT_TEST_CASE" '{tagName:$version,isDraft:($scenario=="draft"),isPrerelease:false,assets:(if $scenario=="assets" then [{name:"manifest.json"}] else [{name:"manifest.json"},{name:"main.js"}] end)}' ;;
  'release download')
    if [ "$SUBMIT_TEST_CASE" = asset_manifest ]; then jq '.id="other"' manifest.json; else jq . manifest.json; fi ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
	writeFileSync(path.join(bin, "open"), '#!/bin/bash\nprintf "open %s\\n" "$*" >> "$SUBMIT_TEST_LOG"\n', { mode: 0o755 });
	const scenarios = ["ok", "auth", "private", "source", "draft", "assets", "asset_manifest", "network"];
	for (const scenario of scenarios) {
		const log = path.join(directory, `${scenario}.log`);
		const result = spawnSync("bash", ["submit.sh"], { cwd: directory, encoding: "utf8", timeout: 10000,
			env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, SUBMIT_TEST_CASE: scenario, SUBMIT_TEST_LOG: log } });
		assert.ifError(result.error);
		assert.equal(result.status, scenario === "ok" ? 0 : 1, `${scenario} : ${result.stderr}`);
		const calls = readFileSync(log, "utf8");
		assert.equal(calls.split("\n").includes("open https://community.obsidian.md/account/plugins"), scenario === "ok", scenario);
		assert.ok(!/\b(create|push|fork|--method|--field)\b/.test(calls), "Une publication distante a été demandée");
		if (scenario === "ok") {
			assert.match(result.stdout, /https:\/\/community\.obsidian\.md\/account\/plugins/);
			assert.match(result.stdout, /https:\/\/github.com\/test\/plugin/);
			assert.match(result.stdout, /ne soumet rien automatiquement/);
		}
	}
	process.stdout.write(`Soumission : ${scenarios.length} cas vérifiés ; aucune publication distante\n`);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
