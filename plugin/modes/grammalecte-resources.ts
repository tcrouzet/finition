import helpers from "../vendor/grammalecte/helpers.js?raw";
import strTransform from "../vendor/grammalecte/str_transform.js?raw";
import charPlayer from "../vendor/grammalecte/char_player.js?raw";
import lexgraph from "../vendor/grammalecte/lexgraph_fr.js?raw";
import ibdawg from "../vendor/grammalecte/ibdawg.js?raw";
import spellchecker from "../vendor/grammalecte/spellchecker.js?raw";
import text from "../vendor/grammalecte/text.js?raw";
import tokenizer from "../vendor/grammalecte/tokenizer.js?raw";
import conj from "../vendor/grammalecte/conj.js?raw";
import mfsp from "../vendor/grammalecte/mfsp.js?raw";
import phonet from "../vendor/grammalecte/phonet.js?raw";
import thesaurus from "../vendor/grammalecte/thesaurus.js?raw";
import cregex from "../vendor/grammalecte/cregex.js?raw";
import options from "../vendor/grammalecte/gc_options.js?raw";
import functions from "../vendor/grammalecte/gc_functions.js?raw";
import rules from "../vendor/grammalecte/gc_rules.js?raw";
import graph from "../vendor/grammalecte/gc_rules_graph.js?raw";
import engine from "../vendor/grammalecte/gc_engine.js?raw";
import driver from "./grammalecte-driver.ts?worker";

// L’ordre conserve les dépendances globales du moteur Grammalecte.
export const engineScripts = [helpers, strTransform, charPlayer, lexgraph, ibdawg, spellchecker, text, tokenizer, conj, mfsp, phonet, thesaurus, cregex, options, functions, rules, graph, engine, driver];
