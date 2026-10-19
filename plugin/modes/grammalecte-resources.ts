import helpers from "../data/grammalecte/helpers.js?raw";
import strTransform from "../data/grammalecte/str_transform.js?raw";
import charPlayer from "../data/grammalecte/char_player.js?raw";
import lexgraph from "../data/grammalecte/lexgraph_fr.js?raw";
import ibdawg from "../data/grammalecte/ibdawg.js?raw";
import spellchecker from "../data/grammalecte/spellchecker.js?raw";
import text from "../data/grammalecte/text.js?raw";
import tokenizer from "../data/grammalecte/tokenizer.js?raw";
import conj from "../data/grammalecte/conj.js?raw";
import mfsp from "../data/grammalecte/mfsp.js?raw";
import phonet from "../data/grammalecte/phonet.js?raw";
import thesaurus from "../data/grammalecte/thesaurus.js?raw";
import cregex from "../data/grammalecte/cregex.js?raw";
import options from "../data/grammalecte/gc_options.js?raw";
import functions from "../data/grammalecte/gc_functions.js?raw";
import rules from "../data/grammalecte/gc_rules.js?raw";
import graph from "../data/grammalecte/gc_rules_graph.js?raw";
import engine from "../data/grammalecte/gc_engine.js?raw";
import driver from "./grammalecte-driver.ts?worker";

// L’ordre conserve les dépendances globales du moteur Grammalecte.
export const engineScripts = [helpers, strTransform, charPlayer, lexgraph, ibdawg, spellchecker, text, tokenizer, conj, mfsp, phonet, thesaurus, cregex, options, functions, rules, graph, engine, driver];
