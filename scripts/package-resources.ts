import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as process from "node:process";
import { resourceAssetName, resourceFiles, resourceSource, resourcePacks } from "../plugin/linguistic-files";

export async function packageResources(output: string) {
	if (!output) throw new Error("Indiquez le dossier de destination des ressources.");
	const destination = resolve(output);
	await mkdir(destination, { recursive: true });
	for (const engine of resourcePacks) {
		const files = [];
		for (const file of resourceFiles[engine]) {
			const source = resolve(resourceSource(engine, file));
			const bytes = await readFile(source);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			await copyFile(source, resolve(destination, resourceAssetName(engine, file)));
			files.push({ path: file, bytes: bytes.length, sha256 });
		}
		await writeFile(resolve(destination, `${engine}-resources.json`), JSON.stringify({ version: 1, engine, files }) + "\n");
		process.stdout.write(`${engine}: ${files.length} fichiers, ${files.reduce((sum, file) => sum + file.bytes, 0)} octets\n`);
	}
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) void packageResources(process.argv[2]).catch((error: unknown) => { console.error(error); process.exit(1); });
