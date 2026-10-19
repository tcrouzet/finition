import type { App } from "obsidian";
import type FinitionPlugin from "../main";
import type { FinitionCorrectorEngine } from "../plugin/modes/finition-corrector";
import { analyzeCorrections } from "../plugin/modes/corrections";
import { resourceFixture } from "./check-linguistic-resources";
import { checkGrammarRelations } from "./check-finition-corrector";

export async function checkFinitionNeural(Plugin: typeof FinitionPlugin): Promise<void> {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const fixture = await resourceFixture();
  let reads = 0;
  let available = true;
  const plugin = new Plugin({
    workspace: { iterateAllLeaves() {} },
    vault: { adapter: { ...fixture.adapter, async readBinary(path: string) {
      if (!path.endsWith("/resources.json") && !path.endsWith("/finition-dictionnaire.json")) {
        reads++;
        if (!available) throw new Error("Modèle local absent.");
      }
      return fixture.adapter.readBinary(path);
    } } },
  } as unknown as App, { id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.0.0", description: "", author: "", dir: "test-plugin" });
  const internal = plugin as unknown as { ensureSpellingEngine: () => Promise<FinitionCorrectorEngine> };
  await plugin.loadSettings();
  check(plugin.settings.spellingNeural === false, "Neuronal activé par défaut");
  plugin.settings.resourcePacks = fixture.revisions;
  await plugin.loadLinguisticResources();
  await plugin.setSpellingEngine("finition-corrector");
  const engine = await internal.ensureSpellingEngine();
  try {
    check(!(await engine.parse("Il va a Paris demain.")).some(error => error.sRuleId.startsWith("neural.")), "Couche désactivée ignorée");
    check(reads === 0, "Chargement neuronal sans activation");
    plugin.settings.spellingNeural = true;
    await plugin.setSpellingEngine("finition-corrector");
    await plugin.loadSettings();
    check(plugin.settings.spellingNeural === true, "Réglage neuronal non persisté");
    await internal.ensureSpellingEngine();
    await checkGrammarRelations(engine, false);
    const started = performance.now();
    const text = "Une bonjor.\r\nIl va a Paris demain.\r\n😀 Les enfants son dans le jardin.\r\nIls on terminé leur travail.\r\nJe me demande ou il habite.";
    let preview = false;
    const errors = (await engine.parse(text, partial => {
      check(!preview && partial.some(error => error.sValue === "bonjor") && !partial.some(error => error.sRuleId.startsWith("neural.")), "Premières corrections absentes ou déjà neuronales");
      preview = true;
    })).filter(error => error.sRuleId.startsWith("neural."));
    check(preview, "Les corrections attendent encore la fin du calcul neuronal");
    for (const [original, suggestion] of [["a", "à"], ["son", "sont"], ["on", "ont"], ["ou", "où"]]) {
      check(errors.some(error => error.aSuggestions.includes(suggestion) && text.slice(error.nStart, error.nEnd) === original), `Neuronal : ${original} → ${suggestion} absent ; ${JSON.stringify(errors)}`);
    }
    const readCount = reads;
    const again = await engine.parse(text);
    check(again.filter(error => error.sRuleId.startsWith("neural.")).length === 4 && reads === readCount, "Cache neuronal ou réutilisation du modèle invalide");
    const observerError = await engine.parse(text, () => { throw new Error("Observateur arrêté."); }).then(() => "", (error: Error) => error.message);
    check(observerError === "Observateur arrêté.", "Erreur d’affichage non propagée");
    const original = "Nous t’avon enterrée hier en plaine terre, dans le cimetières de Montagnac en Lot-et-Garonne, derrière l’église en surplomb de la vallée de la Lède, presque o-dessus de ta maison de familles.";
    check((await engine.parse(original)).some(error => original.slice(error.nStart, error.nEnd) === "plaine" && error.aSuggestions.includes("pleine")), "La confusion contextuelle plaine/pleine reste ignorée");
    const missing = await engine.parse("Je pense il viendra demain.");
    check(missing.some(error => error.sRuleId === "neural.electra.MotsManquantsGeneralDevant" && error.aSuggestions.includes("qu'il")), "Les poids spécialisés ne sont pas branchés au moteur");
    const punctuation = "Pourquoi ne pas proposer aux utilisateurs, de créer leur propre modèle.";
    const punctuationErrors = (await engine.parse(punctuation)).filter(error => error.sRuleId.startsWith("ponctuation."));
    check(punctuationErrors.length === 2 && punctuationErrors.some(error => error.aSuggestions.includes("utilisateurs")) && punctuationErrors.some(error => error.aSuggestions.includes("\u00a0?")), "La fusion neuronale masque les corrections de ponctuation");
    for (const [text, replacement] of [["Les utilisateurs, peuvent créer leur modèle.", "utilisateurs"], ["Je pense, que tu viendras.", "pense"], ["Est-ce que tu viendras demain.", "\u00a0?"]]) {
      check((await engine.parse(text)).some(error => error.sRuleId.startsWith("ponctuation.") && error.aSuggestions.includes(replacement)), `La fusion neuronale perd une relation syntaxique : ${text}`);
    }
    check(!(await engine.parse("Pourquoi ne pas proposer aux utilisateurs de créer leur propre modèle\u00a0?")).some(error => error.sRuleId.startsWith("ponctuation.") || error.sRuleId.endsWith("VirguleManquanteGeneraleDevant")), "La correction neuronale redemande une ponctuation déjà corrigée");
    for (const [text, original, replacement] of [["Il à faim.", "à", "a"], ["Ils on faim.", "on", "ont"], ["Il n’à pas faim.", "à", "a"]]) {
      const errors = await engine.parse(text);
      check(errors.some(error => text.slice(error.nStart, error.nEnd) === original && error.aSuggestions.includes(replacement)), `Phrase courte ou élision ignorée : ${text}`);
    }
    const controls = ["Il a terminé son travail.", "Paul et Marie sont arrivés.", "Je ne sais pas où il habite.", "Tu peux choisir le thé ou le café.", "Sa voiture est devant la maison.", "Ça me semble très bien.", "On a beaucoup parlé de ces idées.", "Ces personnes se sont rencontrées hier.", "Elle aime ses enfants et leur parle.", "Ce livre raconte son histoire.", "Les enfants ont terminé leurs devoirs.", "Son frère et sa sœur sont arrivés.", "Nous avons traversé une vaste plaine.", "La plaine est fertile et la terre est humide.", "Il a mis les fleurs en pleine terre.", "Tu as été un phare pour nous, pour tes amies et tes simples connaissances.", "Une main sur ton cercueil.", "Vingt et un ans !"];
    for (const correct of controls) {
      check((await engine.parse(correct)).length === 0, `Faux positif sur texte correct : ${correct}`);
    }
    for (const correct of ["peut-être ne liras-tu rien du tout", "Dis-leur que je continuerai"]) {
      check((await engine.parse(correct)).length === 0, `Faux positif neuronal sur verbe composé : ${correct}`);
    }
    for (const correct of ["Il a faim.", "Ils ont faim.", "Il n’a pas faim.", "Elle n’a rien dit.", "Il l’a déjà vu.", "Je pense qu’on viendra.", "On part.", "À Paris."]) {
      check((await engine.parse(correct)).length === 0, `Faux positif sur phrase courte ou élision : ${correct}`);
    }
    const attachment = "toutes les variantes d’un mot rassemblées sous une même racine, par exemple « étais, étaient, est, es… » sous être.";
    check((await engine.parse(attachment)).length === 0, "Accord avec le nom principal rejeté par le moteur neuronal");
    for (const tags of ["", " #on #a #bonjor"]) {
      const scopedText = `Les enfants son dans le jardin.\r\n😀 Il va a Paris demain.${tags}\r\nIls on terminé leur travail.`;
      const selected = await analyzeCorrections(engine, scopedText, scopedText.indexOf("Il va"), scopedText.lastIndexOf("\r\n"));
      check(selected.length === 1 && selected[0].aSuggestions.includes("à") && selected[0].nStart === scopedText.indexOf("a Paris"), "Sélection neuronale ou offsets invalides");
      const progressText = `Une bonjor.\r\n😀 Une bonjor.${tags} Il va a Paris demain.\r\nUne bonjor.`;
      let previewPosition = -1;
      await analyzeCorrections(engine, progressText, progressText.indexOf("😀"), progressText.lastIndexOf("\r\n"), partial => { previewPosition = partial.find(error => error.sValue === "bonjor")?.nStart ?? -1; });
      check(previewPosition === progressText.indexOf("bonjor", progressText.indexOf("😀")), "Offsets des premières corrections hors sélection");
    }
    check(!(await engine.parse("`Les enfants son dans le jardin.`\nhttps://exemple.fr\n[[Ils on terminé leur travail]]")).some(error => error.sRuleId.startsWith("neural.")), "Markdown analysé par le modèle");
    check(!(await engine.parse("```fr\nLes enfants son dans le jardin.\nIl va a Paris demain.\nIls on terminé leur travail.\n```\nUne petite maison.")).some(error => error.sRuleId.startsWith("neural.")), "Bloc de code analysé après répartition des paragraphes");
    plugin.settings.spellingNeural = false;
    await internal.ensureSpellingEngine();
    check(!(await engine.parse(text)).some(error => error.sRuleId.startsWith("neural.")), "Impossible de désactiver le neuronal");
    plugin.settings.spellingNeural = true;
    await internal.ensureSpellingEngine();
    const cancelled = engine.parse(text).then(() => false, () => true);
    engine.destroy();
    check(await cancelled, "Analyse neuronale non rejetée à l’arrêt du moteur");
    available = false;
    const failure = await engine.parse(text).then(() => "", (error: unknown) => error instanceof Error ? error.message : String(error));
    check(failure.includes("Modèle local absent"), "Erreur de chargement non propagée");
    plugin.settings.spellingNeural = false;
    await internal.ensureSpellingEngine();
    check((await engine.parse("Une petite maison.")).length === 0, "Moteur inutilisable après erreur neuronale");
    globalThis.document.querySelector("#neural-metrics")!.textContent = `Neuronal hors ligne : homophones, poids spécialisés, plaine/pleine, ${controls.length} phrases correctes, sélection, cache, arrêt et fichier absent ; ${Math.round(performance.now() - started)} ms (chargement compris)`;
  } finally { engine.destroy(); }
}
