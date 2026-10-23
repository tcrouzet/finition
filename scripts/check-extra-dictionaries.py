"""Vérifie les packs lexicaux et leur import réel par Finition."""
import json
import hashlib
import runpy
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
module = runpy.run_path(str(ROOT / 'scripts/prepare-extra-dictionaries.py'))
runpy.run_path(str(ROOT / 'scripts/check-wikiquote.py'))
wikiquote = module['wikiquote']
quote_source = Path(sys.argv[1])
with quote_source.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == wikiquote['SOURCE_HASH']
rights = wikiquote['read_bnf'](Path(sys.argv[2]))
authors, wikiquote_rows = wikiquote['extract'](quote_source, rights)
assert 'Colette' in authors and 'Marcel Proust' in authors and 'Jean-Jacques Rousseau' in authors
assert 'Antoine de Saint-Exupéry' not in authors and 'Robert Desnos' not in authors
source_rows = {json.dumps(row, sort_keys=True, ensure_ascii=False) for row in wikiquote_rows}
reference = 'Victor Hugo, Les Misérables, 1862, page 2'
record = {'word': 'Élan', 'lang_code': 'fr', 'pos': 'verb', 'pos_title': 'Verbe',
          'etymology_texts': ['Du latin exemplum.', 'Du latin exemplum.'],
          'forms': [{'form': 'élançons', 'tags': ['indicative', 'present', 'first-person', 'plural'], 'raw_tags': ['rare']},
                    {'form': '—'}, {'form': 'erreur', 'tags': ['error-unrecognized-form']}],
          'hypernyms': [{'word': 'mouvement', 'sense': 'Impulsion'}, {'word': 'mouvement', 'sense': 'Impulsion'}],
          'synonyms': [{'word': 'ardeur'}], 'related': [{'word': 'élancer'}],
          'senses': [{'examples': [{'text': 'Un exemple littéraire.', 'ref': reference},
                                   {'text': 'Moderne.', 'ref': 'Auteur récent, Ouvrage, 2020'},
                                   {'text': 'Exemple sans auteur.'}]}]}
result, stats = module['extract']([record, {**record, 'lang_code': 'en'},
                                   {**record, 'word': 'deux mots'}, {**record, 'tags': ['form-of']}])
assert stats == {'records': 4, 'frenchCanonicalRecords': 1, 'excludedExamples': 2}
assert result['conjugaisons']['élan'] == [{'label': 'indicatif, présent, 1re personne, pluriel, rare', 'text': 'élançons'}]
assert module['conjugation_row']('Variantes', ['test’', "test'"]) == {'label': 'Variantes', 'text': "test', test’"}
assert result['historique']['élan'] == [{'label': 'Verbe', 'text': 'Du latin exemplum.'}]
assert result['champ-lexical']['élan'] == [{'label': 'Hyperonymes — Impulsion', 'words': ['mouvement']}]
assert result['citations']['élan'] == [{'label': reference, 'text': 'Un exemple littéraire.'}]
assert module['extract']([record])[0] == module['extract']([record, record])[0]
extended = {**record, 'senses': [{'examples': [{'text': 'Un autre exemple.', 'ref': 'George Sand, La Mare au diable, 1846'}]}]}
assert module['extract']([extended], authors)[0]['citations']['élan'] == [{'text': 'Un autre exemple.', 'label': 'George Sand, La Mare au diable, 1846'}]
assert not module['extract']([extended])[0]['citations']
previous = {'format': 'finition-dictionnaire', 'version': 1, 'language': 'fr', 'kind': 'citations', 'entries': {'élan': [{'text': 'Avant.'}]}}
current = {**previous, 'entries': {'élan': [{'text': 'Avant.'}, {'text': 'Après.'}]}}
assert module['preserves_citations'](previous, current)
assert not module['preserves_citations'](current, previous)
assert not module['preserves_citations'](previous, {**current, 'kind': 'definitions'})
accept = module['public_domain_reference']
assert accept(reference)
assert accept('Gustave Flaubert, Madame Bovary, 1857')
for invalid in ['', 'Victor Hugo, Les Misérables', 'Victor Hugo, Autre livre, 1862',
                'Victor Hugo, Les Misérables, 1862, édition 2020',
                'Victor Hugo, Les Misérables, traduction de X, 1862',
                'Auteur X, Victor Hugo, Les Misérables, 1862',
                'Victor Hugo, Les Misérables, cité par X, 1862']:
    assert not accept(invalid), invalid

arguments = sys.argv
try:
    sys.argv = ['prepare-extra-dictionaries.py', str(ROOT / 'scripts/check-extra-dictionaries.py')]
    try:
        module['main']()
    except ValueError as error:
        assert 'Empreinte du snapshot' in str(error)
    else:
        raise AssertionError('Un autre fichier source ne doit pas recevoir la provenance du snapshot épinglé')
finally:
    sys.argv = arguments

parser = '''import fs from "node:fs"; import vm from "node:vm"; import { build } from "esbuild";
const built = await build({stdin:{contents:'export { parseWordDictionary } from "./plugin/dictionaries"',resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",write:false,external:["obsidian"],logLevel:"silent"});
const module = {exports:{}}; vm.runInNewContext(built.outputFiles[0].text,{module,URL,require:()=>({requestUrl(){throw Error("Réseau interdit")}})});
for(const kind of JSON.parse(process.argv[1])) {
const file = `resources/${kind}/${kind}.json`;
const dictionary = module.exports.parseWordDictionary(fs.readFileSync(file,"utf8"),kind);
console.log(JSON.stringify({parser:"PASS",kind,entries:Object.keys(dictionary.entries).length,bytes:fs.statSync(file).size}));
}'''
subprocess.run(['node', '--input-type=module', '-e', parser, json.dumps(module['KINDS'])], cwd=ROOT, check=True)
hashes = set()
for kind in module['KINDS']:
    folder = ROOT / 'resources' / kind
    document = json.loads((folder / f'{kind}.json').read_text())
    if kind == 'conjugaisons':
        assert (folder / f'{kind}.json').stat().st_size < 100 * 1024 * 1024
    hashes.add(document['license']['sha256'])
    assert document['license']['sha256'] == (wikiquote['SOURCE_HASH'] if kind == 'citations' else module['SOURCE_HASH'])
    assert document['license']['name'] == 'CC-BY-SA-4.0'
    for rows in document['entries'].values():
        assert len(rows) == len({json.dumps(row, sort_keys=True, ensure_ascii=False) for row in rows})
        if kind == 'citations':
            for row in rows:
                if 'https://fr.wikiquote.org/w/index.php?oldid=' in row['label']:
                    assert json.dumps(row, sort_keys=True, ensure_ascii=False) in source_rows
                else:
                    assert accept(row['label']) or wikiquote['public_reference'](row['label'], authors)
    assert (folder / 'CC-BY-SA-4.0.txt').read_bytes() == (ROOT / 'resources/definitions/CC-BY-SA-4.0.txt').read_bytes()
assert hashes == {module['SOURCE_HASH'], wikiquote['SOURCE_HASH']}
print('PASS: formes natives, étymologies, relations typées sans synonymes, citations classiques multisources, dédoublonnage, provenance et import réel')
