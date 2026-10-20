"""Verify private decoding against native anchors and preserved public analyses."""

import hashlib
import json
import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / 'Antidote/dictionnaires'
api = runpy.run_path(str(ROOT / 'scripts/prepare-private-lexicon.py'))
api['self_check']()
codes = json.loads((PRIVATE / 'morphologie-codes.json').read_text())
exported = json.loads((PRIVATE / 'dictionnaire.json').read_text())
native = json.loads((PRIVATE / 'morphologie.json').read_text())['entrees']
forms = exported['formes']
anchors = {'manger', 'venir', 'prendre', 'rougir', 'faire', 'table', 'petit', 'parler', 'Paris'}
selected = [entry for entry in native if forms[entry['canonical_form_id']] in anchors]
analyses = set(api['enrich'](forms, selected, [], codes))
for expected in [
    ('mangeaient', 'manger', 'verbe', '', 'p', 'ind:imp:3p', 0),
    ('vinrent', 'venir', 'verbe', '', 'p', 'ind:pas:3p', 0),
    ('prises', 'prendre', 'verbe', 'f', 'p', 'par:pas', 0),
    ('rougîtes', 'rougir', 'verbe', '', 'p', 'ind:pas:2p', 0),
    ('faisons', 'faire', 'verbe', '', 'p', 'ind:pre:1p', 0),
    ('tables', 'table', 'nom', 'f', 'p', '', 0),
    ('petites', 'petit', 'adjectif', 'f', 'p', '', 0),
    ('parler', 'parler', 'nom', 'm', 's', '', 0),
    ('parler', 'parler', 'verbe', '', '', 'inf', 0),
    ('Paris', 'Paris', 'nom propre', 'm', 's', '', 0),
]:
    assert expected in analyses, expected
assert not any(row[0] == 'prises' and row[5] == 'ind:pre:3p' for row in analyses)
assert not any(row[0] == 'tables' and row[3:5] == ('m', 's') for row in analyses)

private = json.loads((PRIVATE / 'finition-lexique.json').read_text())
public = json.loads((ROOT / 'resources/lexique/finition-dictionnaire.json').read_text())
for name in ['dictionnaire.json', 'morphologie.json', 'morphologie-codes.json']:
    assert hashlib.sha256((PRIVATE / name).read_bytes()).hexdigest() == private['inputs'][name], name
assert private['inputs']['finition'] == hashlib.sha256((ROOT / 'resources/lexique/finition-dictionnaire.json').read_bytes()).hexdigest()
lexical = api['unpack'](private['payload'])
reference = api['unpack'](public['payload'])
assert lexical['entries'][:len(reference['entries'])] == reference['entries'], 'Analyses publiques altérées'
assert lexical['variants'] == reference['variants'], 'Variantes orthographiques altérées'
assert lexical.get('lemmaOverrides') == reference.get('lemmaOverrides'), 'Lemmes de répétition altérés'
assert lexical['forms'][:len(reference['forms'])] == reference['forms']
grammar = api['unpack'](private['grammalectePayload'])
original_grammar = api['unpack'](public['grammalectePayload'])
assert grammar['grammalecte'] == original_grammar['grammalecte'], 'Index natifs Grammalecte altérés'
extras = dict(grammar['extras'])
blocked = {api['word_key'](form) for form, _mask in reference['variants']}
original_extras = dict(original_grammar['extras'])
assert all(api['word_key'](form) not in blocked or form in original_extras for form in extras), 'Variante contournée par un complément privé'
for form, values in original_grammar['extras']:
    assert set(values) <= set(extras[form]), form
additions = lexical['entries'][len(reference['entries']):]
assert additions and sum(bool(row[2]) for row in additions) == private['counts']['nativeCategorizedAnalyses']
assert sum(bool(row[5]) for row in additions) == private['counts']['nativeVerbAnalyses']
public_forms = {row[0] for row in reference['entries']}
native_only = next(row for row in additions if row[2] == 'nom' and row[0] not in public_forms)
tag = f'>{native_only[1]}/:' + ':'.join(value for value in ['N', native_only[3], native_only[4]] if value)
assert tag in extras[native_only[0].replace('’', "'")], 'Morphologie supplémentaire absente de Grammalecte'
print(json.dumps({'result': 'PASS', 'nativeAnchorAnalyses': len(analyses),
                  'publicAnalysesPreserved': len(reference['entries']), 'privateAnalyses': len(lexical['entries']),
                  'nativeCategorizedAnalyses': private['counts']['nativeCategorizedAnalyses'],
                  'nativeVerbAnalyses': private['counts']['nativeVerbAnalyses']}, ensure_ascii=False))
