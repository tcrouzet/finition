// Déclaration ambiante : esbuild (loader: { ".md": "text" }) inline le
// contenu d'un fichier .md comme chaîne de caractères (export default). Sans
// ce fichier, TypeScript ne reconnaît pas `import x from "./foo.md"`.
declare module "*.md" {
	const content: string;
	export default content;
}
