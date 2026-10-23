import { sentenceRanges, trimRange } from "./clause-split";
import { analyzeSentenceStructure, tricolonMembership, type GetCategory } from "./structure-signature";
import { markdownExclusionRanges, maskMarkdownExclusions } from "../markdown-tags";

// Identifiants de la section « Données brutes » de stats-notes.md (Unshiter).
export const rawStatisticNames = [
	"word_count",
	"lexical_word_count",
	"distinct_form_count",
	"morphalou_recognized_count",
	"sentence_count",
	"paragraph_count",
	"document_char_count",
	"utf8_byte_count",
	"gzip_byte_count",
	"syllable_count",
	"relative_clause_count",
	"subordinate_clause_count",
	"nominal_sentence_count",
	"common_noun_count",
	"abstract_noun_count",
	"proper_noun_count",
	"lemma_count",
	"unique_lemma_count",
	"hapax_count",
	"repetition_word_count",
	"local_repetition_count",
	"global_repetition_count",
	"absolute_repetition_count",
	"local_phonetic_repetition_count",
	"global_phonetic_repetition_count",
	"grammatical_verb_count",
	"grammatical_token_count",
	"function_word_count",
	"modal_generalization_count",
	"conjugue_verb_count",
	"adjective_count",
	"intensified_adjective_count",
	"adverb_count",
	"present_participe_count",
	"past_participe_count",
	"subjonctive_count",
	"negation_count",
	"verb_negation_count",
	"dialog_word_count",
	"familiarity_marker_count",
	"active_sentence_count",
	"passive_sentence_count",
	"methaphore_count",
	"concrate_noun_count",
	"active_verb_count",
	"verb_count",
	"narrative_verb_count",
	"narrative_past_count",
	"verb_present_count",
	"verb_imp_count",
	"verb_fut_count",
	"simple_past_count",
	"passe_compose_count",
	"va_count",
	"gnomic_present_count",
	"personal_subject_count",
	"classifiable_subject_count",
	"first_person_subject_count",
	"lexical_token_count",
	"tense_shift_count",
	"tense_transition_count",
	"summary_sentence_count",
	"negative_sentence_count",
	"exclamative_sentence_count",
	"analyzed_noun_count",
	"noun_modifier_count",
	"heavily_modified_noun_count",
	"adjective_chain_count",
	"adjective_in_chain_count",
	"incise_count",
	"coordination_accumulation_count",
	"burstiness_count",
	"period_count",
	"suspention_point_count",
	"comma_count",
	"colon_count",
	"exclamation_point_count",
	"question_mark_count",
	"semicolons_count",
	"dash_count",
	"parenthesis_count",
	"quote_mark_count",
	"temporal_connector_count",
	"logical_connector_count",
	"emotion_word_count",
	"emotion_sentence_count",
	"joy_emotion_count",
	"joy_intensified_emotion_count",
	"sadness_emotion_count",
	"sadness_intensified_emotion_count",
	"fear_emotion_count",
	"fear_intensified_emotion_count",
	"anger_emotion_count",
	"anger_intensified_emotion_count",
	"surprise_emotion_count",
	"surprise_intensified_emotion_count",
	"disgust_emotion_count",
	"disgust_intensified_emotion_count",
	"contempt_emotion_count",
	"contempt_intensified_emotion_count",
	"somatic_emotion_count",
	"somatic_intensified_emotion_count",
	"ternary_count",
	"mechanical_antithesis_count",
	"stereotype_count",
	"epistemic_hedging_count",
	"hapax_bigram_count",
	"bigram_count",
] as const;

type Statistics = Record<typeof rawStatisticNames[number], number | "-">;
export const statisticsWords = (text: string): string[] => (maskMarkdownExclusions(text).toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}_]+(?:'[\p{L}\p{N}_]+)?/gu) ?? []);
const frequencies = (values: string[]): Map<string, number> => {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return counts;
};

export async function buildStatisticsReport(source: string, getCategory: GetCategory, lexicon: Map<string, string>): Promise<string> {
	const stats = Object.fromEntries(rawStatisticNames.map(name => [name, "-"])) as Statistics;
	const exclusions = markdownExclusionRanges(source);
	const normalize = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\.{3,}/g, "…").replace(/\n{3,}/g, "\n\n");
	const text = normalize(maskMarkdownExclusions(source, exclusions));
	for (const [from, to] of [...exclusions].reverse()) source = source.slice(0, from) + source.slice(to);
	const measuredText = normalize(source);
	const words = statisticsWords(text);
	const paragraphs = text.split(/\n\s*\n/).filter(paragraph => paragraph.trim());
	const lemma = (word: string) => lexicon.get(word) ?? word;
	const isFunction = (word: string) => word.length <= 1 || ["ne", "pas", "te"].includes(word)
		|| ["être", "avoir"].includes(lemma(word))
		|| ["déterminant", "pronom", "préposition", "conjonction", "interjection"].includes(getCategory(word).split("|")[0]);
	const lexicalWords = words.filter(word => !isFunction(word));
	const lemmas = lexicalWords.map(lemma);
	const lemmaCounts = frequencies(lemmas);
	const repetitionWords = statisticsWords(text.replace(/['’]/g, " ")).filter(word => [...word].length >= 2);
	const repetitions = (values: string[]) => {
		const seen = new Set<string>();
		let count = 0;
		for (const word of values) {
			if (isFunction(word)) continue;
			const key = lemma(word);
			if (seen.has(key)) count++;
			seen.add(key);
		}
		return count;
	};
	stats.word_count = words.length;
	stats.lexical_word_count = lexicalWords.length;
	stats.distinct_form_count = new Set(words).size;
	stats.function_word_count = words.length - lexicalWords.length;
	stats.lemma_count = lemmas.length;
	stats.unique_lemma_count = lemmaCounts.size;
	stats.hapax_count = [...lemmaCounts.values()].filter(count => count === 1).length;
	stats.morphalou_recognized_count = lexicalWords.filter(word => lexicon.has(word)).length;
	stats.repetition_word_count = repetitionWords.length;
	stats.global_repetition_count = repetitions(repetitionWords);
	stats.local_repetition_count = 0;
	for (let index = 0; index < repetitionWords.length; index += 1000) stats.local_repetition_count += repetitions(repetitionWords.slice(index, index + 1000));
	stats.absolute_repetition_count = repetitionWords.length - new Set(repetitionWords.map(lemma)).size;
	const allLemmas = words.map(lemma);
	const bigrams = frequencies(allLemmas.slice(1).map((value, index) => JSON.stringify([allLemmas[index], value])));
	stats.bigram_count = bigrams.size;
	stats.hapax_bigram_count = [...bigrams.values()].filter(count => count === 1).length;
	stats.paragraph_count = paragraphs.length;
	stats.document_char_count = [...measuredText].length;
	const bytes = new TextEncoder().encode(measuredText);
	stats.utf8_byte_count = bytes.length;
	if (!bytes.length) stats.gzip_byte_count = 0;
	else if (typeof CompressionStream !== "undefined") {
		const gzip = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
		stats.gzip_byte_count = (await new Response(gzip).arrayBuffer()).byteLength;
	}
	stats.syllable_count = words.reduce((sum, word) => sum + Math.max(1, (word.match(/[aeiouyàâäéèêëîïôöùûüÿœ]+/g) ?? []).length), 0);
	const dialogue = paragraphs.filter(paragraph => /^\s*[–—]/.test(paragraph));
	stats.dialog_word_count = dialogue.reduce((sum, paragraph) => sum + statisticsWords(paragraph).length, 0);
	stats.exclamation_point_count = paragraphs.filter(paragraph => !/^\s*[–—]/.test(paragraph)).join("\n").split("!").length - 1;
	const punctuation = {
		period_count: /\./g, suspention_point_count: /…/g, comma_count: /,/g, colon_count: /:/g,
		question_mark_count: /\?/g, semicolons_count: /;/g, parenthesis_count: /\(/g, quote_mark_count: /[«»“”"]/g,
	} as const;
	for (const [name, pattern] of Object.entries(punctuation)) stats[name as keyof typeof punctuation] = (text.match(pattern) ?? []).length;
	stats.dash_count = (text.match(/[–—]/g) ?? []).length;
	stats.sentence_count = 0;
	stats.ternary_count = 0;
	for (const [start, end] of sentenceRanges(text)) {
		const [from, to] = trimRange(text, start, end);
		if (from >= to || /^#{1,6}[ \t]/.test(text.slice(from, to))) continue;
		stats.sentence_count++;
		if (/^[–—]/.test(text.slice(from, to))) stats.dash_count--;
		const analyses = analyzeSentenceStructure(text, from, to, getCategory);
		stats.ternary_count += new Set(tricolonMembership(analyses).filter(member => member !== null).map(member => member.groupId)).size;
	}
	return ["---", ...rawStatisticNames.map(name => `${name}: ${stats[name] === "-" ? '"-"' : stats[name]}`), "---", "",
		"# Statistiques", "",
		"Mesures brutes d’Unshiter, calculées localement sur le texte complet de la note. Normalisation : fins de ligne Unix, points de suspension unifiés et lignes vides successives réduites. Les caractères Markdown sont inclus dans les comptes textuels ; les titres sont exclus du découpage en phrases de Structure.", "",
		"Moteur : Grammalecte. Tricolons : même analyse que Structure. Lemmes : lexique Morphalou embarqué, avec repli sur la forme pour les mots inconnus. Mots-outils : catégories Grammalecte et exclusions d’Unshiter (ne, pas, te, être, avoir). Ces résultats peuvent différer de l’analyse contextuelle spaCy d’Unshiter. La taille gzip dépend du compresseur du navigateur (sans horodatage).", "",
		"La valeur \"-\" indique une mesure indisponible : la structure simplifiée ne fournit pas les dépendances, la désambiguïsation morphologique, les prononciations et tous les lexiques spécialisés nécessaires. Aucun score combiné n’est calculé.", "",
	].join("\n");
}
