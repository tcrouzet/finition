import type { App } from "obsidian";
import type FinitionPlugin from "../main";
import type { FinitionCorrectorEngine } from "../plugin/modes/finition-corrector";
import type { GrammalecteEngine } from "../plugin/modes/grammalecte";
import { structureCategoryWords } from "../plugin/modes/structure-signature";
import { buildStructureReport } from "../plugin/modes/structure-report";
import { analyzeCorrections } from "../plugin/modes/corrections";
import { resourceFixture } from "./check-linguistic-resources";

export const grammarRegressionText = "Cinq heures du matin, je m’éveille avec les idées plus claires. Pourquoi ne pas proposer aux utilisateurs de créer leur propre modèle ? C’est un énorme travail : il faut créer un dataset de dizaine de millier de phrases fautives avec leur version correcte, puis entraîné un modèle sur une machine musclée, voire sur les serveurs de [Hugging Face](https://huggingface.co). En attendant, j’utilise [CamenBERT](https://huggingface.co/docs/transformers/model_doc/camembert), un modèle libre, dont la dernière itération date de 2025 : résultats moins bon qu’avec le modèle Antidote chargé dans Finition, mais satisfaisant, surtout quand derrière je peux appeler la surpuissante correction IA.";

export async function checkGrammarRelations(engine: Pick<GrammalecteEngine, "parse">, controls = true): Promise<void> {
	const errors = await engine.parse(grammarRegressionText);
	const replacements = new Map([["dizaine", "dizaines"], ["millier", "milliers"], ["entraîné", "entraîner"], ["bon", "bons"]]);
	for (const [word, replacement] of replacements) {
		if (!errors.some(error => grammarRegressionText.slice(error.nStart, error.nEnd) === word && error.aSuggestions.includes(replacement))) throw new Error(`Relation grammaticale absente dans le paragraphe : ${word} → ${replacement}`);
	}
	if (!controls) return;
	let corrected = grammarRegressionText;
	for (const error of [...errors].reverse()) {
		const replacement = replacements.get(grammarRegressionText.slice(error.nStart, error.nEnd));
		if (replacement && error.aSuggestions.includes(replacement)) corrected = corrected.slice(0, error.nStart) + replacement + corrected.slice(error.nEnd);
	}
	const grammarRules = new Set(["accord.quantite", "accord.adjectif", "verbe.infinitif-coordonne"]);
	if ((await engine.parse(corrected)).some(error => grammarRules.has(error.sRuleId))) throw new Error("Le paragraphe corrigé reçoit encore une alerte de relation grammaticale");
	const prefix = "😀 Une phrase.\r\n";
	const scoped = await analyzeCorrections(engine, prefix + grammarRegressionText, prefix.length, prefix.length + grammarRegressionText.length);
	for (const original of errors.filter(error => grammarRules.has(error.sRuleId))) {
		if (!scoped.some(error => error.sRuleId === original.sRuleId && error.nStart === original.nStart + prefix.length && error.nEnd === original.nEnd + prefix.length)) throw new Error("Relations grammaticales : positions UTF-16 incorrectes dans la sélection");
	}
	for (const [text, replacement] of [["Une dizaine de millier de phrases.", "milliers"], ["Un million de dollar.", "dollars"], ["Des dizaines de phrase.", "phrases"], ["Résultats moins bon.", "bons"], ["Des résultats beaucoup plus bon.", "bons"], ["La robe très vert.", "verte"], ["Il faut lire puis écrit une note.", "écrire"], ["Nous devons préparer un corpus et entraîné un modèle.", "entraîner"]]) {
		if (!(await engine.parse(text)).some(error => error.aSuggestions.includes(replacement))) throw new Error(`Relation grammaticale absente : ${text}`);
	}
	for (const text of ["Un millier de phrases. Une dizaine de livres.", "De millier en millier. De million en million.", "Des résultats moins bons.", "La liste des mots affichée.", "Toutes les variantes d’un mot rassemblées sous une même racine.", "Un homme à la voix douce.", "Les résultats coûtent moins cher.", "Il fait bon vivre.", "Il faut utiliser un modèle testé et entraîné par nos soins.", "Il faut utiliser un modèle choisi par Paul et entraîné par Marie.", "Il faut utiliser un modèle testé puis entraîné une petite semaine.", "Il veut lire, puis elle a entraîné un modèle.", "Il a préparé un corpus, puis entraîné un modèle.", "Il faut avoir terminé puis entraîné un modèle.", "Il faut être inscrit et entraîné."]) {
		if ((await engine.parse(text)).some(error => error.sRuleId === "accord.quantite" || error.sRuleId === "accord.adjectif" || error.sRuleId === "verbe.infinitif-coordonne")) throw new Error(`Faux positif de relation grammaticale : ${text}`);
	}
}

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
	let documentText = "Une bonjor.";
	let report = "";
	const view = { editor: { getValue: () => documentText, getSelection: () => "", listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }], getCursor: () => ({ line: 0, ch: 0 }), posToOffset: () => 0 } };
	const plugin = new Plugin({ workspace: { iterateAllLeaves() {}, getLeaf: () => ({ async openFile() {} }), getActiveViewOfType: () => activeView ? view : null }, vault: { adapter: fixture.adapter, getAbstractFileByPath: () => null, async read() { return report; }, async create(_path: string, content: string) { report = content; return {}; } } } as unknown as App, { id: "finition", name: "Finition", version: "0.0.0", minAppVersion: "1.0.0", description: "", author: "", dir: "test-plugin" });
	const internal = plugin as unknown as { ensureSpellingEngine: () => Promise<FinitionCorrectorEngine>; pendingCategoryWords: Set<string>; resolvePendingWordCategories: () => Promise<void>; runStructureReport: () => Promise<void>; showModeMenu: (event: MouseEvent) => void };
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
		await checkGrammarRelations(engine);
		for (const [text, original, replacement] of [
			["Les utilisateurs, peuvent créer leur modèle.", "utilisateurs,", "utilisateurs"],
			["La sœur de mes amies, prépare le repas.", "amies,", "amies"],
			["La petite sœur de mes amies, prépare le repas.", "amies,", "amies"],
			["Je souhaite, créer un modèle.", "souhaite,", "souhaite"],
			["Je pense, que tu viendras.", "pense,", "pense"],
			["Nous proposons, aux lecteurs de participer.", "proposons,", "proposons"],
			["Elle a proposé à sa sœur, de venir.", "sœur,", "sœur"],
			["Comment construire un modèle.", ".", "\u00a0?"],
			["Peut-on créer un modèle.", ".", "\u00a0?"],
			["Est-ce que tu viendras demain.", ".", "\u00a0?"],
			["Où habite ton amie.", ".", "\u00a0?"],
			["Qu’avez-vous décidé.", ".", "\u00a0?"],
		]) {
			check((await engine.parse(text)).some(error => error.sRuleId.startsWith("ponctuation.") && text.slice(error.nStart, error.nEnd) === original && error.aSuggestions.includes(replacement)), `Relation syntaxique ignorée : ${text}`);
		}
		for (const text of [
			"Les utilisateurs, qui ont essayé le plugin, peuvent créer leur modèle.",
			"Les utilisateurs, après quelques essais, peuvent créer leur modèle.",
			"Les utilisateurs, eux aussi, peuvent créer leur modèle.",
			"Les utilisateurs peuvent, s’ils le souhaitent, créer leur modèle.",
			"Nous proposons aux lecteurs, notamment aux débutants, de participer.",
			"Je demande à mes amies, de vrais spécialistes, de participer.",
			"Je pars, pour me reposer.", "Moi, je viendrai demain.",
			"Paul, Marie et Léa peuvent créer un modèle.",
			"Je sais comment construire un modèle.",
			"Pourquoi construire un modèle est une question légitime.",
			"Pourquoi construire un modèle est utile.",
			"Pourquoi il est parti reste un mystère.",
			"Quand vient l’hiver, tout change.",
			"Quand il arrive, tout change.",
			"Quand tu auras terminé, préviens-moi.",
			"Où il passe, tout change.",
			"« Comment construire un modèle » est le titre.",
			"Quel plaisir de lire ce livre.",
		]) {
			check(!(await engine.parse(text)).some(error => error.sRuleId.startsWith("ponctuation.")), `Faux positif syntaxique : ${text}`);
		}
		for (const text of ["", "\u0000\u202e😀\u200f", "le livre de ".repeat(100) + "ces auteurs, paraît demain.", "Pourquoi ne pas créer un mode\u0300le.", "[[]]`{}<>".repeat(200)]) {
			check((await engine.parse(text)).every(error => error.nStart >= 0 && error.nStart < error.nEnd && error.nEnd <= text.length), "Analyse syntaxique : plage invalide sur une entrée inhabituelle");
		}
		const punctuationText = "Pourquoi ne pas proposer aux utilisateurs, de créer leur propre modèle.";
		const punctuation = (await engine.parse(punctuationText)).filter(error => error.sRuleId.startsWith("ponctuation."));
		check(punctuation.length === 2 && punctuation.some(error => error.sRuleId === "ponctuation.complement-infinitif") && punctuation.some(error => error.sRuleId === "ponctuation.interrogation"), "Virgule du complément ou point interrogatif ignoré");
		let punctuated = punctuationText;
		for (const error of [...punctuation].reverse()) {
			check(punctuationText.slice(error.nStart, error.nEnd) === (error.sRuleId === "ponctuation.interrogation" ? "." : "utilisateurs,"), "Positions de ponctuation invalides");
			punctuated = punctuated.slice(0, error.nStart) + error.aSuggestions[0] + punctuated.slice(error.nEnd);
		}
		check(punctuated === "Pourquoi ne pas proposer aux utilisateurs de créer leur propre modèle\u00a0?", "Correction de ponctuation ou insécable incorrecte");
		for (const text of ["Pourquoi proposer un modèle.", "Pourquoi ne jamais demander de nouvelles.", "Une phrase. Pourquoi ne pas leur proposer un modèle.", "« Pourquoi ne pas proposer un modèle. »"]) {
			check((await engine.parse(text)).some(error => error.sRuleId === "ponctuation.interrogation" && error.aSuggestions.includes("\u00a0?")), `Interrogation infinitive ignorée : ${text}`);
		}
		for (const text of ["Nous proposons aux lecteurs, de participer.", "Elle demande à son frère, de venir demain.", "Nous conseillons aux lecteurs, d’écrire demain."]) {
			check((await engine.parse(text)).some(error => error.sRuleId === "ponctuation.complement-infinitif"), `Complément infinitif séparé par une virgule : ${text}`);
		}
		for (const text of [punctuated, "Je me demande pourquoi ne pas proposer un modèle.", "# Pourquoi ne pas proposer un modèle.", "Pourquoi ne pas proposer un modèle…", "Les conseils des utilisateurs, de vrais experts, sont précieux.", "Je propose aux utilisateurs, pour commencer, de créer un modèle.", "Je demande à ces lecteurs, qui sont mes amis, de participer.", "« Pourquoi ne pas proposer un modèle » est un titre.", "« Pourquoi ne pas proposer un modèle » figure en tête.", "Pourquoi proposer un modèle est expliqué dans ce livre."]) {
			check(!(await engine.parse(text)).some(error => error.sRuleId.startsWith("ponctuation.")), `Faux positif de ponctuation : ${text}`);
		}
		const scopedPunctuation = "Une phrase.\r\n😀\r\n" + punctuationText;
		const scopedErrors = await analyzeCorrections(engine, scopedPunctuation, scopedPunctuation.indexOf("Pourquoi"), scopedPunctuation.length);
		const scopedCorrections = scopedErrors.filter(error => error.sRuleId.startsWith("ponctuation."));
		check(scopedCorrections.length === 2 && scopedCorrections.every((error, i) => error.nStart === punctuation[i].nStart + scopedPunctuation.indexOf("Pourquoi") && error.nEnd === punctuation[i].nEnd + scopedPunctuation.indexOf("Pourquoi")), "Ponctuation : sélection ou positions UTF-16 invalides");
		check(!(await engine.parse("`" + punctuationText + "`\n[[" + punctuationText + "]]\n[" + punctuationText + "](https://example.org/a.b)")).some(error => error.sRuleId.startsWith("ponctuation.")), "Ponctuation analysée dans une zone Markdown protégée");
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
		const grammar = await internal.ensureSpellingEngine();
		documentText = "Liras-tu demain ? Dis-leur que je continuerai. Toutes les variantes d’un mot rassemblées sous une même racine.";
		const words = structureCategoryWords(documentText);
		const grammarCategories = await grammar.getCategories(words);
		const neuralCategories = await engine.getCategories(words);
		check(JSON.stringify(grammarCategories) !== JSON.stringify(neuralCategories), "Le cas de test ne distingue pas les catégories des deux moteurs");
		plugin.settings.debugMode = true;
		for (const [analysis, correction, categories] of [["finition-corrector", "grammalecte", neuralCategories], ["grammalecte", "finition-corrector", grammarCategories]] as const) {
			await plugin.setAnalysisEngine(analysis);
			await plugin.setSpellingEngine(correction);
			for (const word of words) internal.pendingCategoryWords.add(word);
			await internal.resolvePendingWordCategories();
			check(words.every(word => plugin.wordCategoryCache.get(word) === categories[word]), "Tricolons ou Cadence utilisent les catégories du correcteur plutôt que le choix d’analyse");
			await internal.runStructureReport();
			check(report === buildStructureReport(documentText, word => categories[word.toLowerCase()] ?? ""), "Structure utilise le correcteur plutôt que le dictionnaire choisi");
		}
		documentText = "Une bonjor.";
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
