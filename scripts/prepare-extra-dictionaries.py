"""Convertit un snapshot Wiktextract français en packs de dictionnaires."""
import gzip
import hashlib
import json
import re
import runpy
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
common = runpy.run_path(str(ROOT / 'scripts/prepare-public-dictionaries.py'))
wikiquote = runpy.run_path(str(ROOT / 'scripts/wikiquote.py'))
key, single_word, text = (common[name] for name in ('key', 'single_word', 'text'))
KINDS = ('conjugaisons', 'historique', 'citations', 'champ-lexical')
SOURCE_HASH = 'a1e04095e6e85e93bb134f947ba3b7c1f07c6f5ccbb454acf518fd9e98dea5a6'
RELATIONS = {'hypernyms': 'Hyperonymes', 'hyponyms': 'Hyponymes', 'holonyms': 'Ensembles',
             'meronyms': 'Parties', 'troponyms': 'Manières de faire'}
# Les exemples modernes du Wiktionnaire ne deviennent pas libres avec ses métadonnées.
WORKS = {'Victor Hugo': {'Les Misérables': '1862', 'Notre-Dame de Paris': '1831'},
         'Gustave Flaubert': {'Madame Bovary': '1857', 'Salammbô': '1862',
                             'L’Éducation sentimentale': '1869', 'Trois Contes': '1877'}}
EXCLUDED_REF = re.compile(r'tradu|adapt|cité|réédit|réimpress|édition moderne|préface|commentaire|revue par', re.I)
TAG_LABELS = {'indicative': 'indicatif', 'subjunctive': 'subjonctif', 'conditional': 'conditionnel',
              'imperative': 'impératif', 'present': 'présent', 'past': 'passé', 'future': 'futur',
              'imperfect': 'imparfait', 'participle': 'participe', 'infinitive': 'infinitif',
              'first-person': '1re personne', 'second-person': '2e personne', 'third-person': '3e personne',
              'singular': 'singulier', 'plural': 'pluriel', 'masculine': 'masculin', 'feminine': 'féminin'}
TAG_LABELS.update({'gerund': 'gérondif', 'pluperfect': 'plus-que-parfait', 'anterior': 'antérieur',
                   'perfect': 'antérieur', 'multiword-construction': 'composé'})
DESCRIPTIONS = {
    'conjugaisons': 'Formes verbales explicitement extraites du Wiktionnaire ; aucune conjugaison reconstruite.',
    'historique': 'Étymologies du Wiktionnaire ; ne constitue pas un historique exhaustif des attestations.',
    'citations': 'Citations du Wiktionnaire et de Wikiquote ; domaine public français en 2026, décès jusqu’en 1955 inclus selon la règle générale, sans filtre de nationalité.',
    'champ-lexical': 'Relations sémantiques explicites du Wiktionnaire, séparées par type ; couverture partielle, sans inférence.'}


def public_domain_reference(reference):
    if not reference or EXCLUDED_REF.search(reference):
        return False
    normalized = reference.replace('’', "'")
    years = re.findall(r'(?<!\d)(?:1[0-9]{3}|20[0-9]{2})(?!\d)', reference)
    if not years or any(int(year) >= 1900 for year in years):
        return False
    for author, works in WORKS.items():
        if not reference.startswith(author + ', '):
            continue
        for title, year in works.items():
            if normalized.startswith(author + ', ' + title.replace('’', "'") + ',') and year in years:
                return True
    return False


def conjugation_row(label, forms):
    return {'label': ', '.join(TAG_LABELS.get(part, part) for part in label.split(', ')),
            'text': ', '.join(sorted(forms, key=lambda value: (key(value), value)))}


def extract(records, authors=()):
    entries = {kind: {} for kind in KINDS}
    stats = {'records': 0, 'frenchCanonicalRecords': 0, 'excludedExamples': 0}

    def add(kind, word, row):
        if row:
            entries[kind].setdefault(word, {})[json.dumps(row, ensure_ascii=False, sort_keys=True)] = row

    for record in records:
        stats['records'] += 1
        if record.get('lang_code') != 'fr' or not single_word(record.get('word')):
            continue
        senses = record.get('senses', [])
        if 'form-of' in record.get('tags', []) or senses and all(s.get('form_of') or 'form-of' in s.get('tags', []) for s in senses):
            continue
        stats['frenchCanonicalRecords'] += 1
        word = key(record['word'])
        category = text(record.get('pos_title'), 1000)
        for etymology in record.get('etymology_texts', []):
            value = text(etymology, 20000)
            if value:
                add('historique', word, {'label': category or 'Étymologie', 'text': value})
        if record.get('pos') == 'verb':
            grouped = {}
            for form in record.get('forms', []):
                value = text(form.get('form'), 200)
                tags = form.get('tags', [])
                if not value or value in ('—', '-') or 'error-unrecognized-form' in tags:
                    continue
                label = ', '.join(TAG_LABELS.get(tag, tag) for tag in tags)
                raw_tags = [raw for tag in form.get('raw_tags', []) if (raw := text(tag, 100))]
                label = text(', '.join(filter(None, (label, ', '.join(raw_tags)))), 1000) or 'Forme attestée'
                grouped.setdefault(label, set()).add(value)
            for label, forms in grouped.items():
                add('conjugaisons', word, conjugation_row(label, forms))
        for relation, label in RELATIONS.items():
            groups = {}
            for item in record.get(relation, []):
                candidate = text(item.get('word'), 200)
                if candidate and key(candidate) != word:
                    sense = text(item.get('sense'), 800)
                    groups.setdefault(label + (' — ' + sense if sense else ''), {})[key(candidate)] = candidate
            for label, words in groups.items():
                add('champ-lexical', word, {'label': label, 'words': sorted(words.values(), key=key)})
        for sense in senses:
            for example in sense.get('examples', []):
                reference = text(example.get('ref'), 1000)
                quote = text(example.get('text'), 20000)
                if quote and (public_domain_reference(reference) or wikiquote['public_reference'](reference, authors)):
                    add('citations', word, {'label': reference, 'text': quote})
                else:
                    stats['excludedExamples'] += 1
    return {kind: {word: list(rows.values()) for word, rows in sorted(words.items())}
            for kind, words in entries.items()}, stats


def document(kind, entries, source_hash):
    license_data = {**common['LICENSE'], 'sha256': source_hash,
                    'revision': 'frwiktionary-20261001 ; extraction 2026-10-20 ; wiktextract c1bb342 / wikitextprocessor 6f96ddf',
                    'changes': DESCRIPTIONS[kind] + ' Clés françaises canoniques à un mot, normalisation NFC, dédoublonnage ; références et types explicites conservés.'}
    if kind == 'citations':
        license_data.update({
            'attribution': common['LICENSE']['attribution'] + ' Contributeurs de Wikiquote francophone ; lien vers la révision de chaque page importée. Métadonnées biographiques de data.bnf.fr (BnF, Licence ouverte).',
            'source': 'https://fr.wikiquote.org/', 'download': wikiquote['SOURCE_URL'], 'sha256': wikiquote['SOURCE_HASH'],
            'revision': license_data['revision'] + ' ; frwikiquote-20261001 ; Wiktextract SHA-256 ' + source_hash + ' ; BnF 2026-10-23 SHA-256 ' + wikiquote['BNF_SOURCE_HASH'],
            'changes': DESCRIPTIONS[kind] + ' Dates de décès Wikiquote croisées avec langues et mentions mort pour la France de la BnF ; traductions admises avec traducteur identifié et droits vérifiables. Publications posthumes tardives soumises à 25 ans. Balisage retiré, espaces normalisés, doublons écartés. Sélection automatisée, sans certification juridique individuelle ni garantie hors de France.'})
    return {'format': 'finition-dictionnaire', 'version': 1, 'language': 'fr', 'kind': kind,
            'name': 'Finition', 'description': DESCRIPTIONS[kind],
            'documentation': 'https://github.com/tcrouzet/finition/blob/main/doc/dictionnaires.md',
            'license': license_data, 'entries': entries}


def preserves_citations(previous, current):
    return (previous.get('format') == current['format'] and previous.get('version') == current['version']
            and previous.get('kind') == current['kind'] == 'citations'
            and previous.get('language') == current['language']
            and isinstance(previous.get('entries'), dict)
            and all(isinstance(rows, list) and all(row in current['entries'].get(word, []) for row in rows)
                    for word, rows in previous['entries'].items()))


def main():
    source = Path(sys.argv[1])
    with source.open('rb') as stream:
        source_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    if source_hash != SOURCE_HASH:
        raise ValueError('Empreinte du snapshot Wiktextract différente de la version épinglée')
    quote_source = Path(sys.argv[2])
    with quote_source.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != wikiquote['SOURCE_HASH']:
            raise ValueError('Empreinte du snapshot Wikiquote différente de la version épinglée')
    rights = wikiquote['read_bnf'](Path(sys.argv[3]))
    authors, quotes = wikiquote['extract'](quote_source, rights)
    with gzip.open(source, 'rt', encoding='utf-8') as stream:
        dictionaries, stats = extract((json.loads(line) for line in stream if line.strip()), authors)
    citations = dictionaries['citations']
    seen = {json.dumps(row, ensure_ascii=False, sort_keys=True) for rows in citations.values() for row in rows}
    added = 0
    for row in quotes:
        identity = json.dumps(row, ensure_ascii=False, sort_keys=True)
        if identity in seen:
            continue
        words = re.findall(r'[^\W\d_]+', row['text'], re.UNICODE)
        if not words:
            continue
        word = key(words[0])
        citations.setdefault(word, []).append(row)
        seen.add(identity)
        added += 1
    dictionaries['citations'] = dict(sorted(citations.items()))
    stats.update({'eligibleFrancophoneAuthors': len(authors), 'wikiquoteAdded': added})
    outputs = {}
    for kind, entries in dictionaries.items():
        raw = (json.dumps(document(kind, entries, source_hash), ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        if (not entries or len(raw) > 128 * 1024 * 1024 or len(entries) > 1200000
                or any(len(rows) > 2048 or any(len(row.get('words', [])) > 2048 or len(row.get('text', '')) > 20000 for row in rows) for rows in entries.values())):
            raise ValueError(f'Dictionnaire vide ou hors limites : {kind}')
        folder = ROOT / 'resources' / kind
        outputs[folder / f'{kind}.json'] = raw
        outputs[folder / 'CC-BY-SA-4.0.txt'] = (ROOT / 'resources/definitions/CC-BY-SA-4.0.txt').read_bytes()
    replacements = set()
    # L'enrichissement des citations conserve chaque ligne déjà distribuée.
    for path, raw in outputs.items():
        if path.exists() and path.read_bytes() != raw:
            if path.name != 'citations.json' or not preserves_citations(json.loads(path.read_bytes()), json.loads(raw)):
                raise ValueError(f'Fichier existant différent : {path}')
            replacements.add(path)
    for path, raw in outputs.items():
        if path in replacements:
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
                temporary.write(raw)
            Path(temporary.name).replace(path)
        else:
            common['write'](path, raw)
    print(json.dumps({'sourceSha256': source_hash, **stats,
                      'dictionaries': {kind: {'entries': len(entries), 'rows': sum(map(len, entries.values())),
                                             'bytes': len(outputs[ROOT / 'resources' / kind / f'{kind}.json'])}
                                       for kind, entries in dictionaries.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
