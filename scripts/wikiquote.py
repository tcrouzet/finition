import bz2
import html
import hashlib
import json
import re
import unicodedata
import xml.etree.ElementTree as ET

SOURCE_URL = 'https://dumps.wikimedia.org/frwikiquote/20261001/frwikiquote-20261001-pages-articles.xml.bz2'
SOURCE_HASH = '562a895c4c01fa75daaf8a0f7e1876b41f1e7d5a1961df47927fb570720860e4'
BNF_SOURCE_HASH = '46874982bb3cf753ebd8daf9fe88f470f85e30dcaa9089a96d0625d46573bf9c'
REFERENCE_YEAR = 2026
NS = '{http://www.mediawiki.org/xml/export-0.11/}'
WRITERS = re.compile(r'\[\[Catégorie:(?:Poète|Poétesse|Romancier|Romancière|Écrivain|Écrivaine|Dramaturge|Philosophe|Moraliste) françai(?:s|se)')


def normalize(value):
    return unicodedata.normalize('NFC', ' '.join(value.split())).replace('’', "'").casefold()


def read_bnf(source):
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != BNF_SOURCE_HASH:
        raise ValueError('Empreinte du snapshot BnF différente de la version épinglée')
    return bnf_rights(json.loads(raw))


def bnf_rights(document):
    people = {}
    for row in document['results']['bindings']:
        identity = (normalize(row['name']['value']), row['person']['value'])
        person = people.setdefault(identity, {'deaths': set(), 'french': False, 'mpf': False})
        death = re.search(r'/date/(-?\d+)/$', row.get('death', {}).get('value', ''))
        if death:
            person['deaths'].add(int(death[1]))
        person['french'] |= row.get('language', {}).get('value', '').endswith('/fre')
        person['mpf'] |= row.get('mpf', {}).get('value') in ('1', 'true')
    result = {}
    for (name, _), person in people.items():
        result.setdefault(name, []).append(person)
    return result


def free_author(death, mpf=False):
    return death + (100 if mpf else 70) < REFERENCE_YEAR


def free_publication(year, death=0):
    # Une première publication posthume tardive bénéficie de 25 années propres.
    return year < REFERENCE_YEAR and (year <= death + 70 or year + 25 < REFERENCE_YEAR)


def bnf_query(source):
    names = set()
    with bz2.open(source, 'rb') as stream:
        for _, page in ET.iterparse(stream, events=('end',)):
            if page.tag != NS + 'page':
                continue
            value = page.findtext(NS + 'revision/' + NS + 'text') or ''
            death = re.search(r'\[\[Catégorie:Décès en (\d+)\]\]', value)
            if page.findtext(NS + 'ns') == '0' and death and free_author(int(death[1])):
                names.add(page.findtext(NS + 'title'))
                for _, _, content in templates(value):
                    name, args = parameters(content)
                    if name == 'réf livre':
                        names.update(plain(v) for k, v in args.items() if 'traduc' in k and plain(v))
            page.clear()
    values = ' '.join(json.dumps(name, ensure_ascii=False) for name in sorted(names))
    return ('PREFIX foaf: <http://xmlns.com/foaf/0.1/> PREFIX rdagr2: <http://rdvocab.info/ElementsGr2/> '
            'PREFIX bnf: <http://data.bnf.fr/ontology/bnf-onto/> '
            'SELECT DISTINCT ?person ?name ?death ?language ?mpf WHERE { VALUES ?name {' + values + '} '
            '{ ?person foaf:name ?name } UNION { ?person foaf:familyName ?name } '
            'OPTIONAL { ?person rdagr2:dateOfDeath ?death } OPTIONAL { ?person rdagr2:languageOfThePerson ?language } '
            'OPTIONAL { ?person bnf:mortPourLaFrance ?mpf } } ORDER BY ?name ?person ?death ?language')


def templates(value):
    depth = 0
    for match in re.finditer(r'<!--.*?-->|<nowiki\b[^>]*>.*?</nowiki>|\{\{|\}\}', value, re.S | re.I):
        if match[0].startswith('<'):
            continue
        if match[0] == '{{':
            if depth == 0:
                start = match.start()
            depth += 1
        elif depth:
            depth -= 1
            if depth == 0:
                yield start, match.end(), value[start + 2:match.start()]


def parameters(value):
    parts, current, depth = [], [], 0
    for token in re.split(r'(\{\{|\}\}|\[\[|\]\]|\|)', value):
        if token in ('{{', '[['):
            depth += 1
        elif token in ('}}', ']]'):
            depth -= 1
        if token == '|' and depth == 0:
            parts.append(''.join(current).strip())
            current = []
        else:
            current.append(token)
    parts.append(''.join(current).strip())
    result, position = {}, 1
    for part in parts[1:]:
        name, separator, content = part.partition('=')
        if separator:
            result[normalize(name)] = content.strip()
        else:
            result[str(position)] = part
            position += 1
    return normalize(parts[0]), result


def plain(value):
    value = re.sub(r'<!--.*?-->|<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>', '', value, flags=re.S | re.I)
    for _ in range(20):
        nested = list(templates(value))
        if not nested:
            break
        for start, end, content in reversed(nested):
            name, args = parameters(content)
            if name in ('w', 'wikt', 's'):
                replacement = args.get('2', args.get('1', ''))
            elif name in ('personnage', 'nobr', 'petites capitales', 'pc', 'sc', 'langue'):
                replacement = args.get('2', '') if name == 'langue' else args.get('1', '')
            elif name == 'tab':
                replacement = ' '
            else:
                return ''
            value = value[:start] + replacement + value[end:]
    if '{{' in value or '}}' in value:
        return ''
    value = re.sub(r'\[\[([^\[\]]+)\]\]', lambda m: m[1].split('|')[-1], value)
    value = re.sub(r'\[https?://[^\s\]]+\s+([^\]]+)\]', r'\1', value)
    value = re.sub(r'<[^>]*>', ' ', value)
    return unicodedata.normalize('NFC', ' '.join(html.unescape(value.replace("'''", '').replace("''", '')).split()))


def author_rows(author, revision, value, french=True, rights=None, death=0):
    pending = None
    for start, end, content in templates(value):
        name, args = parameters(content)
        if name == 'citation':
            pending = (end, args)
            continue
        if pending is None:
            continue
        if name != 'réf livre':
            pending = None
            continue
        quote_end, quote_args = pending
        pending = None
        # Une source doit suivre immédiatement la citation, dans la même section.
        if value[quote_end:start].strip() or quote_args.get('précisions'):
            continue
        if normalize(plain(args.get('auteur', ''))) != normalize(author):
            continue
        if args.get('auteur de la contribution') and normalize(plain(args['auteur de la contribution'])) != normalize(author):
            continue
        if any(v.strip() for k, v in args.items() if 'adapt' in k):
            continue
        translators = [plain(v) for k, v in args.items() if 'traduc' in k and v.strip()]
        cleared_translation = bool(translators)
        for translator in translators:
            people = (rights or {}).get(normalize(translator), [])
            if not people or any(not person['deaths'] or not person['french'] or any(not free_author(d, person['mpf']) for d in person['deaths']) for person in people):
                cleared_translation = False
        if not cleared_translation and (translators or not french):
            continue
        if quote_args.get('langue', 'fr').strip().lower() != 'fr' and not cleared_translation:
            continue
        year = plain(args.get('année', ''))
        origin = next((plain(args.get(field, '')) for field in ("année d'origine", 'année de la contribution', 'année') if plain(args.get(field, ''))), '')
        dates = re.findall(r'(?<!\d)\d{4}(?!\d)', origin)
        if not dates or any(not free_publication(int(date), death) for date in dates):
            continue
        if cleared_translation and (not re.fullmatch(r'\d{4}', year) or not free_publication(int(year))):
            continue
        title = plain(args.get('titre', ''))
        quote = plain(quote_args.get('citation', quote_args.get('1', '')))
        if not title or not quote or len(quote) > 20000:
            continue
        details = [author, title, year or origin]
        if cleared_translation:
            details.append('traduction : ' + ', '.join(translators))
        for field, prefix in (('éditeur', ''), ('page', 'p. '), ('acte', 'acte '), ('scène', 'scène '), ('vers', 'vers ')):
            detail = plain(args.get(field, ''))
            if detail:
                details.append(prefix + detail)
        details.append(f'https://fr.wikiquote.org/w/index.php?oldid={revision}')
        label = ', '.join(details)
        if len(label) <= 1000:
            yield {'label': label, 'text': quote}


def extract(source, rights=None):
    authors, pages = {}, []
    with bz2.open(source, 'rb') as stream:
        for _, page in ET.iterparse(stream, events=('end',)):
            if page.tag != NS + 'page':
                continue
            value = page.findtext(NS + 'revision/' + NS + 'text') or ''
            death = re.search(r'\[\[Catégorie:Décès en (\d+)\]\]', value)
            if page.findtext(NS + 'ns') == '0' and death:
                author = page.findtext(NS + 'title')
                year = int(death[1])
                records = [person for person in (rights or {}).get(normalize(author), []) if year in person['deaths']]
                mpf = any(person['mpf'] for person in records) or bool(re.search(r'mort.{0,15}pour la France', value.split('==', 1)[0], re.I))
                if free_author(year, mpf):
                    french = any(person['french'] for person in records) or bool(WRITERS.search(value))
                    if french:
                        authors[author] = year
                    pages.append((author, page.findtext(NS + 'revision/' + NS + 'id'), value, french, year))
            page.clear()
    rows = [row for author, revision, value, french, death in pages
            for row in author_rows(author, revision, value, french, rights, death)]
    return authors, rows


def public_reference(reference, authors):
    if re.search(r'tradu|adapt|cité|réédit|réimpress|édition moderne|préface|commentaire|revue par', reference, re.I):
        return False
    author, separator, remainder = reference.partition(', ')
    years = re.findall(r'(?<!\d)(?:1\d{3}|20\d{2})(?!\d)', remainder)
    title, title_separator, _ = remainder.partition(',')
    death = authors.get(author, 0) if isinstance(authors, dict) else 0
    return bool(separator and title_separator and title.strip() and author in authors
                and years and all(free_publication(int(year), death) for year in years))
