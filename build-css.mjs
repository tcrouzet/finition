// Concatène palette.css (couleurs, édité à la main par toi — jamais touché
// par l'agent) et styles.base.css (reste des styles, maintenu par l'agent)
// en styles.css, le seul fichier qu'Obsidian charge réellement.
// Ne modifie jamais styles.css à la main : il est régénéré à chaque build.
import { readFileSync, writeFileSync } from "fs";

const palette = readFileSync("palette.css", "utf8");
const base = readFileSync("styles.base.css", "utf8");

const banner = "/* Fichier généré par build-css.mjs à partir de palette.css + styles.base.css. Ne pas éditer directement. */\n\n";

writeFileSync("styles.css", banner + palette + "\n" + base);
console.log("styles.css régénéré (palette.css + styles.base.css)");
