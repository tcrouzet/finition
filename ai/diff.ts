/**
 * Diff mot-à-mot entre un tronçon original et sa version révisée par l'IA,
 * regroupé en "suggestions" (DiffGroup) exprimées en positions DANS LE
 * TEXTE ORIGINAL uniquement — puisque le document n'est jamais réécrit
 * automatiquement, seul l'original a des coordonnées stables tant que
 * l'utilisateur n'a rien validé.
 *
 * Une suggestion peut être :
 * - une substitution (delText + insText tous deux non vides)
 * - une suppression proposée (insText === null)
 * - un ajout proposé (delFrom === delTo, pas de texte original concerné)
 */

export interface DiffGroup {
	delFrom: number; // offset de début dans le texte original (du tronçon)
	delTo: number; // offset de fin (exclusif) dans le texte original
	delText: string;
	insText: string | null;
}

type DiffOp = { op: "equal" | "del" | "ins"; text: string };

function tokenize(text: string): string[] {
	return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/**
 * Normalise un token pour la COMPARAISON uniquement (jamais pour
 * l'affichage ni l'insertion) : apostrophes droites/typographiques et
 * espaces normales/insécables sont considérées équivalentes. Par
 * expérience les IA ne respectent pas fidèlement la typographie française
 * sur ces deux points précis ; le texte source fait toujours foi, donc ces
 * différences ne doivent jamais générer de suggestion — elles sont traitées
 * comme un "equal", qui conserve le texte d'origine tel quel.
 */
function normalizeForComparison(token: string): string {
	return token.replace(/[''‘’]/g, "'").replace(/[\u00A0\u202F]/g, " ");
}

/** Diff mot-à-mot (LCS classique) entre deux textes déjà tokenisés. */
function wordDiff(original: string, revised: string): DiffOp[] {
	const a = tokenize(original);
	const b = tokenize(revised);
	const an = a.map(normalizeForComparison);
	const bn = b.map(normalizeForComparison);
	const n = a.length;
	const m = b.length;

	// Garde-fou perf : au-delà, la table LCS deviendrait trop grosse ;
	// on retombe sur un remplacement en bloc (toujours correct, juste
	// moins fin visuellement).
	if (n * m > 4_000_000) {
		return [
			{ op: "del", text: original },
			{ op: "ins", text: revised },
		];
	}

	const dp = Array.from<Uint32Array>({ length: n + 1 });
	for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = an[i] === bn[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (an[i] === bn[j]) {
			// Equal : on garde le token du texte ORIGINAL (a[i]), jamais celui
			// de l'IA, même si leur typographie diffère légèrement (apostrophe,
			// espace insécable) — le document source a toujours raison dessus.
			ops.push({ op: "equal", text: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ op: "del", text: a[i] });
			i++;
		} else {
			ops.push({ op: "ins", text: b[j] });
			j++;
		}
	}
	while (i < n) ops.push({ op: "del", text: a[i++] });
	while (j < m) ops.push({ op: "ins", text: b[j++] });

	// Fusionne les tokens consécutifs de même type (évite une suggestion
	// par mot isolé quand plusieurs mots à la suite changent).
	const merged: DiffOp[] = [];
	for (const o of ops) {
		const last = merged[merged.length - 1];
		if (last && last.op === o.op) last.text += o.text;
		else merged.push({ ...o });
	}
	return merged;
}

/**
 * Calcule les suggestions de correction entre `original` et `revised`,
 * avec leurs positions dans `original`. `equal` fait avancer le curseur
 * sans générer de suggestion ; une suite ininterrompue de `del`/`ins`
 * (sans `equal` entre les deux) forme une seule suggestion groupée.
 */
export function diffToGroups(original: string, revised: string): DiffGroup[] {
	const ops = wordDiff(original, revised);
	const groups: DiffGroup[] = [];
	let pos = 0;
	let i = 0;
	while (i < ops.length) {
		const op = ops[i];
		if (op.op === "equal") {
			pos += op.text.length;
			i++;
			continue;
		}
		const groupStart = pos;
		let delText = "";
		let insText = "";
		while (i < ops.length && ops[i].op !== "equal") {
			if (ops[i].op === "del") {
				delText += ops[i].text;
				pos += ops[i].text.length;
			} else {
				insText += ops[i].text;
			}
			i++;
		}
		groups.push({
			delFrom: groupStart,
			delTo: pos,
			delText,
			insText: insText.length > 0 ? insText : null,
		});
	}
	return groups;
}
