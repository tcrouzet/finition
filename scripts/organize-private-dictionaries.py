"""Move private exports without changing bytes; retain a reversible SHA-256 manifest."""

import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / 'Antidote/dictionnaires'
ORIGINALS = ('dictionnaire', 'morphologie', 'morphologie-codes', 'definitions', 'synonymes',
             'antonymes', 'phonetique', 'rimes', 'huffman-definitions', 'huffman-synonymes',
             'huffman-phonetique', 'rea-huffman', 'rea-libling', 'rapport-extraction')
CONVERTED = {
    'finition-lexique.json': 'lexique-antidote-finition.json',
    'finition-definitions.json': 'definition-antidote-finition.json',
    'finition-antonymes.json': 'antonyme-antidote-finition.json',
    'finition-phonetique.json': 'phonetique-antidote-finition.json',
    'finition-rimes.json': 'rime-antidote-finition.json',
    'finition-synonymes-details.json': 'synonyme-antidote-finition.json',
    'finition-synonymes.json': 'synonyme-antidote-finition-sans-details.json',
}


def fingerprint(path):
    if not path.is_file() or path.is_symlink():
        raise ValueError(f'Fichier ordinaire attendu : {path}')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return {'bytes': path.stat().st_size, 'sha256': digest.hexdigest()}


def organize(root, check=False):
    paths = {f'{name}.json': f'originaux/{name}.json' for name in ORIGINALS}
    paths.update({source: f'finition/{destination}' for source, destination in CONVERTED.items()})
    archives = {'finition-dictionnaire-legacy.json'}
    for folder in (root, root / 'archives'):
        if folder.exists():
            archives.update(path.name for path in folder.glob('finition-lexique-*.json')
                            if re.fullmatch(r'finition-lexique-[a-f0-9]{16}\.json', path.name))
    paths.update({name: f'archives/{name}' for name in sorted(archives)})
    entries = []
    for source, destination in sorted(paths.items()):
        old, new = root / source, root / destination
        if old.exists() and new.exists():
            raise ValueError(f'Collision : {source} et {destination} ; aucun remplacement autorisé.')
        current = old if old.exists() else new
        entries.append({'from': source, 'to': destination, **fingerprint(current)})
    preserved = {'path': 'finition-personnel.json', 'reason': 'Complément de provenance non établie ; chemin runtime conservé.',
                 **fingerprint(root / 'finition-personnel.json')}
    manifest = {'format': 'finition-private-layout', 'version': 1, 'moves': entries, 'preserved': [preserved],
                'notes': ['Les originaux et les conversions sont déplacés sans changer leurs octets.',
                          'synonyme-antidote-finition.json conserve la version détaillée avec sens et registres.',
                          'synonyme-antidote-finition-sans-details.json conserve aussi la version simple : elle possède des entrées propres.',
                          'Les archives conservent leur nom et leur provenance historique ; leur emplacement ne constitue pas une attribution à Antidote.']}
    manifest_path = root / 'organisation.json'
    if manifest_path.exists():
        if json.loads(manifest_path.read_text(encoding='utf-8')) != manifest:
            raise ValueError('Le manifeste existant diffère des fichiers présents ; aucun déplacement effectué.')
    elif check:
        raise ValueError('Manifeste de conservation absent.')
    else:
        with manifest_path.open('x', encoding='utf-8') as stream:
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    moved = 0
    for entry in entries:
        old, new = root / entry['from'], root / entry['to']
        if old.exists():
            if check:
                raise ValueError(f'Déplacement non effectué : {entry["from"]}')
            new.parent.mkdir(exist_ok=True)
            if new.exists() or fingerprint(old) != {key: entry[key] for key in ('bytes', 'sha256')}:
                raise ValueError(f'Fichier modifié pendant la préparation : {entry["from"]}')
            old.rename(new)
            moved += 1
        if fingerprint(new) != {key: entry[key] for key in ('bytes', 'sha256')}:
            raise ValueError(f'Conservation invalide : {entry["to"]}')
    return {'result': 'PASS', 'moved': moved, 'verified': len(entries),
            'bytesPreserved': sum(entry['bytes'] for entry in entries) + preserved['bytes'],
            'manifest': str(manifest_path)}


def self_check():
    with tempfile.TemporaryDirectory(prefix='finition-private-layout-') as temporary:
        root = Path(temporary)
        names = [f'{name}.json' for name in ORIGINALS] + list(CONVERTED) + ['finition-dictionnaire-legacy.json', 'finition-personnel.json']
        for name in names:
            (root / name).write_bytes(name.encode('utf-8'))
        (root / 'originaux').mkdir()
        collision = root / 'originaux/dictionnaire.json'
        collision.write_bytes(b'collision')
        try:
            organize(root)
        except ValueError as error:
            assert 'Collision' in str(error)
        else:
            raise AssertionError('Collision non rejetée')
        assert not (root / 'organisation.json').exists() and all((root / name).exists() for name in names)
        collision.rename(root / 'temoin-collision.json')
        first = organize(root)
        assert first['moved'] == len(names) - 1 and organize(root)['moved'] == 0
        assert organize(root, check=True)['verified'] == first['verified']
        assert (root / 'finition-personnel.json').read_bytes() == b'finition-personnel.json'
        (root / 'originaux/dictionnaire.json').write_bytes('altéré'.encode('utf-8'))
        try:
            organize(root, check=True)
        except ValueError as error:
            assert 'manifeste' in str(error)
        else:
            raise AssertionError('Altération non rejetée')


if __name__ == '__main__':
    if sys.argv[1:] not in ([], ['--check']):
        raise SystemExit('Usage : organize-private-dictionaries.py [--check]')
    self_check()
    print(json.dumps(organize(ROOT, check=bool(sys.argv[1:])), ensure_ascii=False))
