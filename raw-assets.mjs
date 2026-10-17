import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const rawAssets = {
	name: "raw-assets",
	setup(build) {
		build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "raw" }));
		build.onLoad({ filter: /.*/, namespace: "raw" }, async args => ({
			contents: await readFile(args.path, "utf8"), loader: "text", watchFiles: [args.path],
		}));
	},
};
