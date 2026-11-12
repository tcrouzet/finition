"""Convertit le dump français Wiktextract épinglé en quatre dictionnaires publics."""
import gzip
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KINDS = ('definitions', 'antonymes', 'phonetique', 'rimes')
SOURCE_HASH = 'c4f0cdcd410eb7c5c58349aa4f246ccf2dbf6fd92fd79f47640187693938921a'
LICENSE = {
    'name': 'CC-BY-SA-4.0',
    'url': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'attribution': 'Contributeurs du Wiktionnaire francophone ; extraction Wiktextract par Kaikki.org (Tatu Ylönen et contributeurs). Les historiques des articles restent accessibles sur le Wiktionnaire.',
    'source': 'https://fr.wiktionary.org/',
    'download': 'https://kaikki.org/frwiktionary/raw-wiktextract-data.jsonl.gz',
    'sha256': SOURCE_HASH,
    'revision': 'frwiktionary-20261001 ; extraction 2026-10-18 ; wiktextract 05f0d93 / 04e9833',
    'changes': 'Entrées françaises canoniques à un mot ; clés normalisées ; groupes dédoublonnés. Citations, médias, traductions et formes fléchies seules exclus. Rimes dérivées des transcriptions API, sans classement natif.',
}


def key(value):
    return unicodedata.normalize('NFC', value).replace('’', "'").replace('ʼ', "'").replace('‑', '-').lower()


def single_word(value):
    return isinstance(value, str) and len(value) <= 200 and all(
        part and part[0].isalpha() and all(unicodedata.category(char)[0] in 'LM' for char in part)
        for part in re.split("['-]", key(value)))


def text(value, limit):
    if not isinstance(value, str):
        return ''
    result = unicodedata.normalize('NFC', ' '.join(value.split())).strip()
    return result if result and len(result) <= limit and not any(ord(char) < 32 for char in result) else ''


def extract(records):
    entries = {kind: {} for kind in KINDS}

    def add(kind, word, row):
        if row:
            entries[kind].setdefault(word, {})[json.dumps(row, ensure_ascii=False, sort_keys=True)] = row

    for record in records:
        if record.get('lang_code') != 'fr' or not single_word(record.get('word')):
            continue
        senses = record.get('senses', [])
        if 'form-of' in record.get('tags', []) or senses and all(s.get('form_of') or 'form-of' in s.get('tags', []) for s in senses):
            continue
        word = key(record['word'])
        category = text(record.get('pos_title'), 1000)
        for sense in senses:
            if sense.get('form_of') or 'form-of' in sense.get('tags', []):
                continue
            gloss = text(' — '.join(filter(None, (text(g, 20000) for g in sense.get('glosses', [])))), 20000)
            if gloss:
                add('definitions', word, {**({'label': category} if category else {}), 'text': gloss})
        for group in [record, *senses]:
            words = {}
            for antonym in group.get('antonyms', []):
                candidate = text(antonym.get('word'), 200)
                if candidate and key(candidate) != word:
                    words.setdefault(key(candidate), candidate)
            if words:
                label = text(group.get('sense'), 1000) or category
                add('antonymes', word, {**({'label': label} if label else {}), 'words': sorted(words.values(), key=key)})
        for sound in record.get('sounds', []):
            # Les enregistrements audio peuvent transcrire une phrase ou une liaison.
            if sound.get('audio'):
                continue
            ipa = text(sound.get('ipa'), 20000).strip('\\/[] ')
            if not ipa or any(char.isspace() for char in ipa) or '…' in ipa:
                continue
            label = text(', '.join(sound.get('raw_tags', [])), 1000)
            add('phonetique', word, {**({'label': label} if label else {}), 'text': ipa})
            add('rimes', word, {'text': ipa.replace('.', '').replace('ˈ', '').replace('ˌ', '')})
    return {kind: {word: list(rows.values()) for word, rows in sorted(words.items())} for kind, words in entries.items()}


def document(kind, entries):
    return {'format': 'finition-dictionnaire', 'version': 1, 'language': 'fr', 'kind': kind,
            'name': 'Finition', 'description': 'Wiktionnaire via Kaikki — entrées canoniques françaises',
            'documentation': 'https://github.com/tcrouzet/finition/blob/main/doc/dictionnaires.md',
            'license': LICENSE, 'entries': entries}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError(f'Fichier existant différent : {path}')
        return
    with path.open('xb') as output:
        output.write(data)


def main():
    source, license_file = map(Path, sys.argv[1:])
    with source.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != SOURCE_HASH:
            raise ValueError('Empreinte du dump Wiktionnaire différente de la version épinglée')
    license_text = license_file.read_bytes()
    if b'Creative Commons Attribution-ShareAlike 4.0' not in license_text:
        raise ValueError('Texte de licence CC BY-SA 4.0 attendu')
    with gzip.open(source, 'rt', encoding='utf-8') as stream:
        dictionaries = extract(json.loads(line) for line in stream if line.strip())
    outputs = []
    for kind, entries in dictionaries.items():
        data = (json.dumps(document(kind, entries), ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        if not entries or len(entries) > 1200000 or len(data) > 128 * 1024 * 1024 or any(len(rows) > 2048 for rows in entries.values()):
            raise ValueError(f'Dictionnaire hors des limites du format : {kind}, {len(entries)} mots, {len(data)} octets')
        outputs.append((kind, data))
    for kind, data in outputs:
        folder = ROOT / 'resources' / kind
        write(folder / f'{kind}.json', data)
        write(folder / 'CC-BY-SA-4.0.txt', license_text)
        print(f'{kind}: {len(dictionaries[kind])} mots, {len(data)} octets')


if __name__ == '__main__':
    main()
