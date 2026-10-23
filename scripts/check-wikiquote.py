import runpy
import bz2
import tempfile
from pathlib import Path

module = runpy.run_path(str(Path(__file__).with_name('wikiquote.py')))
plain, author_rows = module['plain'], module['author_rows']
assert plain("''Les'' [[chat|chats]] {{w|courir|courent}}.<br/>Encore.") == 'Les chats courent. Encore.'
assert plain('{{personnage|Scapin}} : {{nobr|un mot}}') == 'Scapin : un mot'
assert plain('{{modèle inconnu|citation}}') == ''
assert plain('Texte <ref name="a">Annotation moderne.</ref> sûr.') == 'Texte sûr.'
assert plain('Texte &amp; suite.') == 'Texte & suite.'
source = '''{{Citation|citation=Les [[chat|chats]] {{w|courir|courent}}.}}
{{Réf Livre|auteur=Victor Hugo|titre=Un {{w|livre}}|année=1862|éditeur=Ancien éditeur|page=2}}
'''
expected = {'label': 'Victor Hugo, Un livre, 1862, Ancien éditeur, p. 2, https://fr.wikiquote.org/w/index.php?oldid=123', 'text': 'Les chats courent.'}
assert list(author_rows('Victor Hugo', '123', source)) == [expected]
assert list(author_rows('Victor Hugo', '123', '<!--' + source + '-->')) == []
assert list(author_rows('Victor Hugo', '123', '<nowiki>' + source + '</nowiki>')) == []
assert list(author_rows('Victor Hugo', '123', '<!--' + source + '-->' + source)) == [expected]
for invalid in [source.replace('1862', '2020'), source.replace('Victor Hugo|titre', 'Auteur récent|titre'),
                source.replace('|page=2', '|traducteur=Un traducteur|page=2'),
                source.replace('|citation=', '|langue=en|citation='),
                source.replace('|citation=', '|précisions=Remaniement|citation='),
                source.replace('\n{{Réf', '\n== Autre section ==\n{{Réf'),
                source.replace('|année=1862', ''), source.replace('|titre=Un {{w|livre}}', ''),
                source.replace('|auteur=Victor Hugo', ''), source.replace('{{w|courir|courent}}', '{{inconnu|texte}}')]:
    assert list(author_rows('Victor Hugo', '123', invalid)) == [], invalid
assert list(author_rows('Victor Hugo', '123', source + source)) == [expected, expected]
assert list(author_rows('Victor Hugo', '123', source.replace('\n{{Réf', '\n{{Citation|autre}}\n{{Réf'))) == [{**expected, 'text': 'autre'}]
accept = module['public_reference']
authors = {'Victor Hugo', 'George Sand'}
assert accept('George Sand, La Mare au diable, 1846', authors)
for invalid in ['George Sand, La Mare au diable', 'George Sand, La Mare au diable, 1846, édition 2020',
                'George Sand, La Mare au diable, traduit par X, 1846', 'Auteur récent, Livre, 1846',
                'George Sand, , 1846', 'George Sand, Livre cité par X, 1846']:
    assert not accept(invalid, authors), invalid
xml = f'''<mediawiki xmlns="{module['NS'][1:-1]}">
<page><title>Victor Hugo</title><ns>0</ns><revision><id>123</id><text><![CDATA[{source}
[[Catégorie:Décès en 1885]][[Catégorie:Romancier français]]]]></text></revision></page>
<page><title>Auteur moderne</title><ns>0</ns><revision><id>124</id><text><![CDATA[{source}
[[Catégorie:Décès en 2020]][[Catégorie:Romancier français]]]]></text></revision></page>
<page><title>Autre auteur</title><ns>0</ns><revision><id>125</id><text><![CDATA[{source}
[[Catégorie:Décès en 1885]][[Catégorie:Romancier anglais]]]]></text></revision></page>
</mediawiki>'''
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'quotes.xml.bz2'
    path.write_bytes(bz2.compress(xml.encode()))
    assert module['extract'](path) == ({'Victor Hugo': 1885}, [expected])
    query = module['bnf_query'](path)
    assert '"Victor Hugo"' in query and '"Autre auteur"' in query and '"Auteur moderne"' not in query
    try:
        module['read_bnf'](path)
    except ValueError as error:
        assert 'Empreinte du snapshot BnF' in str(error)
    else:
        raise AssertionError('Un snapshot BnF altéré doit être refusé avant lecture')
assert module['free_author'](1955)
assert not module['free_author'](1956)
assert module['free_author'](1925, True)
assert not module['free_author'](1926, True)
assert module['free_publication'](2000)
assert not module['free_publication'](2001)
assert module['free_publication'](2020, 1955)
assert not module['free_publication'](2026, 1955)
assert list(author_rows('Victor Hugo', '123', source.replace('1862', '1955')))
assert list(author_rows('Victor Hugo', '123', source.replace('|année=1862', "|année=2020|année d'origine=1862")))
assert list(author_rows('Victor Hugo', '123', source.replace('|année=1862', "|année=1862|année d'origine="))) == [expected]
assert list(author_rows('Victor Hugo', '123', source.replace('|année=1862', "|année=1862|année d'origine=~1780-1824"))) == [expected]
assert accept('Colette, La Vagabonde, 1910', {'Colette': 1954})
assert accept('Colette, La Vagabonde, 2020', {'Colette': 1954})
assert not accept('Colette, Texte posthume, 2026', {'Colette': 1954})
rights = module['bnf_rights']({'results': {'bindings': [
    {'person': {'value': 'https://data.bnf.fr/test-traducteur'}, 'name': {'value': 'Traducteur ancien'},
     'death': {'value': 'http://data.bnf.fr/date/1885/'}, 'language': {'value': 'http://id.loc.gov/vocabulary/iso639-2/fre'}},
    {'person': {'value': 'https://data.bnf.fr/test-recent'}, 'name': {'value': 'Traducteur récent'},
     'death': {'value': 'http://data.bnf.fr/date/2000/'}, 'language': {'value': 'http://id.loc.gov/vocabulary/iso639-2/fre'}},
    {'person': {'value': 'https://data.bnf.fr/test-mpf'}, 'name': {'value': 'Victor Hugo'},
     'death': {'value': 'http://data.bnf.fr/date/1944/'}, 'language': {'value': 'http://id.loc.gov/vocabulary/iso639-2/fre'}, 'mpf': {'value': 'true'}},
    {'person': {'value': 'https://data.bnf.fr/test-francophone'}, 'name': {'value': 'Autre auteur'},
     'death': {'value': 'http://data.bnf.fr/date/1885/'}, 'language': {'value': 'http://id.loc.gov/vocabulary/iso639-2/fre'}}]}})
translated = source.replace('|page=2', '|traducteur=Traducteur ancien|page=2')
assert list(author_rows('Victor Hugo', '123', translated, french=False, rights=rights))
assert not list(author_rows('Victor Hugo', '123', source, french=False, rights=rights))
assert not list(author_rows('Victor Hugo', '123', translated.replace('ancien', 'récent'), french=False, rights=rights))
assert not list(author_rows('Victor Hugo', '123', translated.replace('ancien', 'inconnu'), french=False, rights=rights))
assert not list(author_rows('Victor Hugo', '123', translated.replace('1862', '2020'), french=False, rights=rights))
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'quotes.xml.bz2'
    path.write_bytes(bz2.compress(xml.replace('1885', '1944').encode()))
    assert 'Victor Hugo' not in module['extract'](path, rights)[0], 'La BnF doit exclure une prorogation même absente du texte Wikiquote'
    path.write_bytes(bz2.compress(xml.replace('1885', '1955').encode()))
    assert module['extract'](path)[0]['Victor Hugo'] == 1955
    path.write_bytes(bz2.compress(xml.replace('1885', '1956').encode()))
    assert 'Victor Hugo' not in module['extract'](path)[0]
    path.write_bytes(bz2.compress(xml.encode()))
    assert 'Autre auteur' in module['extract'](path, rights)[0], 'La langue française doit permettre les auteurs étrangers'
    path.write_bytes(bz2.compress(xml.replace('Romancier français', 'Romancière française').encode()))
    assert module['extract'](path)[0]['Victor Hugo'] == 1885, 'Les catégories féminines doivent aussi être reconnues'
print('PASS: Wikiquote, sources, langues, décès 1955/1956, morts pour la France, traductions et publications posthumes')
