import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import * as process from "node:process";
import { resolve } from "node:path";
import { loadModel } from "../plugin/modes/finition-corrector/model";

async function main() {
	const root = resolve(process.argv[2]);
	const read = async (name: string): Promise<ArrayBuffer> => {
		const bytes = await readFile(resolve(root, name));
		return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	};
	const reference = JSON.parse(await readFile(resolve(root, "reference.json"), "utf8")) as { ids: number[]; scores: Record<string, number[]> };
	const output = (await loadModel(read, "electra")).classify(reference.ids);
	assert.deepEqual(Object.keys(output).sort(), Object.keys(reference.scores).sort());
	for (const [head, expected] of Object.entries(reference.scores)) {
		assert.equal(output[head].data.length, expected.length);
		for (let i = 0; i < expected.length; i++) assert(Math.abs(output[head].data[i] - expected[i]) < 0.001, `${head} : score différent à ${i}`);
	}
	process.stdout.write("PASS: modèle entraîné et exporté en Python chargé en TS, scores comparés à PyTorch\n");
}
void main().catch((error: unknown) => { console.error(error); process.exit(1); });
