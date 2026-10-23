import * as assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import type { GrammalecteError } from "../plugin/modes/grammalecte";
import type { FinitionRuntime, Highlight } from "../plugin/types";
import type { DecorationSet, EditorView } from "@codemirror/view";

export async function checkMarkdownExclusions(): Promise<void> {
	const result = await build({ stdin: { contents: 'export * from "./plugin/modes/tokenize"; export * from "./plugin/modes/finition-corrector/markdown"; export * from "./plugin/modes/corrections"; export * from "./plugin/ai/protected-links"; export * from "./plugin/modes/punctuation"; export * from "./plugin/modes/structure-signature"; export * from "./plugin/modes/structure-report"; export * from "./plugin/modes/statistics"; export * from "./plugin/markdown-tags"; export * from "./plugin/modes/repetition"; export * from "./plugin/editor-extension"; export { EditorState } from "@codemirror/state"; export { DEFAULT_SETTINGS } from "./plugin/types";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", write: false, loader: { ".md": "text" }, external: ["obsidian"] });
	const module = { exports: {} };
	runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, TextEncoder, CompressionStream, Blob, Response, require: (name: string) => { assert.equal(name, "obsidian"); return { Notice: class {} }; } });
	const { tokenize, maskMarkdown, analyzeCorrections, protectLinks, fixPunctuationSpacing, fixBlankLinesProtected, structureCategoryWords, sentenceStructureTokens, buildStructureReport, buildStatisticsReport, statisticsWords, frontmatterRanges, markdownExclusionRanges, maskMarkdownExclusions, computeRepetitions, finitionEditorExtension, EditorState, DEFAULT_SETTINGS } = module.exports as
		typeof import("../plugin/modes/tokenize") & typeof import("../plugin/modes/finition-corrector/markdown") & typeof import("../plugin/modes/corrections") & typeof import("../plugin/ai/protected-links") & typeof import("../plugin/modes/punctuation") & typeof import("../plugin/modes/structure-signature") & typeof import("../plugin/modes/structure-report") & typeof import("../plugin/modes/statistics") & typeof import("../plugin/markdown-tags") & typeof import("../plugin/modes/repetition") & typeof import("../plugin/editor-extension") & Pick<typeof import("@codemirror/state"), "EditorState"> & Pick<typeof import("../plugin/types"), "DEFAULT_SETTINGS">;
	const question = "Tu viens #projet ?";
	let logical: Highlight[] = [];
	const runtime = { settings: { ...DEFAULT_SETTINGS, mode: "formes" }, updateAnalysisHighlights(_view: EditorView, highlights: Highlight[]) { logical = highlights; } } as unknown as FinitionRuntime;
	const view = { state: EditorState.create({ doc: question }), dom: new EventTarget() } as unknown as EditorView;
	const factory = finitionEditorExtension(runtime) as unknown as { create: (view: EditorView) => { decorations: DecorationSet; destroy: () => void } };
	const instance = factory.create(view);
	try {
		assert.equal(logical.length, 1, "Le découpage visuel change le compteur logique des phrases");
		let decorationCount = 0;
		instance.decorations.between(0, question.length, (from, to) => {
			decorationCount++;
			assert.ok(!markdownExclusionRanges(question).some(([start, end]) => from < end && to > start), "Un surlignage de phrase colore un tag protégé");
		});
		assert.equal(decorationCount, 2, "La phrase doit rester surlignée de part et d’autre du tag");
	} finally { instance.destroy(); }
	const source = "\ufeff---\r\ntitle: secret!\r\ntags: [#école/🌿]\r\n...\r\n😀 Une fote #cachée/🌿.\r\nUne fote.";
	const body = source.indexOf("😀");
	const tokens = tokenize(source, new Map());
	assert.deepEqual(Array.from(tokens, token => token.form), ["une", "fote", "une", "fote"], "La tokenisation analyse YAML ou les tags");
	assert.equal(tokens[0].start, body + 3, "Les positions UTF-16 après YAML sont décalées");
	assert.deepEqual(Array.from(computeRepetitions(source, new Map(), new Set(["une"]), 1500, 2), item => item.from), [source.indexOf("fote"), source.lastIndexOf("fote")]);
	assert.equal(maskMarkdown(source).length, source.length);
	assert.ok(!maskMarkdown(source).includes("secret") && !maskMarkdown(source).includes("cachée"));
	const protectedOnly = source.slice(0, body);
	assert.equal(protectLinks(protectedOnly).text.trim(), "", "Le YAML est envoyé à l’IA");
	assert.equal(fixPunctuationSpacing(protectedOnly), protectedOnly, "La ponctuation modifie YAML");
	assert.equal(fixBlankLinesProtected("---\ntitle: secret\n\n\n---\n"), "---\ntitle: secret\n\n\n---\n");
	assert.ok(!structureCategoryWords(source).includes("secret"));
	assert.ok(!statisticsWords(source).includes("secret"));
	assert.ok(!buildStructureReport(source, () => "nom").includes("secret"));
	const report = await buildStatisticsReport(source, () => "nom", new Map());
	assert.match(report, /\nword_count: 4\n/);
	const bodyOnly = source.slice(body).replace("#cachée/🌿", "");
	assert.equal(report, await buildStatisticsReport(bodyOnly, () => "nom", new Map()), "Les métadonnées contribuent aux tailles ou statistiques");
	for (const text of ["---\ntitle: secret\n---\nCorps.", "\ufeff---\r\ntitle: secret\r\n...\r\nCorps.", "---\ntitle: secret\n...", "---\ntitle: secret", "---"]) {
		const masked = maskMarkdownExclusions(text);
		assert.equal(masked.length, text.length);
		assert.deepEqual([...masked.matchAll(/[\r\n]/g)].map(match => match.index), [...text.matchAll(/[\r\n]/g)].map(match => match.index));
		assert.ok(!masked.includes("secret"));
		assert.equal(protectLinks(text, 5, Math.min(text.length, 13)).text.trim(), "", "Une sélection partielle expose le YAML");
	}
	const heading = "# Titre\n## Suite\n#1984 et C#code\n\n---\nCorps.";
	assert.equal(maskMarkdownExclusions(heading), heading, "Un titre, nombre ou séparateur Markdown est masqué");
	assert.deepEqual(Array.from(frontmatterRanges(heading)), []);
	assert.match(await buildStatisticsReport("---\ntitle: secret\n---\n---\nCorps.", () => "nom", new Map()), /\nword_count: 1\n/, "Un séparateur du corps est pris pour du YAML après son exclusion");
	const bodyRule = "Avant.\n\n---\nCorps.";
	const categoryRequests: string[] = [];
	const bodyReport = buildStructureReport(bodyRule, word => { categoryRequests.push(word); return "nom"; });
	assert.ok(bodyReport.includes("Corps.") && categoryRequests.includes("corps"), "Un séparateur dans le corps masque la phrase suivante de Structure");
	const fragmentRequests: string[] = [];
	assert.ok(sentenceStructureTokens("---\nCorps.", word => { fragmentRequests.push(word); return "nom"; }).includes("NOM") && fragmentRequests.includes("corps"), "Un séparateur en tête d’un fragment masque la phrase de Cadence ou Tic IA");
	const reportWithRule = await buildStatisticsReport(bodyRule, () => "nom", new Map());
	const reportWithoutRule = await buildStatisticsReport(bodyRule.replace("---\n", ""), () => "nom", new Map());
	assert.equal(reportWithRule.match(/\nsentence_count: (\d+)\n/)?.[1], reportWithoutRule.match(/\nsentence_count: (\d+)\n/)?.[1], "Un séparateur du corps fait disparaître une phrase des statistiques");
	const unicodeTags = "😀 #école/test #e\u0301cole #40Mo #🌿/été #123";
	const unicodeMasked = maskMarkdownExclusions(unicodeTags);
	assert.equal(unicodeMasked.length, unicodeTags.length);
	assert.ok(unicodeMasked.includes("#123") && !unicodeMasked.includes("école") && !unicodeMasked.includes("🌿"));
	const apply = (text: string, revised: string) => {
		for (const group of protectLinks(text).diff(revised).reverse()) text = text.slice(0, group.delFrom) + (group.insText ?? "") + text.slice(group.delTo);
		return text;
	};
	const guarded = protectLinks(source);
	assert.ok(!guarded.text.includes("secret") && !guarded.text.includes("cachée"));
	const crossingLink = "---\ntitle: [secret\n---\nCorps](https://x.test)";
	assert.equal(protectLinks(crossingLink).text, "Corps", "Un libellé de lien réintroduit du YAML dans la requête IA");
	assert.equal(protectLinks(crossingLink, 5, crossingLink.indexOf("Corps")).text, "", "Une sélection YAML réintroduit le début d’un lien multilignes");
	assert.equal(apply(source, guarded.text.replaceAll("fote", "faute")), source.replaceAll("fote", "faute"), "Une correction IA déplace ou modifie les métadonnées");
	const tagStart = source.indexOf("#cachée");
	assert.equal(protectLinks(source, tagStart + 2, tagStart + 5).text, "");
	assert.equal(maskMarkdownExclusions(source).slice(0, 15).trim(), "", "Une limite de longueur expose du YAML tronqué");
	assert.equal(maskMarkdownExclusions(source).slice(tagStart + 2, tagStart + 5).trim(), "");
	for (const [text, limit] of [["---\ntitle: secret\n---\nCorps.", 12], ["#123/été suite", 4], ["#123/🌿 suite", 4], ["#123🌿 suite", 4], ["#123/🌿 suite", 5], ["#école/été suite", 8]] as const) {
		assert.equal(maskMarkdownExclusions(text.slice(0, limit + 3)).slice(0, limit), maskMarkdownExclusions(text).slice(0, limit), "Le préfixe borné expose du YAML ou un tag coupé");
	}
	let calls = 0;
	const engine = { async parse() { calls++; return []; } };
	assert.deepEqual(Array.from(await analyzeCorrections(engine, source, 5, 15)), []);
	assert.equal(calls, 0, "Une sélection YAML appelle le correcteur");
	await analyzeCorrections(engine, source, tagStart + 2, tagStart + 5);
	await analyzeCorrections(engine, "---\ntitle: secret", 0, 0);
	assert.equal(calls, 0, "Du YAML non fermé ou un tag partiel appelle le correcteur");
	const error = (nStart: number, nEnd: number): GrammalecteError => ({ nStart, nEnd, sMessage: "Faute", aSuggestions: ["faute"], sRuleId: "check", sType: "orthographe" });
	const from = source.indexOf("Une"), to = source.length;
	let partial: GrammalecteError[] = [];
	const corrected = await analyzeCorrections({ async parse(text, onPartial) {
		assert.equal(text, maskMarkdownExclusions(source).slice(from, to));
		assert.ok(!text.includes("cachée"));
		const errors = [error(4, 8), error(tagStart - from + 2, tagStart - from + 5), error(tagStart - from, tagStart - from)];
		onPartial?.(errors);
		return errors;
	} }, source, from, to, errors => { partial = errors; });
	assert.deepEqual(Array.from(corrected, item => [item.nStart, item.nEnd]), [[from + 4, from + 8]], "Les corrections perdent leurs positions ou traversent un tag");
	assert.deepEqual(partial, corrected, "Les résultats partiels exposent une correction protégée");
	for (const text of ["", "\0", "---\n\0#école\n", "#🌿/🌿", "x".repeat(10000), "\u202e#école\0"]) {
		assert.equal(maskMarkdownExclusions(text).length, text.length);
		for (const [start, end] of markdownExclusionRanges(text)) assert.ok(start >= 0 && end >= start && end <= text.length);
	}
}
