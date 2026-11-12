"""Decode the installed native historical dictionary without launching Antidote."""

import argparse
import hashlib
import json
import re
import struct
import sys
import tempfile
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RESOURCE_ROOT = Path('/Applications/Antidote/Antidote 13.app/Contents/Frameworks/LibLingFR.framework/Versions/A/Resources')
ANALYSIS_ROOT = Path('/Users/thierrycrouzet/Documents/python/antidote-analyse')


def indexed_table(data, offset, reader_type):
    reader = reader_type(data, offset)
    if reader.raw(4) != b'\x01\x00\x00\x00':
        raise ValueError('Signature de table historique invalide')
    key_width, offset_width = reader.uint(), reader.uint()
    count, size = reader.uint(4), reader.uint(4)
    if not 1 <= key_width <= 4 or not 1 <= offset_width <= 4:
        raise ValueError('Largeur historique invalide')
    if count > (reader.end - reader.pos) // (key_width + offset_width):
        raise ValueError('Index historique tronqué')
    rows = [(reader.uint(key_width), reader.uint(offset_width)) for _ in range(count)]
    start, end = reader.pos, reader.pos + size
    if end > len(data):
        raise ValueError('Table historique tronquée')
    keys = [key for key, _ in rows]
    offsets = sorted(set(position for _, position in rows))
    if keys != sorted(set(keys)) or not offsets or offsets[0] != 0 or offsets[-1] >= size:
        raise ValueError('Index historique invalide')
    ends = dict(zip(offsets, offsets[1:] + [size]))
    return [(key, reader_type(data, start + position, start + ends[position])) for key, position in rows], end


def load_huffman(helper, dictionary):
    raw = helper.arm64_bytes()
    with tempfile.TemporaryDirectory(prefix='finition-historique-') as temporary:
        binary = Path(temporary) / 'LibLingFR.arm64'
        binary.write_bytes(raw)
        code = helper.instructions(binary, 0x288b20, 0x28fb4c)
    tree, paths, count, _ = helper.reconstruct(raw, code)
    if paths != helper.embedded_codes(code):
        raise ValueError('Les arbres Huffman et les codes inverses ne correspondent pas')
    decoder = dictionary.Huffman.__new__(dictionary.Huffman)
    decoder.nodes = []

    def node(branch):
        index = len(decoder.nodes)
        decoder.nodes.append([None, None, None])
        if 'one' in branch:
            decoder.nodes[index] = [node(branch['zero']), node(branch['one']), None]
        else:
            decoder.nodes[index][2] = -1 if branch.get('escape') else branch['codepoint']
        return index

    node(tree)
    return decoder, {
        'binary_sha256': hashlib.sha256(raw).hexdigest(),
        'constructor_start': '0x288b20', 'constructor_end_inclusive': '0x28fb4c',
        'nodes': count, 'codes': paths, 'inverse_codebook_match': True,
        'origin': 'Appel 0x4b0688 du getter 0x288ab0, puis CreeDicoHistorique à 0x4b069c dans LibLingFR arm64.',
    }


def decode(data, reader_type, huffman):
    tables, position = [], 0
    for _ in range(4):
        entries, position = indexed_table(data, position, reader_type)
        tables.append(entries)
    if position != len(data):
        raise ValueError('Octets après la dernière table historique')
    authors, works, quotations, words = {}, {}, {}, {}
    for identifier, reader in tables[0]:
        authors[identifier] = huffman.string(reader)
        reader.done()
    for identifier, reader in tables[1]:
        works[identifier] = {'auteur_id': reader.var(), 'chaines': huffman.strings(reader), 'titre': huffman.string(reader)}
        reader.done()
    for identifier, reader in tables[2]:
        quotations[identifier] = {
            'oeuvre_id': reader.var(),
            'mots': [
                {'drapeau': reader.uint(), 'mot_id': reader.var(), 'position': reader.var(), 'longueur': reader.var(), 'forme': huffman.string(reader)}
                for _ in range(reader.count())
            ],
            'texte': huffman.string(reader),
        }
        reader.done()
    for identifier, reader in tables[3]:
        words[identifier] = {
            'nombre_exemples': reader.var(), 'code_datation': reader.var(),
            'references': [{'siecle': reader.var(), 'exemple_id': reader.var()} for _ in range(reader.count())],
        }
        reader.done()
    for work in works.values():
        if work['auteur_id'] not in authors:
            raise ValueError('Auteur absent')
    for quotation in quotations.values():
        if quotation['oeuvre_id'] not in works:
            raise ValueError('Oeuvre absente')
    unresolved = []
    for word, entry in words.items():
        if entry['nombre_exemples'] != len(entry['references']):
            raise ValueError('Compte de références historique incohérent')
        for reference in entry['references']:
            quotation = quotations.get(reference['exemple_id'])
            if quotation is None:
                unresolved.append({'mot_id': word, **reference})
                continue
            if not any(item['mot_id'] == word for item in quotation['mots']):
                raise ValueError('Citation ne contenant pas le mot référencé')
    return {'langue': 'fr', 'auteurs': authors, 'oeuvres': works, 'exemples': quotations, 'mots': words, 'references_absentes': unresolved}


def display_text(text):
    return re.sub(r'</?(?:r|i|sup|sub)>', '', text).translate(str.maketrans({code: ' ' for code in range(32)}))


def finition(original, lexicon):
    canonical = dict(lexicon['mots'])
    forms = lexicon['formes']
    entries, excluded = {}, []
    for word, history in original['mots'].items():
        if word not in canonical:
            raise ValueError(f'Mot historique absent du lexique : {word}')
        lemma = unicodedata.normalize('NFC', forms[canonical[word]]).replace('’', "'").replace('ʼ', "'").replace('‑', '-').lower()
        parts = lemma.replace('-', "'").split("'")
        if len(lemma) > 200 or not unicodedata.category(lemma[0]).startswith('L') or not all(part and all(unicodedata.category(char)[0] in 'LM' for char in part) for part in parts):
            excluded.append({'mot_id': word, 'forme': forms[canonical[word]]})
            continue
        target = entries.setdefault(lemma, [])
        for reference in history['references']:
            quote = original['exemples'].get(reference['exemple_id'])
            if quote is None:
                continue
            work = original['oeuvres'][quote['oeuvre_id']]
            author = original['auteurs'][work['auteur_id']]
            target.append({'text': display_text(f"{reference['siecle']}e siècle — {author}, {work['titre']}"), 'examples': [display_text(quote['texte'])]})
    return {
        'format': 'finition-dictionnaire', 'version': 1, 'language': 'fr', 'kind': 'historique',
        'name': 'Antidote — historique',
        'description': 'Attestations historiques, regroupées par mot, avec siècle, auteur et œuvre. Source privée Antidote.',
        'source': original['source'],
        'limitations': original['limitations'] + ['Index limité aux mots simples admissibles dans Finition ; les locutions restent dans l’original. Les caractères de contrôle sont remplacés par des espaces et les balises éditoriales r/i/sup/sub retirées dans la conversion.'],
        'entries': dict(sorted(entries.items())),
    }, excluded


def write_result(path, value):
    payload = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != payload:
            raise ValueError(f'Refus de remplacer un fichier différent : {path}')
    else:
        with path.open('xb') as stream:
            stream.write(payload)
    return {'file': str(path.relative_to(ROOT)), 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}


def self_check(reader_type):
    assert display_text('Texte<r>, tome I</r>\n<i>mot</i><sup>e</sup><sub>2</sub>') == 'Texte, tome I mote2'
    sample = struct.pack('<4sBBII', b'\x01\x00\x00\x00', 1, 1, 2, 3) + b'\x01\x00\x02\x01abc'
    rows, end = indexed_table(sample, 0, reader_type)
    assert end == len(sample) and [(key, reader.raw(reader.end - reader.pos)) for key, reader in rows] == [(1, b'a'), (2, b'bc')]
    for malformed in (sample[:-1], sample[:5], sample[:4] + b'\x00' + sample[5:], sample[:14] + b'\x01\x00\x01\x01abc'):
        try:
            indexed_table(malformed, 0, reader_type)
        except ValueError:
            pass
        else:
            raise AssertionError('Une table corrompue doit être rejetée')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--analysis-root', type=Path, default=ANALYSIS_ROOT)
    args = parser.parse_args()
    sys.path.insert(0, str(args.analysis_root))
    import extract_dictionaries as dictionary
    import extract_huffman as helper

    self_check(dictionary.Reader)
    huffman, codebook = load_huffman(helper, dictionary)
    source = RESOURCE_ROOT / 'Grimoire.05.psi'
    data = source.read_bytes()
    original = decode(data, dictionary.Reader, huffman)
    original['source'] = {'file': str(source), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    original['huffman'] = codebook
    original['limitations'] = [
        'Extraction statique du fichier natif : aucun contrôle visuel dans Antidote.',
        'Codes de datation et drapeaux conservés sans interprétation. Les modifications d’affichage historiques (u/v, i/j) ne sont pas appliquées.',
        'Les positions et longueurs des mots sont conservées dans leur unité native ; aucune conversion Unicode ni réindexation.',
        'Données privées Antidote, sans autorisation de redistribution établie.',
        f"{len(original['references_absentes'])} références natives pointent vers un exemple absent de cette ressource ; conservées dans l’original et omises de la conversion.",
    ]
    lexicon = json.loads((ROOT / 'Antidote/dictionnaires/originaux/dictionnaire.json').read_text())
    converted, excluded = finition(original, lexicon)
    citations = {
        **converted, 'kind': 'citations', 'name': 'Antidote — citations historiques',
        'description': 'Citations historiques : sous-ensemble des attestations natives, avec siècle, auteur et œuvre. Source privée Antidote, distincte du corpus Combi.',
        'entries': {word: [{'label': row['text'], 'text': row['examples'][0]} for row in rows] for word, rows in converted['entries'].items()},
    }
    report = {
        'verification': 'PASS: quatre tables contiguës jusqu’à EOF, chaque entrée entièrement consommée, liens auteur/œuvre et mots des citations présentes vérifiés, références absentes recensées, comptes de références, arbre Huffman et table inverse identiques, index corrompus rejetés.',
        'counts': {key: len(original[key]) for key in ('auteurs', 'oeuvres', 'exemples', 'mots')},
        'finition_entries': len(converted['entries']),
        'finition_records': sum(len(records) for records in converted['entries'].values()),
        'unresolved_references': original['references_absentes'],
        'unindexed_multiword_or_invalid_forms': excluded,
        'outputs': [
            write_result(ROOT / 'Antidote/dictionnaires/originaux/historique-antidote-original.json', original),
            write_result(ROOT / 'Antidote/dictionnaires/finition/historique-antidote-finition.json', converted),
            write_result(ROOT / 'Antidote/dictionnaires/finition/citation-antidote-finition.json', citations),
        ],
    }
    write_result(ROOT / 'Antidote/dictionnaires/preuves/historique-extraction.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
