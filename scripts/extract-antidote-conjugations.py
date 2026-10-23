"""Preserve native verb morphology and convert verified infinitives for private use."""

import hashlib
import json
import runpy
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'Antidote/dictionnaires'
lexicon = runpy.run_path(str(ROOT / 'scripts/prepare-private-lexicon.py'))
dictionary = runpy.run_path(str(ROOT / 'scripts/prepare-private-dictionaries.py'))


def form_references(value):
    if isinstance(value, dict):
        for field, item in value.items():
            if field.endswith('form_id'):
                yield item
            else:
                yield from form_references(item)
    elif isinstance(value, list):
        for item in value:
            yield from form_references(item)


def convert(exported, morphology, codes):
    forms = exported['formes']
    word_rows = {row[0]: row for row in codes['words']}
    selected = [entry for entry in morphology['entrees']
                if lexicon['category_name'](codes['categories'].get(str(word_rows[entry['word_id']][1]), '')) == 'verbe']
    selected_ids = {entry['word_id'] for entry in selected}
    referenced = sorted({identifier for entry in selected for identifier in form_references(entry)})
    native = {'language': 'fr', 'formIdBase': exported['formIdBase'],
              'formes': {str(identifier): forms[identifier] for identifier in referenced},
              'motsColumns': exported['motsColumns'],
              'mots': [row for row in exported['mots'] if row[0] in selected_ids],
              'wordColumns': codes['wordColumns'], 'words': [word_rows[entry['word_id']] for entry in selected],
              'categories': codes['categories'], 'flexions': codes['flexions'], 'entrees': selected,
              'limitations': {'dictionnaire': exported.get('limitations', []), 'morphologie': morphology.get('limitations', []),
                              'codes': codes.get('limitations', [])}}
    groups = defaultdict(lambda: defaultdict(list))
    excluded = []
    for entry in selected:
        canonical = forms[entry['canonical_form_id']]
        kind = entry['tail'][0] if entry['tail'] else None
        label = codes['flexions'].get(str(kind), '')
        lemma = dictionary['key'](canonical)
        if lexicon['features'](label)[2] != 'inf' or not dictionary['single_word'](lemma):
            excluded.append({'word_id': entry['word_id'], 'canonical': canonical, 'kind': kind,
                             'reason': 'Infinitif canonique absent ou clé non compatible avec le format Finition.'})
            continue
        flexions = [(entry['canonical_form_id'], kind)]
        flexions.extend((item['form_id'], item['kind']) for item in entry['flexions'])
        for variant in entry['variants']:
            flexions.append((variant['form_id'], variant['kind']))
            if 'second_form_id' in variant:
                flexions.append((variant['second_form_id'], variant['kind']))
            flexions.extend((item['form_id'], item['kind']) for item in variant['flexions'])
        for identifier, kind in flexions:
            form = forms[identifier]
            values = groups[lemma][kind]
            if form not in values:
                values.append(form)
    entries = {lemma: [{'label': f'{codes["flexions"].get(str(kind), "Type natif inconnu")} [{kind}]', 'words': words}
                       for kind, words in sorted(rows.items())] for lemma, rows in sorted(groups.items())}
    return native, entries, excluded


def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')


def write_new(path, raw):
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError(f'Refus de remplacer un fichier différent : {path}')
    else:
        with path.open('xb') as stream:
            stream.write(raw)


def self_check():
    forms = ['inventer', 'inventons', 'inventez', 'réinventer', 'réinventons', 'nom', 'fie', 'inventé']
    entry = {'word_id': 1, 'canonical_form_id': 0, 'tail': [63, 0, 1, 0],
             'flexions': [{'form_id': 1, 'kind': 24, 'marks': [12]}, {'form_id': 7, 'kind': 72}],
             'variants': [{'form_id': 3, 'second_form_id': 3, 'kind': 63, 'flags': [1],
                           'flexions': [{'form_id': 4, 'kind': 24}]}]}
    codes = {'wordColumns': ['id', 'category', 'frequency', 'rank'], 'words': [[1, 151, 0, 0], [2, 52, 0, 0], [3, 151, 0, 0]],
             'categories': {'151': 'verbe', '52': 'nom'}, 'flexions': {'63': 'Inf', '24': 'IndPr1P', '72': 'EuIndPr', '22': 'IndPr2S'}}
    exported = {'formes': forms, 'formIdBase': 0, 'motsColumns': ['id', 'form'], 'mots': [[1, 0], [2, 5], [3, 6]]}
    other = {**entry, 'word_id': 2, 'canonical_form_id': 5}
    non_infinitive = {**entry, 'word_id': 3, 'canonical_form_id': 6, 'tail': [22]}
    native, entries, excluded = convert(exported, {'entrees': [entry, other, non_infinitive]}, codes)
    assert native['entrees'] == [entry, non_infinitive] and native['words'] == [codes['words'][0], codes['words'][2]]
    assert set(native['formes']) == {'0', '1', '3', '4', '6', '7'}
    assert entries == {'inventer': [{'label': 'IndPr1P [24]', 'words': ['inventons', 'réinventons']},
                                   {'label': 'Inf [63]', 'words': ['inventer', 'réinventer']},
                                   {'label': 'EuIndPr [72]', 'words': ['inventé']}]}
    assert excluded[0]['word_id'] == 3 and len(excluded) == 1
    dictionary['validate']({'description': '', 'entries': entries})
    with tempfile.TemporaryDirectory(prefix='finition-conjugations-check-') as temporary:
        path = Path(temporary) / 'data.json'
        write_new(path, b'first')
        write_new(path, b'first')
        try:
            write_new(path, b'different')
        except ValueError:
            assert path.read_bytes() == b'first'
        else:
            raise AssertionError('Remplacement différent accepté')


def main():
    self_check()
    paths = [FOLDER / 'originaux' / name for name in ('dictionnaire.json', 'morphologie.json', 'morphologie-codes.json')]
    sources = [{'file': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in paths]
    values = [json.loads(path.read_text(encoding='utf-8')) for path in paths]
    assert values[0]['formIdBase'] == 0 and values[0]['langue'] == values[1]['langue'] == 'fr'
    native, entries, excluded = convert(*values)
    limitation = ['Données privées dérivées des exports locaux ; aucune autorisation de redistribution fournie.',
                  'Formes simples et variantes natives uniquement ; aucun temps composé reconstruit.',
                  'Les étiquettes de flexion natives sont conservées, y compris les types euphoniques sans temps interprété.',
                  'Les entrées sans infinitif canonique vérifié restent dans le sous-ensemble original ; elles ne sont pas attribuées à un infinitif supposé.']
    original = {'format': 'antidote-conjugaison-original', 'version': 1, 'sources': sources, **native,
                'excludedFromConversion': excluded, 'conversionLimitations': limitation}
    converted = {'format': 'finition-dictionnaire', 'version': 1, 'language': 'fr', 'kind': 'conjugaisons',
                 'name': 'Antidote', 'description': 'Conjugaisons et variantes natives par infinitif ; codes de flexion conservés.',
                 'sources': sources, 'limitations': limitation, 'entries': entries}
    dictionary['validate'](converted)
    outputs = {FOLDER / 'originaux/conjugaison-antidote-original.json': encode(original),
               FOLDER / 'finition/conjugaison-antidote-finition.json': encode(converted)}
    for path, raw in outputs.items():
        if path.exists() and path.read_bytes() != raw:
            raise ValueError(f'Refus de remplacer un fichier différent : {path}')
    assert len(outputs[FOLDER / 'finition/conjugaison-antidote-finition.json']) <= dictionary['MAX_BYTES']
    for path, raw in outputs.items():
        write_new(path, raw)
    parser = '''import fs from "node:fs"; import vm from "node:vm"; import { build } from "esbuild";
const built = await build({stdin:{contents:'export { parseWordDictionary } from "./plugin/dictionaries"',resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",write:false,external:["obsidian"],logLevel:"silent"});
const module = {exports:{}}; vm.runInNewContext(built.outputFiles[0].text,{module,URL,require:()=>({requestUrl(){throw Error("Réseau interdit")}})});
const value = module.exports.parseWordDictionary(fs.readFileSync(process.argv[1],"utf8"),"conjugaisons");
process.stdout.write(JSON.stringify({parser:"PASS",entries:Object.keys(value.entries).length})+"\\n");'''
    result = subprocess.run(['node', '--input-type=module', '-e', parser, str(FOLDER / 'finition/conjugaison-antidote-finition.json')], cwd=ROOT, check=True, capture_output=True, text=True)
    print(result.stdout.strip())
    print(json.dumps({'result': 'PASS', 'selfCheck': 'PASS', 'nativeVerbEntries': len(native['entrees']),
                      'nativeReferencedForms': len(native['formes']), 'convertedInfinitives': len(entries),
                      'convertedRows': sum(len(rows) for rows in entries.values()), 'excludedEntries': len(excluded),
                      'files': [{'file': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
                                for path, raw in outputs.items()]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
