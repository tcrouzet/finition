import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('synonyms', Path(__file__).with_name('prepare-synonyms.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

for word in ['été', 'E\u0301TE\u0301', 'l’œil', 'arc-en-ciel']:
    assert module.single_word(word), word
for word in ['', 'deux mots', 'co₂', 'e¼ne', '42', '../fichier']:
    assert not module.single_word(word), word

dictionary = module.Dictionary('Test', [])
dictionary.add('rapide', ['vif', 'véloce', 'VIF'], 'a', 'adjectif', 'vitesse')
dictionary.add('rapide', ['véloce', 'vif'], 'b', 'adjectif', 'vitesse')
dictionary.add('rapide', ['vif', 'prompt'], 'b', 'adjectif', 'autre sens')
dictionary.add('vif', ['alerte'], 'b')
dictionary.add('deux mots', ['proposition'], 'a')
result = dictionary.result()
assert len(result['groups']) == 3
assert set(result['index']) == {'rapide', 'vif'}
assert 'alerte' not in result['index']
assert len(result['index']['rapide']) == 2
assert any(group['sources'] == ['a', 'b'] and set(group['words']) == {'véloce', 'vif'} for group in result['groups'])
assert all('alerte' not in result['groups'][index]['words'] for index in result['index']['rapide'])

assert module.plain_text('<graphie_region><trad>libero</trad><rect>libéro</rect></graphie_region>') == 'libero'
with tempfile.TemporaryDirectory(prefix='finition-synonymes-') as temporary:
    folder = Path(temporary)
    def candidate(word):
        return {'strings': ['', '', word, '', ''], 'children': []}
    def mark(codes, word, children=()):
        return {'values': codes, 'synonyms': [candidate(word)], 'children': list(children)}
    lexicon = {'formes': ['défenseur'], 'mots': [[1, 0]]}
    groups = [
        {'key': 3, 'final': 1, 'label': '', 'marks': [mark([], 'partisan'), mark([186], 'mainteneur'), mark([165], 'obstineur', [mark([150], 'obstineux')]), mark([150], 'partisan')]},
        {'key': 4, 'final': 1, 'label': '', 'marks': [mark([], '<graphie_region><trad>libero</trad><rect>libéro</rect></graphie_region>')]},
    ]
    words = [{'key': 1, 'super_senses': [], 'senses': [
        {'value': 7, 'label': '', 'groups': [{'group_id': 3, 'label': 'Zélateur'}]},
        {'value': 8, 'label': '', 'groups': [{'group_id': 4, 'label': 'Avocat'}]},
    ]}]
    definitions = {'entrees': [{'id': 1, 'definitions': [10, 11]}], 'definitions': [
        {'id': 10, 'parametres_104_108': [7, 0], 'texte': 'Personne qui soutient <b>une cause</b>.'},
        {'id': 11, 'parametres_104_108': [8, 0], 'texte': 'Autre sens.'},
    ]}
    for name, data in [('dictionnaire.json', lexicon), ('synonymes.json', {'words': words, 'groups': groups}), ('definitions.json', definitions)]:
        (folder / name).write_text(json.dumps(data))
    personal = module.personal_dictionary(folder)
    result = [personal['groups'][index] for index in personal['index']['défenseur']]
    assert [group['label'] for group in result] == ['Zélateur', 'Avocat']
    assert result[0]['sense'] == 'Personne qui soutient une cause.'
    assert result[0]['registers'] == [
        {'labels': ['rare'], 'words': ['mainteneur']},
        {'labels': ['québec'], 'words': ['obstineur']},
        {'labels': ['québec', 'familier'], 'words': ['obstineux']},
        {'labels': ['familier'], 'words': ['partisan']},
    ]
    assert result[0]['unmarked'] == ['partisan']
    assert result[1]['words'] == ['libero']

public = module.public_dictionary()
raw = (json.dumps(public, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
assert raw == (module.ROOT / 'ressources/synonymes/synonymes.json').read_bytes()
assert {source['id'] for source in public['sources']} == {'mythes', 'wolf'}
print(f'PASS: fusion par sens, provenance, direction, Unicode et génération déterministe ({len(public["index"])} mots)')
