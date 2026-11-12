import * as assert from "node:assert/strict";
import type * as Formes from "../plugin/modes/formes";
import type * as Types from "../plugin/types";

export function checkForms(api: typeof Formes & Pick<typeof Types, "DEFAULT_SETTINGS" | "FORM_TYPES">): void {
	for (const text of ["Je ne viens pas.", "Il n’est plus là.", "Nous ne partons jamais.", "Elle ne dit rien.", "Personne ne vient.", "Aucune porte ne ferme.", "Je ne vois ni chat ni chien.", "Il ne sait guère parler.", "Pas de curé."]) {
		assert.equal(api.hasNegation(text), true, text);
		assert.equal(api.computeFormHighlights(text, api.DEFAULT_SETTINGS)[0]?.title, "Négatives", text);
	}
	for (const text of ["Il fait un pas.", "La personne vient.", "C’est plus beau.", "Je n’ai que trois jours.", "Je crains qu’il ne vienne.", "Il ne fait qu’un pas.", "La personne que je ne connais pas vient."]) {
		assert.equal(api.hasNegation(text), text.includes("connais pas"), text);
	}
	const sentences = ["😀 Je ne viens pas.", "Viens-tu ?", "Quelle joie !", "Attends...", "Peut-être…", "Ne viens-tu pas ?!"];
	const text = "Introduction. " + sentences.join(" ");
	const settings = { ...api.DEFAULT_SETTINGS, formNegativeColorIndex: 1, formQuestionColorIndex: 4, formExclamationColorIndex: 7, formEllipsisColorIndex: 10 };
	const highlights = api.computeFormHighlights(text, settings);
	assert.deepEqual(Array.from(highlights, mark => text.slice(mark.from, mark.to)), sentences);
	assert.deepEqual(Array.from(highlights, mark => mark.colorIndex), [1, 4, 7, 10, 10, 4]);
	assert.equal(highlights.at(-1)?.title, "Négatives · Interrogatives · Exclamatives");
	assert.equal(highlights[1].lemma, highlights[5].lemma, "Les interrogatives simples et négatives doivent partager la même catégorie de navigation");
	assert.equal(new Set(api.FORM_TYPES.map(type => api.DEFAULT_SETTINGS[type.key])).size, 4);
	assert.equal(api.computeFormHighlights("", settings).length, 0);
	const markdown = "---\ntitle: Pourquoi ?\n---\n\n# Un titre !\n\n```js\nalert('Ne pas !...');\n```\n\n~~~\nPourquoi ?\n~~~\n\n`Ne viens pas !`\n\n[Pourquoi ?](https://exemple.fr/a...)\n\n[[Note !]]\n\nhttps://exemple.fr/?a=1!\n\n[ref]: https://exemple.fr/?x=1\n\nVraiment ?";
	const protectedHighlights = api.computeFormHighlights(markdown, settings);
	assert.deepEqual(Array.from(protectedHighlights, mark => markdown.slice(mark.from, mark.to)), ["Vraiment ?"]);
	process.stdout.write("Formes : négations, contre-exemples, couleurs, cumul, Unicode et Markdown vérifiés\n");
}
