import obsidianmd from 'eslint-plugin-obsidianmd';
import * as globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'plugin/esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'plugin/vendor/grammalecte/*.js',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', {
				brands: ['Finition', 'Grammalecte', 'CamemBERT', 'Claude', 'OpenAI', 'Anthropic'],
				acronyms: ['IA', 'API', 'JSON', 'GPT'],
			}],
		},
	},
	{
		// Ces outils de développement s’exécutent sous Node, hors du plugin.
		files: ['scripts/**/*.ts', 'plugin/raw-assets.mjs'],
		languageOptions: { globals: globals.node },
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
			'no-restricted-globals': 'off',
		},
	},
);
