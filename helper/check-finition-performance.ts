import { build, stop } from "esbuild";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import * as process from "node:process";
import { rawAssets } from "../plugin/raw-assets.mjs";
import { Worker as NativeWorker } from "node:worker_threads";
import { resolveObjectURL } from "node:buffer";

async function main() {
  if (!process.argv[2]) throw new Error("Indiquez le texte à mesurer.");
  const root = process.cwd();
  Object.defineProperty(globalThis, "Worker", { value: class {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { message: string }) => void;
    private worker: Promise<NativeWorker>;
    constructor(url: string) {
      const blob = resolveObjectURL(url);
      if (!blob) throw new Error("Source du Worker absente.");
      this.worker = blob.text().then(source => {
        const worker = new NativeWorker(`
          const { parentPort } = require("node:worker_threads");
          const localRequire = require("node:module").createRequire(${JSON.stringify(root + "/package.json")});
          globalThis.self = globalThis;
          globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
          new Function("require", ${JSON.stringify(source)})(localRequire);
          parentPort.on("message", data => self.onmessage({ data }));
        `, { eval: true });
        worker.on("message", data => this.onmessage?.({ data }));
        worker.on("error", (error: Error) => this.onerror?.({ message: error.message }));
        return worker;
      });
    }
    postMessage(message: unknown, transfer: ArrayBuffer[] = []) { void this.worker.then(worker => worker.postMessage(message, transfer)); }
    terminate() { void this.worker.then(worker => worker.terminate()); }
  } });
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { readFile } from "node:fs/promises";
      import { createHash } from "node:crypto";
      import { strict as assert } from "node:assert";
      import { memoryUsage } from "node:process";
      import { FinitionCorrectorEngine } from "./plugin/modes/finition-corrector";
      export async function check(root, input) {
        const read = async file => { const path = file === "finition-dictionnaire.json" ? "ressources/camembert/" : file === "phonet_data.json" ? "ressources/grammalecte/" : file.startsWith("electra/") ? "Antidote/model/" : "ressources/camembert/"; const data = await readFile(root + "/" + path + file); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); };
        const source = await readFile(input, "utf8");
        globalThis.fetch = async () => { throw new Error("Réseau interdit pendant la mesure."); };
        const engine = new FinitionCorrectorEngine(read);
        engine.neuralEnabled = true;
        const deadline = setTimeout(() => engine.destroy(new Error("Budget de 40 secondes dépassé")), 40000);
        try {
          const started = performance.now();
          let first;
          const errors = await engine.parse(source, partial => {
            first ??= Math.round(performance.now()-started);
            for (const error of partial) assert.equal(source.slice(error.nStart,error.nEnd),error.sOriginal,"Offsets progressifs invalides");
          }), total = Math.round(performance.now()-started);
          assert(first !== undefined && first < total, "Premières corrections retardées jusqu’à la fin du calcul");
          const warm = performance.now(), again = await engine.parse(source), cached = Math.round(performance.now()-warm);
          assert.deepEqual(again, errors, "Cache différent du premier résultat");
          for (const error of errors) assert.equal(source.slice(error.nStart,error.nEnd),error.sOriginal,"Offsets invalides");
          const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
          console.log(JSON.stringify({characters:source.length,first,total,cached,rssMiB:Math.round(memoryUsage().rss/1024/1024),errors:errors.length,hash:digest(errors),inputHash:digest(source)}));
          assert(total < 40000, "Correction supérieure au budget de 40 secondes");
        } finally { clearTimeout(deadline); engine.destroy(); }
      }
    ` }, bundle: true, write: false, platform: "browser", format: "cjs", target: "es2020",
    external: ["node:*"], plugins: [rawAssets], logLevel: "silent",
  });
  stop();
  const require = createRequire(import.meta.url);
  const module = { exports: {} as { check: (root: string, input: string) => Promise<void> } };
  const evaluate = runInThisContext(`(function(require,module,exports){${bundle.outputFiles[0].text}\n})`) as (require: ReturnType<typeof createRequire>, module: { exports: unknown }, exports: unknown) => void;
  evaluate(require, module, module.exports);
  await module.exports.check(process.cwd(), process.argv[2]);
}
void main().then(() => process.exit(0), (error: unknown) => { console.error(error); process.exit(1); });
