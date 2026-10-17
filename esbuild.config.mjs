import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { rawAssets } from "./raw-assets.mjs";

const banner = `/*
Plugin Obsidian "Finition". Build généré, ne pas éditer directement.
*/`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
	// Le prompt par défaut d'Ortho-typo IA (ai/prompt-revision.md) est
	// inliné comme texte dans main.js au build, exactement comme les
	// dictionnaires JSON : un seul fichier à distribuer, pas de fichier .md
	// à copier séparément pour l'utilisateur final.
	loader: { ".md": "text" },
	plugins: [rawAssets],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
