"""Convert existing private JSON exports; never execute Antidote or alter sources."""

import hashlib
import html
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path


FOLDER = Path(__file__).resolve().parents[1] / 'Antidote/dictionnaires/originaux'
OUTPUT = FOLDER.parent / 'finition'
FILENAMES = {'definitions': 'definition', 'antonymes': 'antonyme', 'phonetique': 'phonetique', 'rimes': 'rime'}
MAX_BYTES = 128 * 1024 * 1024


def key(word):
    return unicodedata.normalize('NFC', word).replace('’', "'").replace('ʼ', "'").replace('‑', '-').lower()


def single_word(word):
    parts = re.split("['-]", word)
    return bool(word) and len(word) <= 200 and unicodedata.category(word[0]).startswith('L') and all(
        part and all(unicodedata.category(char)[0] in 'LM' for char in part) for part in parts)


def plain_text(value):
    def graphie(match):
        forms = re.findall(r'<(?:trad|rect)>(.*?)</(?:trad|rect)>', match[0], re.S)
        return forms[0] if forms else match[0]
    value = re.sub(r'<graphie_region>.*?</graphie_region>', graphie, value, flags=re.S)
    value = html.unescape(re.sub('<[^>]*>', '', value))
    value = ''.join(' ' if char in '\t\r\n' else char for char in value
                    if unicodedata.category(char)[0] != 'C' or char in '\t\r\n')
    return unicodedata.normalize('NFC', value).strip()


def label(*values):
    return ' · '.join(dict.fromkeys(value for value in map(plain_text, values) if value))


def load(name):
    # Raw exports are trusted local inputs; definitions.json exceeds the consumer's 128 MiB limit.
    return json.loads((FOLDER / f'{name}.json').read_text(encoding='utf-8'))


def add(entries, lemma, row):
    normalized = key(lemma)
    if single_word(normalized) and row and row not in entries[normalized]:
        entries[normalized].append(row)


def convert_definitions(lemmas, raw):
    entries = defaultdict(list)
    definitions = {item['id']: item for item in raw['definitions']}
    for entry in raw['entrees']:
        lemma = lemmas.get(entry['id'])
        if lemma is None or not single_word(key(lemma)):
            continue
        visited = set()

        def visit(identifier, context):
            if identifier in visited:
                return
            visited.add(identifier)
            definition = definitions.get(identifier)
            if definition is None:
                raise ValueError(f'Définition référencée absente : {identifier}')
            text = plain_text(definition['texte'])
            examples = [plain_text(value) for value in definition['exemples']]
            examples = list(dict.fromkeys(value for value in examples if value))
            if text or examples:
                add(entries, lemma, {**({'label': context} if context else {}),
                                    **({'text': text} if text else {}),
                                    **({'examples': examples} if examples else {})})
            for reference in definition['renvois_definitions']:
                visit(reference, context)

        def section(item, context=''):
            context = label(context, item.get('titre', ''))
            for identifier in item.get('definitions', []):
                visit(identifier, context)
            for child in item.get('sections', []):
                section(child, context)

        for item in entry['supersens'] + entry['sections']:
            section(item)
        for identifier in entry['definitions']:
            visit(identifier, '')
    return entries


def candidates(node):
    if 'strings' in node:
        yield plain_text(node['strings'][2])
    for field in ('marks', 'synonyms', 'children'):
        for child in node.get(field, []):
            yield from candidates(child)


def convert_antonyms(lemmas, raw, antonyms):
    entries, groups = defaultdict(list), defaultdict(list)
    for group in antonyms['groups']:
        groups[group['key']].append(group)
    for word in raw['words']:
        lemma = lemmas.get(word['key'])
        if lemma is None or not single_word(key(lemma)):
            continue
        senses = [(sense, '') for sense in word['senses']]
        senses += [(sense, parent['label']) for parent in word['super_senses'] for sense in parent['senses']]
        for sense, parent_label in senses:
            for reference in sense['groups']:
                for group in groups.get(reference['group_id'], []):
                    words = list(dict.fromkeys(value for value in candidates(group)
                                              if value and len(value) <= 200 and key(value) != key(lemma)))
                    if words:
                        context = label(parent_label, sense['label'], reference['label'], group['label'])
                        add(entries, lemma, {**({'label': context} if context else {}), 'words': words})
    return entries


def convert_phonetics(lemmas, canonical_flexions, raw):
    entries = defaultdict(list)
    matched, unmatched = set(), set()
    for word_id, flexion_id, _variant_id, pronunciations in raw['rows']:
        lemma = lemmas.get(word_id)
        if lemma is None or flexion_id != canonical_flexions.get(word_id):
            unmatched.add(word_id)
            continue
        matched.add(word_id)
        for string_id, _provenance_id, extra in pronunciations:
            if extra is None or extra == lemma:
                pronunciation = raw['strings'][string_id]
                if pronunciation:
                    add(entries, lemma, {'text': pronunciation})
    return entries, {'matchedCanonicalWordIds': len(matched),
                     'unmatchedCanonicalWordIds': len(unmatched - matched)}


def validate(document):
    assert len(document['description']) <= 1000
    for word, rows in document['entries'].items():
        assert key(word) == word and single_word(word), repr(word)
        assert 0 < len(rows) <= 2048, word
        for row in rows:
            assert set(row) <= {'label', 'text', 'examples', 'words'} and row, word
            for field, maximum in [('label', 1000), ('text', 20000)]:
                if field in row:
                    assert isinstance(row[field], str) and len(row[field]) <= maximum, (word, field)
            for field, count, maximum in [('examples', 256, 10000), ('words', 2048, 200)]:
                if field in row:
                    assert 0 < len(row[field]) <= count, (word, field)
                    assert all(isinstance(value, str) and 0 < len(value) <= maximum for value in row[field]), (word, field)
            strings = [value for value in row.values() if isinstance(value, str)]
            strings += row.get('examples', []) + row.get('words', [])
            assert all(unicodedata.category(char)[0] != 'C' for value in strings for char in value), word


def write(kind, entries, description, limitations, encoding=None):
    document = {'format': 'finition-dictionnaire', 'version': 1, 'language': 'fr', 'kind': kind,
                'name': 'Antidote', 'description': description,
                'entries': dict(sorted(entries.items())), 'limitations': limitations}
    if encoding:
        document['encoding'] = encoding
    validate(document)
    encoded = (json.dumps(document, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    assert len(encoded) <= MAX_BYTES, f'{kind} dépasse 128 Mio'
    OUTPUT.mkdir(exist_ok=True)
    path = OUTPUT / f'{FILENAMES[kind]}-antidote-finition.json'
    if path.exists():
        assert path.read_bytes() == encoded, f'Refus de remplacer un fichier différent : {path}'
    else:
        with path.open('xb') as stream:
            stream.write(encoded)
    return {'file': path.name, 'entries': len(entries), 'rows': sum(map(len, entries.values())),
            'bytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest(), 'limitations': limitations}


def self_check():
    assert key('L’ŒIL‑DE‑BŒUF') == "l'œil-de-bœuf"
    assert single_word("l'œil-de-bœuf") and not single_word('deux mots') and not single_word('mot-')
    assert plain_text('<graphie_region><trad>goût</trad><rect>gout</rect></graphie_region>') == 'goût'
    assert plain_text('a\x00\ue000\u2060b\n&amp;') == 'ab &'
    raw = {'definitions': [{'id': 1, 'texte': 'Sens.', 'exemples': ['Exemple.'], 'renvois_definitions': [2]},
                           {'id': 2, 'texte': 'Renvoi.', 'exemples': [], 'renvois_definitions': [1]}],
           'entrees': [{'id': 1, 'supersens': [{'titre': 'Lieu', 'definitions': [],
                        'sections': [{'titre': 'Section', 'definitions': [1]}]}], 'sections': [], 'definitions': [1]}]}
    rows = convert_definitions({1: 'mot'}, raw)['mot']
    assert len(rows) == 2 and rows[0] == {'label': 'Lieu · Section', 'text': 'Sens.', 'examples': ['Exemple.']}
    raw = {'strings': ['Sa', 'Sat', 'bo', 'bèl'],
           'rows': [[1, 17, 1, [[0, 0, None]]], [1, 19, 3, [[1, 0, None]]],
                    [2, 17, 3, [[2, 0, 'beau'], [3, 0, 'bel']]], [3, 18, 3, [[1, 0, None]]]]}
    rows, stats = convert_phonetics({1: 'chat', 2: 'beau', 3: 'absent'}, {1: 17, 2: 17}, raw)
    assert rows == {'chat': [{'text': 'Sa'}], 'beau': [{'text': 'bo'}]} and stats['unmatchedCanonicalWordIds'] == 1
    group = {'key': 5, 'label': '', 'marks': [{'synonyms': [{'strings': ['', '', 'fermé', '', ''],
             'children': [{'strings': ['', '', 'clos', '', '']}]}]}]}
    word = {'key': 1, 'super_senses': [], 'senses': [{'label': 'Sens', 'groups': [{'group_id': 5, 'label': ''}]}]}
    second = {**group, 'label': 'Autre'}
    rows = convert_antonyms({1: 'ouvert'}, {'words': [word]}, {'groups': [group, second]})['ouvert']
    assert len(rows) == 2 and rows[0] == {'label': 'Sens', 'words': ['fermé', 'clos']}
    invalid = {'description': '', 'entries': {'mot': [{'text': '\ue000'}]}}
    try:
        validate(invalid)
    except AssertionError:
        pass
    else:
        raise AssertionError('Caractère privé accepté')


def main():
    self_check()
    lexicon = load('dictionnaire')
    lemmas = {word: lexicon['formes'][form] for word, form in lexicon['mots']}
    del lexicon
    results = [write('definitions', convert_definitions(lemmas, load('definitions')),
                     'Définitions, sections et exemples du dictionnaire privé.',
                     ['Codes grammaticaux et marques numériques non interprétés ; locutions non indexées séparément.'])]
    results.append(write('antonymes', convert_antonyms(lemmas, load('synonymes'), load('antonymes')),
                         'Antonymes regroupés par sens ; groupes natifs de types 6 à 9.',
                         ['Codes grammaticaux, marques et sous-types numériques non interprétés.']))
    canonical = {entry['word_id']: entry['tail'][0] for entry in load('morphologie')['entrees'] if entry['tail']}
    entries, coverage = convert_phonetics(lemmas, canonical, load('phonetique'))
    assert {'Sa', 'Sà'} <= {row['text'] for row in entries['chat']} and 'Sat' not in {row['text'] for row in entries['chat']}
    assert {row['text'] for row in entries['beau']} == {'bo'}
    limitations = ['Transcriptions internes conservées sans conversion en alphabet phonétique international.',
                   'Variantes et provenances agrégées ; transcriptions identiques dédupliquées, codes régionaux non interprétés.',
                   'Graphies non canoniques et mots sans correspondance morphologique sûre exclus.']
    results.append(write('phonetique', entries, 'Prononciations internes des graphies canoniques.', limitations, 'phonetic-internal'))
    rhyme = load('rimes')
    assert rhyme['phoneticDictionary'] == 'phonetique.json'
    results.append(write('rimes', entries, 'Terminaisons phonétiques communes ; recherche approximative.',
                         limitations + ['Classement natif des rimes non reproduit ; recherche par suffixe des transcriptions internes.'],
                         'phonetic-internal'))
    print(json.dumps({'selfChecks': 'passed', 'files': results, 'phoneticCoverage': coverage}, ensure_ascii=False))


if __name__ == '__main__':
    main()
