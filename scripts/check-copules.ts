import * as assert from "node:assert/strict";
import copules from "../plugin/data/copules.json";
import type { SharedDictionary } from "../plugin/lexicon/shared";
import { buildCopuleLexicon, computeCopuleHighlights, emptyCopuleLexicon } from "../plugin/modes/copules";

export function checkCopules(dictionary: SharedDictionary): void {
	const lexicon = buildCopuleLexicon(dictionary);
	const { forms } = lexicon;
	for (const lemma of copules) assert.ok([...forms.values()].some(values => values.includes(lemma)), `Aucune flexion : ${lemma}`);
	for (const [form, lemma] of [["a", "avoir"], ["suis", "être"], ["furent", "être"], ["eûmes", "avoir"], ["sembleraient", "sembler"], ["parais", "paraître"], ["paraissait", "paraître"], ["deviendra", "devenir"], ["redevenus", "redevenir"], ["restèrent", "rester"], ["demeurions", "demeurer"], ["montrées", "se montrer"], ["révéleront", "se révéler"], ["appelleras", "s'appeler"], ["faites", "faire"], ["irons", "aller"]]) {
		assert.ok(forms.get(form)?.includes(lemma), `Flexion perdue ou masquée par un homographe : ${form}`);
	}
	const occurrences = (text: string) => computeCopuleHighlights(text, lexicon).map(mark => text.slice(mark.from, mark.to));
	for (const apostrophe of ["'", "’"]) {
		assert.deepEqual(occurrences(`😀 Il s${apostrophe}en va. Elle s${apostrophe}appelle Marie. Il s${apostrophe}avance.`), ["va", "appelle"], "Un pronom élidé est surligné comme une copule");
	}
	const elisions = buildCopuleLexicon({ forms: [], entries: ["s", "m", "t", "j", "n", "l", "c", "d", "qu"].map(form => [form, "avoir", "verbe", "", "", "ind:pre:3s", 0] as const) });
	assert.deepEqual(computeCopuleHighlights("s’avance, m’avance, t’avance, j’avance, n’avance, l’avance, c’avance, d’avance, qu’avance", elisions), [], "Le filtre doit exclure toutes les élisions, même mal classées dans le lexique");
	assert.deepEqual(occurrences("Nous avons connu la mer. J’ai un bateau. Je suis heureux. Nous sommes partis."), ["ai", "suis"], "Les auxiliaires avoir et être ne sont pas des copules");
	assert.deepEqual(occurrences("Nous n’avons jamais vraiment connu cela. Avons-nous déjà connu cela ? Il a souvent été heureux. Il a été vu."), ["été"]);
	assert.deepEqual(occurrences("J’ai un bateau connu de tous. Nous avons souvent un bateau. Je suis vraiment heureux. J’ai eu un bateau."), ["ai", "avons", "suis", "eu"]);
	assert.deepEqual(occurrences("J’ai **connu** la mer. J’ai\n\nconnu cet homme."), ["ai"], "La recherche de participe traverse un paragraphe");
	assert.deepEqual(occurrences("J’ai [un bateau](https://exemple.fr) connu de tous."), ["ai"], "La recherche de participe traverse un complément masqué");
	assert.deepEqual(occurrences("😀 Il a fait beau. Nous sommes restés et ils paraissaient tristes."), ["fait", "restés", "paraissaient"]);
	assert.deepEqual(occurrences("Je me suis montré, elles se sont montrées, tu t’appelleras Paul et elle se révélera."), ["montré", "montrées", "appelleras", "révélera"]);
	assert.deepEqual(occurrences("Il montre son livre. Elle révèle un secret. Ils appellent Paul. Il me montre. Elle te révèle son secret."), []);
	assert.deepEqual(occurrences("Est-il là ? Fais-le. Va-t’en. Montre-toi. Un va-et-vient."), ["Est", "Fais", "Va", "Montre"]);
	assert.deepEqual(occurrences("Je ne me suis jamais vraiment montré. Nous nous révélons. Il vous montre cela."), ["montré", "révélons"]);
	assert.deepEqual(occurrences("Nous ne nous sommes pas montrés. Je vais me montrer."), ["montrés", "vais", "montrer"]);
	assert.deepEqual(occurrences("# Il est là\n\n`Il est là` [Il est là](https://exemple.fr)\n\n```text\nIl est là.\n```\n\nElle devient calme."), ["devient"]);
	assert.deepEqual(occurrences(""), []);
	assert.deepEqual(computeCopuleHighlights("Il est là.", emptyCopuleLexicon()), []);
	process.stdout.write(`Copules : ${copules.length} entrées, ${forms.size} formes indexées ; flexions, pronominaux, inversions, Unicode et Markdown vérifiés\n`);
}
