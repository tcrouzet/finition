import type { App } from "obsidian";
import type FinitionPlugin from "../main";
import type { FinitionCorrectorEngine } from "../plugin/modes/finition-corrector";
import type { GrammalecteEngine } from "../plugin/modes/grammalecte";
import { analyzeCorrections } from "../plugin/modes/corrections";
import { resourceFixture } from "./check-linguistic-resources";

export async function checkCorrectionScope(engine: Pick<GrammalecteEngine, "parse">): Promise<void> {
	const text = "Une bonjor.\r\n😀 Une bonjor.\r\nUne bonjor.";
	const from = text.indexOf("😀");
	const to = text.lastIndexOf("\r\n");
	const selected = await analyzeCorrections(engine, text, from, to);
	if (selected.length !== 1 || selected[0].nStart !== text.indexOf("bonjor", from) || text.slice(selected[0].nStart, selected[0].nEnd) !== "bonjor") throw new Error("Sélection : texte ou positions incorrectes");
	const whole = await analyzeCorrections(engine, text, from, from);
	if (whole.filter(error => error.sType === "orthographe" && error.sValue === "bonjor").length !== 3) throw new Error("Sans sélection : document incomplet");
	if ((await analyzeCorrections(engine, "Une faute.\nUne bonjor.", 0, 10)).length) throw new Error("Erreur signalée hors sélection");
}

export async function checkFinitionCorrector(Plugin: typeof FinitionPlugin, getCorrectionItem: (engine?: "grammalecte" | "finition-corrector" | "ia") => { checked: boolean; click: () => Promise<void> }): Promise<void> {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	let activeView = true;
	const fixture = await resourceFixture();
	const view = { editor: { getValue: () => "Une bonjor.", getSelection: () => "", listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }], getCursor: () => ({ line: 0, ch: 0 }), posToOffset: () => 0 } };
	const plugin = new Plugin({ workspace: { iterateAllLeaves() {}, getActiveViewOfType: () => activeView ? view : null }, vault: { adapter: fixture.adapter } } as unknown as App, { id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.0.0", description: "", author: "", dir: "test-plugin" });
	const internal = plugin as unknown as { ensureSpellingEngine: () => Promise<FinitionCorrectorEngine>; showModeMenu: (event: MouseEvent) => void };
	await plugin.loadSettings();
	check(plugin.settings.spellingEngine === "grammalecte", "Réglages existants : défaut modifié");
	plugin.settings.resourcePacks = fixture.revisions;
	await plugin.loadLinguisticResources();
	await plugin.setSpellingEngine("finition-corrector");
	await plugin.loadSettings();
	check(plugin.settings.spellingEngine === "finition-corrector", "Choix du moteur non persisté");
	const engine = await internal.ensureSpellingEngine();
	try {
		await checkCorrectionScope(engine);
		for (const text of ["toutes les variantes d’un mot rassemblées sous une même racine, par exemple « étais, étaient, est, es… » sous être.", "Les branches de cet arbre cassées.", "Les femmes avec un chapeau assises.", "La liste des mots affichée."]) {
			check((await engine.parse(text)).length === 0, `Accord avec le nom principal refusé : ${text}`);
		}
		for (const text of ["Les variantes d’un mot inconnue.", "Les branches de cet arbre cassée.", "Les variantes existent. Un mot rassemblées.", "La liste des mots affichées."]) {
			check((await engine.parse(text)).some(error => error.sRuleId === "accord.nom-adjectif"), `Accord fautif après complément ignoré : ${text}`);
		}
		check((await engine.getCategories(["maison"])).maison.includes("nom"), "Catégories Finition indisponibles pour Structure et Tricolons");
		for (const text of ["peut-être ne liras-tu rien du tout", "Dis-leur que je continuerai", "Viendra-t-elle demain ? Donne-le-moi. Va-t’en. Manges-en. Mène-m’y.", "Sont-ils venus ? Puis-je partir ? Allons-nous-en."]) {
			check((await engine.parse(text)).length === 0, `Forme verbale composée refusée : ${text}`);
		}
		for (const word of ["liraas-tu", "disent-leur", "liras-il", "est-t-il"]) {
			check((await engine.parse(word)).some(error => word.slice(error.nStart, error.nEnd) === word), `Forme verbale fautive acceptée : ${word}`);
		}
		check(Object.values(await engine.getCategories(["liras-tu", "Dis-leur"])).every(category => category.includes("verbe")), "Catégorie du verbe composé absente");
		check((await engine.parse("Paris Londres Shakespeare Thierry New York São Paulo.")).length === 0, "Noms propres ou composés refusés");
		const properTypo = await engine.parse("Shakespare.");
		check(properTypo.some(error => error.aSuggestions.includes("Shakespeare")), "Suggestion du dictionnaire fusionné absente");
		const enriched = await engine.parse("Ils dézinguassions.");
		check(enriched.some(error => error.sRuleId === "accord.sujet-verbe" && error.aSuggestions.includes("dézinguassent")), "Flexions supplémentaires non exploitées");
		const [first, second] = await Promise.all([engine.parse("Une bonjor."), engine.parse("😀\r\nUne bonjor.")]);
		check(first.length === 1 && first[0].aSuggestions.includes("bonjour"), "Suggestion absente");
		check(second.length === 1 && second[0].nStart === 8 && second[0].sValue === "bonjor", "Requêtes concurrentes ou offsets UTF-16 invalides");
		for (const text of ["Une petite maison. Les beaux chats dorment. Je mange une pomme.", "Nous vous aimons.", "Il nous parle.", "Je les garde.", "Tu as été un phare pour nous, pour tes amies et tes simples connaissances.", "Une main sur ton cercueil.", "Vingt et un ans !", "Mille et une nuits.", "Un an. Une nuit.", "Tes belles amies et tes anciens amis sont venus."]) {
			check((await engine.parse(text)).length === 0, `Faux positif : ${text}`);
		}
		for (const [text, suggestion] of [["Vingt et un an !", "ans"], ["Mille et une nuit.", "nuits"]]) {
			const error = (await engine.parse(text)).find(error => error.sRuleId === "accord.determinant-nom");
			check(error?.aSuggestions.length === 1 && error.aSuggestions[0] === suggestion, `Accord du nombre composé incorrect : ${text}`);
		}
		const errors = await engine.parse("Les chat. Les petit chats. Une pomme vert. Ils mange.");
		for (const [rule, suggestion] of [["accord.determinant-nom", "chats"], ["accord.nom-adjectif", "petits"], ["accord.nom-adjectif", "verte"], ["accord.sujet-verbe", "mangent"]]) {
			check(errors.some(error => error.sRuleId === rule && error.aSuggestions.includes(suggestion)), `Accord absent : ${suggestion}`);
		}
		const typos = await engine.parse("Une correstion. Des corrections suggéréés.");
		for (const [word, suggestion] of [["correstion", "correction"], ["suggéréés", "suggérées"]]) {
			check(typos.some(error => error.sValue === word && error.aSuggestions.includes(suggestion)), `Faute courante non corrigée : ${word}`);
		}
		const markdown = "---\r\nx: bonjor\r\n---\r\n😀 `bonjor` [bonjor](https://bonjor.fr) [[bonjor]]\r\n````ts\r\nbonjor\r\n`````\r\nUne bonjor.\r\n~~~\r\nbonjor";
		const protectedErrors = await engine.parse(markdown);
		check(protectedErrors.length === 1 && protectedErrors[0].nStart === markdown.indexOf("Une bonjor") + 4, "Markdown protégé ou offsets invalides");
		plugin.grammalecteErrors = first;
		internal.showModeMenu(new MouseEvent("click"));
		check(getCorrectionItem().checked, "Corrections non coché avec des suggestions");
		await getCorrectionItem().click();
		check(plugin.grammalecteErrors.length === 0, "Corrections coché : le clic doit effacer les suggestions");
		internal.showModeMenu(new MouseEvent("click"));
		check(!getCorrectionItem().checked, "Corrections reste coché après effacement");
		await getCorrectionItem().click();
		check(plugin.grammalecteErrors.some(error => error.sValue === "bonjor"), "Corrections décoché : le clic doit relancer l’analyse");
		internal.showModeMenu(new MouseEvent("click"));
		activeView = false;
		await getCorrectionItem().click();
		check(plugin.grammalecteErrors.length === 0, "Impossible d’effacer les suggestions après fermeture de la note");
		activeView = true;
		internal.showModeMenu(new MouseEvent("click"));
		await getCorrectionItem("grammalecte").click();
		check(plugin.settings.spellingEngine === "grammalecte" && plugin.grammalecteErrors.some(error => error.sValue === "bonjor"), "Grammalecte ne lance pas directement la correction");
		internal.showModeMenu(new MouseEvent("click"));
		check(getCorrectionItem("grammalecte").checked && !getCorrectionItem().checked, "Deux correcteurs locaux sont cochés");
		await getCorrectionItem("grammalecte").click();
		check(plugin.grammalecteErrors.length === 0, "Grammalecte coché ne retire pas les suggestions");
		plugin.aiGroups = [{ id: 1, delFrom: 0, delTo: 1, delText: "x", insText: "y" }];
		internal.showModeMenu(new MouseEvent("click"));
		check(getCorrectionItem("ia").checked, "Corrections IA non coché avec des suggestions");
		await getCorrectionItem("ia").click();
		check(plugin.aiGroups.length === 0, "Corrections IA coché ne retire pas les suggestions");
		plugin.grammalecteErrors = first;
		await plugin.addWordToGrammalecteDictionary("bonjor");
		check(plugin.grammalecteErrors.length === 0 && plugin.settings.grammalecteCustomDictionary.includes("bonjor"), "Dictionnaire personnel non partagé");
		plugin.grammalecteErrors = first;
		await plugin.setSpellingEngine("grammalecte");
		check(plugin.grammalecteErrors.length === 0, "Diagnostics périmés après changement de moteur");
		await plugin.setSpellingEngine("finition-corrector");
		check(await internal.ensureSpellingEngine() === engine, "Worker recréé inutilement");
		const cancelled = engine.parse("Bonjor.").then(() => false, () => true);
		engine.destroy();
		check(await cancelled, "Analyse non rejetée à l’arrêt du Worker");
		check((await engine.parse("Une faute.")).length === 0, "Worker impossible à redémarrer");
	} finally {
		engine.destroy();
	}
}
