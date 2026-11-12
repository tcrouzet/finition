import { build, stop } from "esbuild";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import * as process from "node:process";
import { rawAssets } from "../plugin/raw-assets.mjs";

async function main() {
  const bundled = await build({
    stdin: { resolveDir: new URL("..", import.meta.url).pathname, contents: `
      import { strict as assert } from "node:assert";
      import { readFile } from "node:fs/promises";
      import { createElectraCorrector } from "./plugin/modes/finition-corrector/electra";
      export async function check(root) {
        const read = async file => { assert(/\\.(json|bin)$/.test(file), "Lecture d’un fichier de code"); const data = await readFile(root + "/Antidote/model/" + file); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); };
        globalThis.fetch = async () => { throw new Error("Connexion réseau interdite pendant le test local."); };
        const started = performance.now();
        const correct = await createElectraCorrector(read);
        const cases = [
          ["Je me demande ou il habite.", "ou", "où"],
          ["Il et très gentil.", "et", "est"],
          ["😀 Je me demande ou il habite.", "ou", "où"],
          ["Un début.\\r\\nJe me demande ou il habite.", "ou", "où"],
          ["Ces une belle journée.", "Ces", "C'est"],
          ["Il ses trompé de chemin.", "ses", "s'est"],
          ["Je pense il viendra demain.", "il", "qu'il"],
          ["Il faut tu viennes demain.", "tu", "que tu"],
          ["Quand il pleut je reste chez moi.", " je", ", je"],
          ["Il et tre\\u0300s gentil.", "et", "est"],
          ["Il faut qu’il est terminé demain.", "est", "ait"],
          ["Je souhaite qu’il est compris.", "est", "ait"],
          ["Je veux que tu est confiance.", "est", "aies"],
          ["Il faut que j’est fini demain.", "est", "aie"],
          ["J’est oublié mon manteau.", "est", "ai"],
          ["J’espère que tu est prêt.", "est", "es"],
          ["Je suis heureux qu’il est réussi.", "est", "ait"],
        ];
        for (const [text, original, replacement] of cases) {
          const errors = await correct(text);
          assert(errors.some(error => error.sOriginal === original && error.aSuggestions.includes(replacement)), text + ": " + JSON.stringify(errors));
          for (const error of errors) assert.equal(text.slice(error.nStart, error.nEnd), error.sOriginal, "UTF-16 offsets");
          assert.deepEqual(await correct(text), errors, "Cache");
        }
        const controls = ["Je me demande où il habite.", "Il est très gentil.", "Tu peux choisir le thé ou le café.", "Elle aime ses enfants et leur parle.", "Ces personnes se sont rencontrées hier.", "Ce livre raconte son histoire.", "Les enfants ont terminé leurs devoirs.", "Son frère et sa sœur sont arrivés.", "Nous allons en pleine terre.", "C’est une belle journée.", "S’est-il trompé de chemin ?", "Il habite à Paris depuis dix ans."];
        controls.push(
          "Il faut qu’il ait terminé demain.", "Je souhaite qu’il ait compris.",
          "Je veux que tu aies confiance.", "Il faut que j’aie fini demain.",
          "J’ai oublié mon manteau.", "J’espère que tu es prêt.",
          "Je suis heureux qu’il ait réussi.", "J’estime que ce choix est juste.",
          "Elle sait qu’il est déjà parti.", "Je crois qu’il est malade.",
          "Bien qu’il ait raison, il se tait.", "Pourvu qu’elle ait raison !",
          "Je ne crois pas qu’il ait compris.", "Il est possible qu’il ait oublié.",
          "Il est parti avant que tu aies fini.", "Il attend que j’aie fini.",
          "Elle voudrait que tu aies confiance.", "Je pensais que tu étais prêt.",
          "Il faut que tu sois prêt.", "Elle est venue et elle est repartie.",
          "Ses enfants sont heureux.", "Il s’est trompé de chemin.",
          "C’est ici que ses enfants habitent.", "Ces livres sont à elle.",
          "Je ne sais pas où elle habite.", "Le village où elle est née est loin.",
          "Tu peux venir lundi ou mardi.", "Il ne sait pas où aller.",
          "Tu as été un phare pour tes amies.", "Une main sur ton cercueil.",
          "Vingt et un ans !", "Peut-être ne liras-tu rien du tout.",
          "Dis-leur que je continuerai.",
          "Toutes les variantes d’un mot rassemblées sous une même racine.",
          "Il parle de l’est de la France.", "Cette ville est située à l’est.",
          "Il cite le mot « est » dans son exemple.",
          "Elle et lui sont venus avec ces amis.", "Ces fleurs sont pour ses amies.",
          "Ce qu’il sait est juste.", "Il veut qu’on ait tous confiance.",
          "M. Dupont est arrivé à 10 h 30.",
        );
        for (const text of controls) assert.deepEqual(await correct(text), [], "Faux positif: " + text);
        const long = "La petite maison est dans le jardin avec les arbres et les oiseaux ".repeat(50) + "Je me demande ou il habite.";
        const longErrors = await correct(long);
        assert(longErrors.some(error => error.aSuggestions.includes("où") && error.nStart === long.lastIndexOf("ou il")), "Long paragraph windows: " + JSON.stringify(longErrors));
        const original = "Nous t’avon enterrée hier en plaine terre, dans le cimetières de Montagnac en Lot-et-Garonne, derrière l’église en surplomb de la vallée de la Lède, presque o-dessus de ta maison de familles.";
        assert(!(await correct(original)).some(error => error.sOriginal === "plaine"), "Cette tête ne prédit pas plaine/pleine");
        const invalid = await createElectraCorrector(file => file === "electra/labels.json" ? Promise.resolve(new TextEncoder().encode("{}").buffer) : read(file)).then(() => null, error => error);
        assert(invalid instanceof Error && invalid.message.includes("Classes neuronales"), "Classes invalides acceptées");
        const duplicate = JSON.parse(new TextDecoder().decode(await read("electra/labels.json")));
        duplicate.ou[2] = duplicate.ou[1];
        const duplicated = await createElectraCorrector(file => file === "electra/labels.json" ? Promise.resolve(new TextEncoder().encode(JSON.stringify(duplicate)).buffer) : read(file)).then(() => null, error => error);
        assert(duplicated instanceof Error && duplicated.message.includes("Classes neuronales"), "Classes dupliquées acceptées");
        console.log("PASS: ELECTRA hors ligne, " + cases.length + " corrections, " + controls.length + " contrôles, UTF-16, cache, fenêtres et validation ; " + Math.round(performance.now()-started) + " ms");
      }
    ` },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "es2020",
    external: ["@huggingface/tokenizers"],
    plugins: [rawAssets],
    logLevel: "silent",
  });
  stop();
  const module = { exports: {} as { check?: (root: string) => Promise<void> } };
  const evaluate = runInThisContext(`(function(require,module,exports){${bundled.outputFiles[0].text}\n})`) as (require: ReturnType<typeof createRequire>, loadedModule: typeof module, exports: typeof module.exports) => void;
  evaluate(createRequire(import.meta.url), module, module.exports);
  await module.exports.check!(new URL("..", import.meta.url).pathname.replace(/\/$/u, ""));
}
void main().catch((error: unknown) => { console.error(error); process.exit(1); });
