"""Merge public analyses with statically decoded private morphology."""

import base64
import gzip
import hashlib
import json
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / 'Antidote/dictionnaires'


def word_key(value):
    return unicodedata.normalize('NFC', value).replace('’', "'").replace('\u00ad', '').lower()


def valid_word(value):
    return (isinstance(value, str) and 0 < len(value) <= 200 and value == value.strip()
            and any(char.isalpha() for char in value)
            and all(unicodedata.category(char)[0] in 'LMN' or char in " '-’" for char in value))


def unpack(value):
    return json.loads(gzip.decompress(base64.b64decode(value)))


def pack(value):
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return base64.b64encode(gzip.compress(raw, compresslevel=9, mtime=0)).decode('ascii')


def category_name(label):
    if label in ('nom', 'nom propre', 'verbe', 'adjectif', 'préposition', 'interjection', 'nombre'):
        return label
    for prefix in ('adverbe', 'déterminant', 'pronom', 'conjonction'):
        if label == prefix or label.startswith(prefix + ' '):
            return prefix
    return {'particule adverbiale': 'adverbe', 'expression adverbiale': 'adverbe',
            'adjectif exclamatif': 'adjectif', 'adjectif interrogatif': 'adjectif',
            'adjectif adverbial': 'adjectif', 'numéral cardinal': 'nombre',
            'numéral ordinal': 'nombre', 'auxiliaire': 'verbe'}.get(label, '')


def features(label):
    if label in ('ms', 'mp', 'fs', 'fp'):
        return label[0], label[1], ''
    if label in ('Inf', 'ParPr'):
        return '', '', {'Inf': 'inf', 'ParPr': 'par:pre'}[label]
    match = re.fullmatch(r'ParPa([MF])([SP])', label)
    if match:
        return match[1].lower(), match[2].lower(), 'par:pas'
    match = re.fullmatch(r'(Ind|Sub|Con)(Pr|Im|Fu|Pa)([123])([SP])', label)
    if match:
        mode = {'Ind': 'ind', 'Sub': 'sub', 'Con': 'cnd'}[match[1]]
        tense = {'Pr': 'pre', 'Im': 'imp', 'Fu': 'fut', 'Pa': 'pas'}[match[2]]
        return '', match[4].lower(), f'{mode}:{tense}:{match[3]}{match[4].lower()}'
    match = re.fullmatch(r'Imp([123])([SP])', label)
    if match:
        return '', match[2].lower(), f'imp:pre:{match[1]}{match[2].lower()}'
    # Euphonic inversion forms require a context flag absent from the shared schema.
    return '', '', ''


def enrich(forms, native, public_rows, codes):
    known_pairs = {(word_key(row[0]), word_key(row[1])) for row in public_rows}
    known_analyses = {(*row[:5], inflection) for row in public_rows for inflection in row[5].split(';')}
    word_categories = {identifier: codes['categories'].get(str(category), '')
                       for identifier, category, _frequency, _rank in codes['words']}
    additions = set()
    for entry in native:
        lemma = forms[entry['canonical_form_id']]
        if not valid_word(lemma):
            continue
        category = category_name(word_categories.get(entry['word_id'], ''))
        identifiers = [(entry['canonical_form_id'], entry['tail'][0])]
        identifiers.extend((item['form_id'], item['kind']) for item in entry['flexions'])
        for variant in entry['variants']:
            identifiers.append((variant['form_id'], variant['kind']))
            identifiers.extend((item['form_id'], item['kind']) for item in variant['flexions'])
        for identifier, kind in identifiers:
            form = forms[identifier]
            if not valid_word(form):
                continue
            gender, number, inflection = features(codes['flexions'].get(str(kind), ''))
            if category != 'verbe':
                inflection = ''
            if not category and (word_key(form), word_key(lemma)) in known_pairs:
                continue
            analysis = (form, lemma, category, gender, number, inflection)
            if analysis not in known_analyses:
                additions.add((*analysis, 0))
    return sorted(additions)


def self_check():
    forms = ['inventer', 'inventons', 'inventez', 'autre', 'invalide\x00']
    native = [{'word_id': 1, 'canonical_form_id': 0, 'tail': [63],
               'flexions': [{'form_id': 1, 'kind': 24}, {'form_id': 4, 'kind': 24}],
               'variants': [{'form_id': 2, 'kind': 25, 'flexions': []}]}]
    codes = {'categories': {'151': 'verbe'}, 'words': [[1, 151, 40, 6]],
             'flexions': {'24': 'IndPr1P', '25': 'IndPr2P', '63': 'Inf'}}
    known = [['inventons', 'inventer', 'verbe', '', 'p', 'ind:pre:1p', 1]]
    rows = enrich(forms, native, known, codes)
    assert [row[:2] for row in rows] == [('inventer', 'inventer'), ('inventez', 'inventer')]
    assert rows[0][2:6] == ('verbe', '', '', 'inf')
    assert rows[1][2:6] == ('verbe', '', 'p', 'ind:pre:2p')
    assert features('ParPaFP') == ('f', 'p', 'par:pas')
    assert features('ConPr3P') == ('', 'p', 'cnd:pre:3p')
    assert features('IndPa2S') == ('', 's', 'ind:pas:2s')
    assert features('Imp1P') == ('', 'p', 'imp:pre:1p')
    assert features('EuIndPr') == features('inconnu') == ('', '', '')
    assert category_name('pronom relatif') == 'pronom'
    assert category_name('gentilé') == category_name('segment de phrase') == ''
    unknown = enrich(forms, native, [], {**codes, 'categories': {}})
    assert unknown[0][2:6] == ('', '', '', '')
    assert all(row[5] == '' for row in unknown)
    assert unpack(pack({'entries': rows}))['entries'][0][:2] == ['inventer', 'inventer']
    assert word_key('L’ŒIL') == "l'œil" and not valid_word('invalide\x00')


def main():
    self_check()
    source = ROOT / 'resources/lexique/finition-dictionnaire.json'
    public = json.loads(source.read_text(encoding='utf-8'))
    lexical = unpack(public['payload'])
    grammar = unpack(public['grammalectePayload'])
    exported = json.loads((PRIVATE / 'dictionnaire.json').read_text(encoding='utf-8'))
    assert exported['formIdBase'] == 0 and exported['langue'] == 'fr'
    native = json.loads((PRIVATE / 'morphologie.json').read_text(encoding='utf-8'))
    codes = json.loads((PRIVATE / 'morphologie-codes.json').read_text(encoding='utf-8'))
    assert {row['word_id']: row['canonical_form_id'] for row in native['entrees']} == dict(exported['mots'])
    assert {row[0] for row in codes['words']} == dict(exported['mots']).keys()
    additions = enrich(exported['formes'], native['entrees'], lexical['entries'], codes)
    del native
    lexical['entries'].extend(additions)
    known = {row[0] for row in lexical['entries']} | set(lexical['forms'])
    extra_forms = sorted({form for form in exported['formes'] if valid_word(form)} - known)
    lexical['forms'].extend(extra_forms)
    grammar['forms'].extend(extra_forms)
    extras = dict(grammar['extras'])
    variants = {word_key(form) for form, _mask in lexical['variants']}
    tags = {'nom': 'N', 'adjectif': 'A', 'adverbe': 'W', 'préposition': 'R', 'interjection': 'J', 'nombre': 'B'}
    for row in additions:
        if word_key(row[0]) not in variants:
            form = unicodedata.normalize('NFC', row[0]).replace('’', "'")
            values = extras.setdefault(form, [])
            tag = tags.get(row[2])
            if tag:
                morphology = f'>{row[1]}/:' + ':'.join(value for value in [tag, row[3], row[4]] if value)
                if morphology not in values:
                    values.append(morphology)
    grammar['extras'] = sorted(extras.items())
    hashes = {name: hashlib.sha256((PRIVATE / name).read_bytes()).hexdigest()
              for name in ['dictionnaire.json', 'morphologie.json', 'morphologie-codes.json']}
    value = {**public, 'format': 'finition-dictionnaire', 'name': 'Antidote',
             'description': 'Lexique privé : lemmes, catégories et flexions décodés, enrichis de Morphalou, Lexique et Grammalecte.',
             'documentation': '',
             'license': {**public['license'], 'antidote': 'Données privées extraites ; aucune autorisation de redistribution fournie.'},
             'sources': {**public['sources'], 'antidote': {'name': 'Antidote', 'files': hashes,
                         'morphology': 'Catégories et types de flexion lus statiquement ; codes et libellés conservés dans morphologie-codes.json.',
                         'binarySha256': codes['binary_sha256'], 'sourceSha256': codes['source_sha256']}},
             'inputs': {'finition': hashlib.sha256(source.read_bytes()).hexdigest(), **hashes},
             'counts': {'analyses': len(lexical['entries']), 'morphologicalForms': len({row[0] for row in lexical['entries']}),
                        'additionalForms': len(lexical['forms']), 'nativeAdditionalAnalyses': len(additions),
                        'nativeCategorizedAnalyses': sum(bool(row[2]) for row in additions),
                        'nativeVerbAnalyses': sum(bool(row[5]) for row in additions)},
             'limitations': ['Les catégories spécialisées sans équivalent commun restent vides ; les analyses publiques sont conservées.',
                             'Les flexions euphoniques d’inversion ne fournissent aucun temps sans leur contexte.',
                             'Les marques d’usage, fréquences natives, valences et groupes verbaux ne sont pas traduits.'],
             'payload': pack(lexical), 'grammalectePayload': pack(grammar)}
    encoded = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    assert len(encoded) <= 128 * 1024 * 1024
    destination = PRIVATE / 'finition-lexique.json'
    previous = destination.read_bytes() if destination.exists() else None
    if previous != encoded:
        if previous is not None:
            old = json.loads(previous)
            assert old.get('name') == 'Antidote' and old.get('inputs', {}).get('dictionnaire.json') == hashes['dictionnaire.json'], 'Lexique existant non reconnu'
            backup = PRIVATE / f'finition-lexique-{hashlib.sha256(previous).hexdigest()[:16]}.json'
            if backup.exists():
                assert backup.read_bytes() == previous, 'Sauvegarde différente'
            else:
                with backup.open('xb') as stream:
                    stream.write(previous)
        temporary = PRIVATE / 'finition-lexique.pending.json'
        with temporary.open('xb') as stream:
            stream.write(encoded)
        temporary.replace(destination)
    print(json.dumps({'file': str(destination.relative_to(ROOT)), 'bytes': len(encoded), **value['counts']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
