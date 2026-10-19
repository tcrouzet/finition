import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build as bundleWorker, transform } from "esbuild";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";

export const rawAssets = {
	name: "raw-assets",
	setup(build) {
		build.onResolve({ filter: /\?gzip$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -5)), namespace: "gzip" }));
		build.onLoad({ filter: /.*/, namespace: "gzip" }, async args => {
			const source = await readFile(args.path, "utf8");
			const json = args.path.endsWith("/gc_rules_graph.js") ? runInNewContext(`${source}\nJSON.stringify(gc_rules_graph)`) : JSON.stringify(JSON.parse(source));
			return { contents: gzipSync(json, { level: 9 }), loader: "binary", watchFiles: [args.path] };
		});
		build.onResolve({ filter: /\?worker$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -7)), namespace: "worker" }));
		build.onLoad({ filter: /.*/, namespace: "worker" }, async args => {
			const result = await bundleWorker({ entryPoints: [args.path], bundle: true, write: false, format: "iife", platform: "browser", target: "es2020", minify: true, metafile: true, plugins: [rawAssets] });
			return { contents: result.outputFiles[0].text, loader: "text", watchFiles: Object.keys(result.metafile.inputs).map(path => resolve(path.replace(/^raw:/, ""))) };
		});
		build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "raw" }));
		build.onLoad({ filter: /.*/, namespace: "raw" }, async args => {
			let source = await readFile(args.path, "utf8");
			// Le Worker utilise uniquement la version navigateur de Grammalecte.
			if (args.path.endsWith("/grammalecte/helpers.js")) source = (await transform(source, { define: { process: "undefined" }, minifySyntax: true })).code;
			if (args.path.endsWith("/gc_rules_graph.js")) {
				const start = source.indexOf("var gc_rules_graph =");
				if (start < 0) throw new Error("Format des données Grammalecte incompatible.");
				source = source.slice(0, start) + "var gc_rules_graph = {};";
			}
			return { contents: source, loader: "text", watchFiles: [args.path] };
		});
	},
};
