/**
 * Nettoyage typographique français appliqué au texte renvoyé par l'IA,
 * port direct de `Ia.clean()` (mode français uniquement) du pipeline
 * Python d'origine.
 */
export function cleanTypography(text: string): string {
	// Espace insécable avant : ; ! ? » (et suppression d'une espace normale
	// déjà présente avant ces signes).
	text = text.replace(/(?<!\s)([:;!?»])| (?=[:;!?»])/g, "\u00A0$1");
	// Espace insécable après «.
	text = text.replace(/«\s*/g, "«\u00A0");
	// Apostrophes typographiques.
	text = text.replace(/'/g, "’");
	text = text.replace(/https :\/\//g, "https://");
	// Caractères invisibles résiduels.
	text = text.replace(/\u200b/g, ""); // espace de largeur nulle
	text = text.replace(/\ufeff/g, ""); // BOM
	return text;
}
