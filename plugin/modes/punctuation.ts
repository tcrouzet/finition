import { linkRanges, mergeRanges } from "../markdown-links";

/**
 * Correction automatique et déterministe des espaces insécables et des
 * tirets, selon le code typographique français. Appliquée instantanément
 * (pas de validation au cas par cas comme Ortho-typo IA : ce sont des
 * règles objectives, pas un jugement).
 *
 * Règles implémentées :
 * 1. Espace insécable AVANT ! ? : ; » (double ponctuation).
 * 2. Espace insécable APRÈS «, espace normale avant « (non touchée).
 * 3. Tiret de dialogue en début de ligne : normalisé en em dash (—) suivi
 *    d'une espace insécable. On ne touche QUE les lignes qui commencent déjà
 *    par un tiret (– ou —), jamais un simple "-", pour ne jamais casser une
 *    liste à puces Markdown ("- item").
 * 4. Tirets d'incise à l'intérieur du texte (en dash –) : la première
 *    moitié d'une paire reçoit une espace insécable APRÈS, la seconde une
 *    espace insécable AVANT — ex. "Il pleut – ça m'emmerde – mais je
 *    m'adapte." Le pairage se fait par ordre d'apparition, par paragraphe ;
 *    un tiret resté seul en fin de paragraphe n'est pas touché.
 * 5. Apostrophes droites (') remplacées par des apostrophes typographiques (’).
 * 6. Jamais plus de deux sauts de ligne consécutifs (un pour finir le
 *    paragraphe, un pour le séparer du suivant) — SAUF entre deux entrées
 *    d'une liste (-, *, +, ou numérotée), où un seul saut de ligne est
 *    conservé (pas de ligne vide entre les entrées).
 *
 * Les zones suivantes sont protégées (jamais modifiées) : blocs de code
 * (```...```), code inline (`...`), liens Markdown [texte](url), liens
 * wiki [[note]], URLs, et horaires (10:30). Les blocs de code étant
 * remplacés par un jeton sans saut de ligne pendant la protection, leurs
 * lignes vides internes (significatives en code) ne sont jamais touchées
 * par la règle 6.
 */

// Les blocs de code doivent avoir leurs balises ``` SEULES en début de ligne
// (syntaxe Markdown standard) — sinon un simple ``` oublié quelque part dans
// la note pouvait apparier avec un ``` sans rapport bien plus loin, et
// avaler plusieurs paragraphes (et leurs sauts de ligne) comme "protégés",
// jamais corrigés par erreur.
const PROTECT_RE = /^[ \t]*```.*$[\s\S]*?^[ \t]*```[ \t]*$|`[^`\n]*`|\b\d{1,2}:\d{2}(?::\d{2})?\b/gm;

export function protectSpans(text: string): { text: string; restore: (s: string) => string } {
	const ranges = mergeRanges([...linkRanges(text), ...[...text.matchAll(PROTECT_RE)].map(match => [match.index, match.index + match[0].length] as const)]);
	const stash: string[] = [];
	let prefix = "\uE000";
	while (text.includes(prefix)) prefix += "\uE000";
	let protectedText = "", cursor = 0;
	for (const [from, to] of ranges) {
		protectedText += text.slice(cursor, from) + `${prefix}${stash.length}\uE001`;
		stash.push(text.slice(from, to));
		cursor = to;
	}
	protectedText += text.slice(cursor);
	return { text: protectedText, restore: value => value.replace(new RegExp(`${prefix}(\\d+)\uE001`, "g"), (match, index: string) => stash[Number(index)] ?? match) };
}

function fixGuillemets(text: string): string {
	// « suivi d'une espace insécable, quel que soit ce qu'il y avait avant
	// (espace normale, insécable, ou rien). L'espace AVANT « n'est pas touchée.
	return text.replace(/«[\u00A0\u202F \t]*/g, "«\u00A0");
}

function fixDoublePunctuation(text: string): string {
	// Consomme toute espace existante (normale ou insécable) avant le signe
	// et la remplace par une seule espace insécable — idempotent.
	return text.replace(/[\u00A0\u202F \t]*([!?:;»])/g, "\u00A0$1");
}

function fixLineStartDashes(text: string): string {
	// Uniquement si la ligne commence déjà par un tiret moyen/long (– ou —) :
	// un simple "-" est laissé intact pour ne pas casser les listes Markdown.
	return text.replace(/^[ \t]*[–—][\u00A0\u202F \t]*/gm, "—\u00A0");
}

function fixInciseDashesInParagraph(paragraph: string): string {
	const DASH_RE = /[\u00A0\u202F \t]*–[\u00A0\u202F \t]*/g;
	const matches: RegExpExecArray[] = [];
	let m: RegExpExecArray | null;
	while ((m = DASH_RE.exec(paragraph)) !== null) matches.push(m);

	let result = "";
	let cursor = 0;
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		result += paragraph.slice(cursor, match.index);
		if (i % 2 === 0 && i + 1 < matches.length) {
			result += " –\u00A0"; // ouvrant : espace normale avant, insécable après
		} else if (i % 2 === 1) {
			result += "\u00A0– "; // fermant : espace insécable avant, normale après
		} else {
			result += match[0]; // tiret isolé en fin de paragraphe : on ne touche pas
		}
		cursor = match.index + match[0].length;
	}
	result += paragraph.slice(cursor);
	return result;
}

function fixInciseDashes(text: string): string {
	// Découpage par paragraphe (ligne vide) : le pairage des tirets d'incise
	// ne doit pas traverser les paragraphes.
	const parts = text.split(/(\n[ \t]*\n+)/);
	return parts.map((part, i) => (i % 2 === 1 ? part : fixInciseDashesInParagraph(part))).join("");
}

function fixApostrophes(text: string): string {
	return text.replace(/'/g, "’");
}

const LIST_ITEM_START_RE = /[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * Règle structurelle (sauts de ligne entre paragraphes) : appliquée à part,
 * sur le DOCUMENT ENTIER plutôt que sur la sélection (voir main.ts). Une
 * sélection de texte ne contient presque jamais les sauts de ligne qui
 * suivent un paragraphe, donc cette règle n'aurait aucun effet si elle
 * restait cantonnée à fixPunctuationSpacing comme les autres.
 */
export function fixBlankLines(text: string): string {
	// D'abord : une ligne "blanche" qui contient en fait des espaces, des
	// tabulations ou des espaces insécables résiduelles (invisibles à
	// l'œil, souvent issues d'un copier-coller) est vidée complètement —
	// une ligne vide doit être réellement vide (0 caractère). Sans cette
	// étape, une seule ligne "presque vide" entre deux paragraphes ne
	// déclenche jamais la règle suivante (qui ne réagit qu'à partir de 2
	// lignes vides consécutives), et reste donc jamais nettoyée.
	let result = text.replace(/^[ \t\u00A0]+$/gm, "");
	// Jamais plus de deux sauts de ligne consécutifs (= au plus une ligne
	// vide entre deux paragraphes).
	result = result.replace(/\n{3,}/g, "\n\n");
	// Entre deux entrées de liste séparées par une ou plusieurs lignes
	// vides, on les retire : une liste n'a qu'un saut de ligne entre ses
	// entrées. Le lookahead (non consommé) permet d'enchaîner plusieurs
	// entrées de suite en un seul passage.
	const betweenListItems = new RegExp(`^(${LIST_ITEM_START_RE.source}.*)\\n\\n+(?=${LIST_ITEM_START_RE.source})`, "gm");
	result = result.replace(betweenListItems, "$1\n");
	return result;
}

/** Règles de ponctuation inline (espaces, tirets, apostrophes), sur le texte passé tel quel (typiquement une sélection). */
export function fixPunctuationSpacing(text: string): string {
	const { text: protectedText, restore } = protectSpans(text);
	let result = protectedText;
	result = fixGuillemets(result);
	result = fixDoublePunctuation(result);
	result = fixLineStartDashes(result);
	result = fixInciseDashes(result);
	result = fixApostrophes(result);
	return restore(result);
}

/** fixBlankLines, mais avec la même protection (blocs de code...) que fixPunctuationSpacing. */
export function fixBlankLinesProtected(text: string): string {
	const { text: protectedText, restore } = protectSpans(text);
	return restore(fixBlankLines(protectedText));
}
