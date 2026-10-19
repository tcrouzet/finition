import { Lexicon } from "../plugin/modes/finition-corrector/lexicon";
import type { LexemeRow } from "../plugin/modes/finition-corrector/lexicon";
import { buildNeuralAlternatives } from "../plugin/modes/finition-corrector/confusions";

function referenceDistance(left: string, right: string): number {
	const rows = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1));
	for (let i = 0; i <= left.length; i++) rows[i][0] = i;
	for (let j = 0; j <= right.length; j++) rows[0][j] = j;
	for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
		rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(left[i - 1] !== right[j - 1]));
		if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
	}
	return rows[left.length][right.length];
}

export function checkDictionaryCore(): void {
	const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
	const dictionary = new Lexicon([
		["marche", "marche", "nom", "f", "s", "", 1],
		["marche", "marcher", "verbe", "", "s", "ind:pre:3s", 2],
	], ["Thierry", "São Paulo"]);
	check(dictionary.lookup("marche").length === 2 && dictionary.forms("marcher")[0].category === "verbe", "Analyses ambiguës ou familles perdues");
	dictionary.lookup("marche")[0].lemma = "altéré";
	check(dictionary.lookup("marche")[0].lemma === "marche", "Analyse partagée mutable");
	check(dictionary.has("Thierry") && dictionary.has("THIERRY") && !dictionary.has("thierry") && dictionary.lookup("Thierry").length === 0, "Casse ou métadonnées inventées");
	check(dictionary.has("Sa\u0303o Paulo") && dictionary.phraseLengths("São").includes(2), "Nom composé ou normalisation perdus");
	let rejected = false;
	try { new Lexicon([["mot", "lemme", "nom", "m", "s", "", NaN]]); } catch { rejected = true; }
	check(rejected, "Entrée lexicale invalide acceptée");
	const forms: LexemeRow[] = Array.from({ length: 256 }, (_, value) => {
		const form = "a" + value.toString(4).replace(/0/g, "a").replace(/1/g, "b").replace(/2/g, "c").replace(/3/g, "d");
		return [form, form, "nom", "m", "s", "", value];
	});
	const lexicon = new Lexicon(forms);
	for (const source of forms.filter((_, index) => index % 7 === 0)) {
		const query = source[0].slice(0, -1) + "z";
		const expected = forms.map(row => ({ form: row[0], cost: referenceDistance(query, row[0]), frequency: row[6] })).filter(item => item.cost <= 2).sort((a, b) => a.cost - b.cost || b.frequency - a.frequency).slice(0, 5).map(item => item.form);
		check(JSON.stringify(lexicon.suggest(query)) === JSON.stringify(expected), `Suggestions bornées incorrectes : ${query}`);
	}
	check(new Lexicon([["chat", "chat", "nom", "m", "s", "", 1]]).suggest("caht").includes("chat"), "Transposition non reconnue");
	const morphology = new Lexicon([
		["amies", "ami", "nom", "f", "p", "", 1], ["amis", "ami", "nom", "m", "p", "", 1],
		["sur", "sur", "préposition", "", "", "", 2], ["sur", "sur", "adjectif", "m", "s", "", 1], ["sure", "sur", "adjectif", "f", "s", "", 1],
		["plaine", "plaine", "nom", "f", "s", "", 1], ["plaines", "plaine", "nom", "f", "p", "", 1],
		["pleine", "plein", "adjectif", "f", "s", "", 1], ["pleines", "plein", "adjectif", "f", "p", "", 1],
		["pleine", "pleine", "adverbe", "", "", "", 0],
	]);
	const alternatives = buildNeuralAlternatives([["amies", "amis"], ["sur", "sure"], ["plaine", "plaines", "pleine", "pleines"]], word => morphology.lookup(word));
	check(!alternatives.amies && !alternatives.sur, "Le modèle doit préserver les flexions et les mots grammaticaux");
	check(JSON.stringify(alternatives.plaine) === JSON.stringify(["plaine", "pleine"]), "Confusion lexicale perdue ou nombre modifié");
	check(alternatives.a.includes("à") && !alternatives.ou, "Répartition des familles entre modèles invalide");
	const lexical = buildNeuralAlternatives([], () => [], false);
	check(lexical.ou.includes("où") && lexical.et.includes("est") && !lexical.ces, "Homophones sans modèle spécialisé absents ou référent imposé");
	rejected = false;
	try { buildNeuralAlternatives([[null]], () => []); } catch { rejected = true; }
	check(rejected, "Groupe phonétique invalide accepté");
}
