import { isLexemeRow, type LexemeRow } from "../modes/finition-corrector/lexicon";

export const dictionaryFile = "finition-dictionnaire.json";
export const personalDictionaryFile = "finition-personnel.json";
export const personalDictionaryPath = `Antidote/dictionnaires/${personalDictionaryFile}`;
export type Orthography = "fr-classic" | "fr-reform";
export interface SharedDictionary {
	entries: LexemeRow[];
	forms: string[];
	grammalecte?: Record<Orthography, Record<string, unknown>>;
	variants?: Array<[string, number]>;
	extras?: Array<[string, string[]]>;
	lemmaOverrides?: Array<[string, string]>;
}

async function inflate(payload: string, limit: number): Promise<unknown> {
	const binary = atob(payload);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
	if (!Number.isFinite(limit)) return JSON.parse(await new Response(stream).text()) as unknown;
	let size = 0;
	const limited = stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
		size += chunk.byteLength;
		if (size > limit) throw new Error("Bloc lexical décompressé trop volumineux.");
		controller.enqueue(chunk);
	} }));
	return JSON.parse(await new Response(limited).text()) as unknown;
}

export const isSharedDictionary = (value: unknown): boolean => Boolean(value && typeof value === "object"
	&& ("format" in value ? value.format === "finition-dictionnaire" : "name" in value && value.name === "finition-dictionnaire"));

export async function decodeDictionary(value: unknown, mode: "all" | "grammalecte" | "neural" = "all", blockLimit = Infinity): Promise<SharedDictionary> {
	if (!value || typeof value !== "object" || !isSharedDictionary(value)
		|| !("version" in value) || (value.version !== 1 && value.version !== 2)
		|| !("encoding" in value) || value.encoding !== "gzip-base64" || !("payload" in value) || typeof value.payload !== "string") throw new Error("Format du dictionnaire invalide.");
	let decoded: unknown;
	if (value.version === 1) decoded = await inflate(value.payload, blockLimit);
	else {
		if (!("grammalectePayload" in value) || typeof value.grammalectePayload !== "string") throw new Error("Index commun absent.");
		const lexical: unknown = mode === "grammalecte" ? { entries: [] } : await inflate(value.payload, blockLimit);
		const grammar: unknown = mode === "neural" ? {} : await inflate(value.grammalectePayload, blockLimit);
		if (!lexical || typeof lexical !== "object" || !grammar || typeof grammar !== "object") throw new Error("Contenu du dictionnaire invalide.");
		decoded = { ...lexical, ...grammar };
	}
	const legacy: unknown[] = Array.isArray(decoded) ? decoded : [];
	const data: unknown = value.version === 1 ? { entries: legacy[0], forms: legacy[1] } : decoded;
	if (!data || typeof data !== "object" || !("entries" in data) || !Array.isArray(data.entries) || !data.entries.every(isLexemeRow)
		|| !("forms" in data) || !Array.isArray(data.forms) || !data.forms.every((form: unknown) => typeof form === "string" && form.length > 0)) throw new Error("Contenu du dictionnaire invalide.");
	if (value.version === 2 && (!("variants" in data) || !Array.isArray(data.variants) || !data.variants.every((row: unknown) => Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && (row[1] === 1 || row[1] === 2)))) throw new Error("Variantes orthographiques invalides.");
	if ("lemmaOverrides" in data && (!Array.isArray(data.lemmaOverrides) || !data.lemmaOverrides.every((row: unknown) => Array.isArray(row) && row.length === 2 && row.every((word: unknown) => typeof word === "string" && word.length > 0 && word === word.toLowerCase())))) throw new Error("Lemmes de répétition invalides.");
	if (value.version === 2 && mode !== "neural") {
		if (!("grammalecte" in data) || !data.grammalecte || typeof data.grammalecte !== "object"
			|| !("variants" in data) || !Array.isArray(data.variants)
			|| !data.variants.every((row: unknown) => Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && (row[1] === 1 || row[1] === 2))
			|| !("extras" in data) || !Array.isArray(data.extras)
			|| !data.extras.every((row: unknown) => Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && Array.isArray(row[1]) && row[1].every((morph: unknown) => typeof morph === "string"))) throw new Error("Index commun invalide.");
		for (const variant of ["fr-classic", "fr-reform"] as const) {
			const index: unknown = (data.grammalecte as Record<string, unknown>)[variant];
			if (!index || typeof index !== "object" || !("sHeader" in index) || index.sHeader !== "/grammalecte-fsa/"
				|| !("lByDic" in index) || !Array.isArray(index.lByDic) || !index.lByDic.length
				|| !("lArcVal" in index) || !Array.isArray(index.lArcVal) || !index.lArcVal.every((tag: unknown) => typeof tag === "string")
				|| !("dChar" in index) || !index.dChar || typeof index.dChar !== "object") throw new Error("Index Grammalecte invalide.");
		}
	}
	return data as SharedDictionary;
}

export async function readPersonalForms(read: () => Promise<ArrayBuffer>): Promise<string[]> {
	const value: unknown = JSON.parse(new TextDecoder().decode(await read()));
	if (!value || typeof value !== "object" || !("format" in value) || value.format !== "finition-personal-forms" || !("version" in value) || value.version !== 1
		|| !("forms" in value) || !Array.isArray(value.forms) || !value.forms.every((form: unknown) => typeof form === "string" && form.length > 0)) throw new Error("Complément lexical personnel invalide.");
	return value.forms as string[];
}
