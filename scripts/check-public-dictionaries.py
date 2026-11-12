"""Vérifie la conversion publique sans réseau ni données privées."""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('public_dictionaries', Path(__file__).with_name('prepare-public-dictionaries.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
record = {'word': 'Élan', 'lang_code': 'fr', 'pos_title': 'nom commun',
          'senses': [{'glosses': ['Premier sens.', 'Précision.']}],
          'antonyms': [{'word': 'recul'}, {'word': 'recul'}, {'word': 'Élan'}],
          'sounds': [{'ipa': '\\e.lɑ̃\\'}, {'ipa': '\\e.lɑ̃\\'}, {'ipa': '[œ̃.n‿e.lɑ̃]', 'audio': 'example.ogg'}]}
records = [record, {**record, 'lang_code': 'en'}, {**record, 'word': 'deux mots'},
           {**record, 'word': 'formes', 'tags': ['form-of']},
           {**record, 'word': 'formes', 'senses': [{'form_of': [{'word': 'forme'}]}]}]
result = module.extract(records)
assert result == module.extract(records)
assert all(list(entries) == ['élan'] for entries in result.values())
assert result['definitions']['élan'] == [{'label': 'nom commun', 'text': 'Premier sens. — Précision.'}]
assert result['antonymes']['élan'] == [{'label': 'nom commun', 'words': ['recul']}]
assert result['phonetique']['élan'] == [{'text': 'e.lɑ̃'}]
assert result['rimes']['élan'] == [{'text': 'elɑ̃'}]
for word in ['', '../secret', 'mot\x00', '42', 'deux mots', 'x' * 201]:
    assert not module.single_word(word)
for word in ['Élan', "aujourd’hui", 'arc-en-ciel', 'e\u0301lan']:
    assert module.single_word(word)
for kind in module.KINDS:
    path = module.ROOT / 'resources' / kind / f'{kind}.json'
    raw = path.read_bytes()
    value = json.loads(raw)
    assert value['license'] == module.LICENSE
    assert value['format'] == 'finition-dictionnaire' and value['kind'] == kind
    assert value['language'] == 'fr' and value['name'] == 'Finition'
    assert value['entries'] and len(raw) <= 128 * 1024 * 1024
    assert (path.parent / 'CC-BY-SA-4.0.txt').is_file()
    print(f'{kind}: {len(value["entries"])} mots, {len(raw)} octets ; licence et provenance présentes')
print('PASS: filtrage, sens, antonymes directionnels, API, dédoublonnage, Unicode et quatre packs publics')
