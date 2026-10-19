import hashlib
import html
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def key(word):
    return unicodedata.normalize('NFC', word).replace('’', "'").replace('ʼ', "'").replace('‑', '-').lower()


def single_word(word):
    parts = re.split("['-]", key(word))
    return all(part and part[0].isalpha() and all(unicodedata.category(char)[0] in 'LM' for char in part) for part in parts)


def plain_text(value):
    def graphie(match):
        forms = re.findall(r'<(?:trad|rect)>(.*?)</(?:trad|rect)>', match[0], re.S)
        return forms[0] if forms else match[0]
    value = re.sub(r'<graphie_region>.*?</graphie_region>', graphie, value, flags=re.S)
    return unicodedata.normalize('NFC', html.unescape(re.sub('<[^>]*>', '', value))).strip()


class Dictionary:
    def __init__(self, name, sources, preserve_order=False):
        self.name, self.sources = name, sources
        self.groups, self.index = {}, defaultdict(dict)
        self.preserve_order = preserve_order

    def add(self, query, words, source, category='', label='', sense='', registers=(), unmarked=None):
        if not single_word(query):
            return
        cleaned = {}
        for word in words:
            word = unicodedata.normalize('NFC', re.sub('<[^>]*>', '', word)).strip()
            if word and len(word) <= 200 and not any(ord(char) < 32 for char in word):
                cleaned.setdefault(key(word), word)
        if not cleaned or not any(word != key(query) for word in cleaned):
            return
        words = tuple(sorted(cleaned.values(), key=lambda word: (key(word), word)))
        rows = tuple((tuple(labels), tuple(sorted({key(value): value for value in values if key(value) in cleaned}.values(), key=key))) for labels, values in registers)
        rows = tuple((labels, values) for labels, values in rows if values)
        neutral = tuple(sorted({key(value): cleaned[key(value)] for value in unmarked or () if key(value) in cleaned}.values(), key=key))
        identity = category, label, words, sense, rows, unmarked is not None, neutral
        self.groups.setdefault(identity, set()).add(source)
        self.index[key(query)].setdefault(identity, None)

    def result(self):
        identities = sorted(self.groups)
        numbers = {identity: index for index, identity in enumerate(identities)}
        return {'format': 'finition-synonymes', 'version': 1, 'language': 'fr', 'name': self.name, 'sources': self.sources,
                'groups': [{'category': category, 'label': label, 'words': list(words), 'sources': sorted(self.groups[identity]),
                            **({'sense': sense} if sense else {}),
                            **({'registers': [{'labels': list(labels), 'words': list(values)} for labels, values in rows]} if rows else {}),
                            **({'unmarked': list(neutral)} if explicit else {})}
                           for identity in identities for category, label, words, sense, rows, explicit, neutral in [identity]],
                'index': {word: (list if self.preserve_order else sorted)(numbers[identity] for identity in self.index[word]) for word in sorted(self.index)}}


def public_dictionary():
    folder = ROOT / 'resources/synonymes'
    provenance = json.loads((folder / 'SOURCE.json').read_text())
    for source in provenance['files']:
        raw = ((ROOT / 'scripts/synonymes' if source['file'].startswith('sources/') else folder) / source['file']).read_bytes()
        assert len(raw) == source['bytes'] and hashlib.sha256(raw).hexdigest() == source['sha256']
    dictionary = Dictionary('Finition', [
        {'id': 'mythes', 'name': 'myThes français 2.3 — Frédéric Labbé, Dicollecte / LibreOffice', 'license': 'LGPL-2.1-or-later', 'url': 'https://github.com/LibreOffice/dictionaries/tree/master/fr_FR/dictionaries'},
        {'id': 'wolf', 'name': 'WOLF — Benoît Sagot et Darja Fišer, distribution Open Multilingual Wordnet', 'license': 'CECILL-C', 'url': 'https://github.com/omwn/omw-data/tree/main/wns/fra'},
    ])
    lines = iter((ROOT / 'scripts/synonymes/sources/mythes.dat').read_text(encoding='utf-8').splitlines())
    assert next(lines) == 'UTF-8'
    for line in lines:
        word, count = line.rsplit('|', 1)
        for _ in range(int(count)):
            category, *synonyms = next(lines).split('|')
            category = category.strip('()').lower()
            dictionary.add(word, [value for value in synonyms if key(value) != key(word)], 'mythes', category)
    synsets = defaultdict(list)
    for line in (ROOT / 'scripts/synonymes/sources/wolf.tab').read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        identifier, relation, word = line.split('\t', 2)
        if relation == 'fra:lemma':
            synsets[identifier].append(word.replace('_', ' '))
    categories = {'n': 'nom', 'v': 'verbe', 'a': 'adjectif', 's': 'adjectif', 'r': 'adverbe'}
    for identifier, words in synsets.items():
        if len({key(word) for word in words}) > 1:
            for word in words:
                dictionary.add(word, words, 'wolf', categories[identifier[-1]])
    return {**dictionary.result(), 'description': 'myThes et WOLF',
            'documentation': 'https://github.com/tcrouzet/finition/blob/main/doc/synonymes.md'}


def personal_dictionary(folder):
    lexicon = json.loads((folder / 'dictionnaire.json').read_text())
    raw = json.loads((folder / 'synonymes.json').read_text())
    lemmas = {word: lexicon['formes'][form] for word, form in lexicon['mots']}
    groups = defaultdict(list)
    for group in raw['groups']:
        if group['final'] in (1, 2):
            groups[group['key']].append(group)
    dictionary = Dictionary('Dictionnaire personnel', [{'id': 'personnel', 'name': 'Dictionnaire personnel', 'license': 'unspecified', 'url': ''}], preserve_order=True)
    meanings = {}
    if (folder / 'definitions.json').exists():
        definitions = json.loads((folder / 'definitions.json').read_text())
        by_id = {item['id']: item for item in definitions['definitions']}
        for entry in definitions['entrees']:
            meanings[entry['id']] = {by_id[number]['parametres_104_108'][0]: plain_text(by_id[number]['texte']) for number in entry['definitions'] if number in by_id}
        del definitions, by_id
    register_names = {37: 'droit', 115: 'sports', 135: 'anciennement', 150: 'familier', 154: 'soutenu', 165: 'québec', 186: 'rare', 187: 'vieilli', 192: 'vieux'}

    def candidates(node):
        if isinstance(node, dict):
            if 'strings' in node:
                yield plain_text(node['strings'][2])
            for field in ['marks', 'synonyms', 'children']:
                for child in node.get(field, []):
                    yield from candidates(child)

    def registers(marks, parent=()):
        for mark in marks:
            label = ' · '.join(dict.fromkeys(register_names.get(code, 'Autres usages') for code in mark['values']))
            path = parent + ((label,) if label else ())
            yield path, list(candidates({'synonyms': mark['synonyms']}))
            yield from registers(mark['children'], path)

    for word in raw['words']:
        lemma = lemmas.get(word['key'])
        if lemma is None:
            continue
        senses = word['senses'] + [sense for parent in word['super_senses'] for sense in parent['senses']]
        for sense in senses:
            for reference in sense['groups']:
                for group in groups[reference['group_id']]:
                    words = [value for value in candidates(group) if key(value) != key(lemma)]
                    rows = list(registers(group['marks']))
                    dictionary.add(lemma, words, 'personnel', label=reference['label'] or group['label'] or sense['label'],
                                   sense=meanings.get(word['key'], {}).get(sense['value'], ''), registers=[row for row in rows if row[0]],
                                   unmarked=[value for labels, values in rows if not labels for value in values])
    return dictionary.result()


def write(path, value):
    raw = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    if path.exists():
        assert path.read_bytes() == raw, f'Fichier différent déjà présent : {path}'
    else:
        with path.open('xb') as stream:
            stream.write(raw)
    print(f'{path.name}: {len(value["index"])} mots, {len(value["groups"])} groupes, {len(raw)} octets')


if __name__ == '__main__':
    if len(sys.argv) == 3:
        write(Path(sys.argv[2]), personal_dictionary(Path(sys.argv[1])))
    elif len(sys.argv) == 1:
        write(ROOT / 'resources/synonymes/synonymes.json', public_dictionary())
    else:
        raise SystemExit('Usage : prepare-synonyms.py [dossier-personnel sortie.json]')
