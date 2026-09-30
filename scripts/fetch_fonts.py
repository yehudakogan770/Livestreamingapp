#!/usr/bin/env python3
"""Fetch Lumora's built-in fonts from Google Fonts (all open-source licensed).

Every Hebrew family, then the most popular others, up to COUNT families.
Only the Latin, Latin-extended and Hebrew letters are kept (WOFF2), so the
set stays small. Writes app/public/fonts/: the files, fonts.css (one
@font-face per file, loaded only when a font is used) and fonts.json (the
list the font picker shows).

Run from the repository root: python3 scripts/fetch_fonts.py
"""

import concurrent.futures as cf
import json
import os
import re
import urllib.request

COUNT = 500
OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'public', 'fonts')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
SUBSETS = ('latin', 'latin-ext', 'hebrew')
# Hebrew families from the Noto collection worth having (the rest are other scripts).
NOTO_KEEP = {'Noto Sans Hebrew', 'Noto Serif Hebrew', 'Noto Rashi Hebrew', 'Noto Sans', 'Noto Serif'}


def get(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else data.decode('utf-8')


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def choose():
    text = get('https://fonts.google.com/metadata/fonts')
    if text.startswith(")]}'"):
        text = text[4:]
    fams = json.loads(text)['familyMetadataList']
    ok = [
        f
        for f in fams
        if f.get('isOpenSource', True)
        and not f.get('isBrandFont')
        and (not f.get('isNoto') or f['family'] in NOTO_KEEP)
        and ('latin' in f['subsets'] or 'hebrew' in f['subsets'])
        and not f.get('colorCapabilities')
    ]
    ok.sort(key=lambda f: f.get('popularity') or 99999)
    hebrew = [f for f in ok if 'hebrew' in f['subsets']]
    others = [f for f in ok if 'hebrew' not in f['subsets']]
    return hebrew + others[: COUNT - len(hebrew)]


def weights_query(f):
    """A variable font: its whole weight range; otherwise Regular and Bold (what it has)."""
    axes = {a['tag']: a for a in f.get('axes', [])}
    if 'wght' in axes:
        a = axes['wght']
        return f"wght@{int(a['min'])}..{int(a['max'])}", [int(a['min']), int(a['max'])]
    have = sorted({int(k.rstrip('i')) for k in f['fonts'] if not k.endswith('i')} or {400})
    pick = [w for w in (400, 700) if w in have] or [have[0]]
    return 'wght@' + ';'.join(map(str, pick)), pick


def fetch(f):
    name = f['family']
    q, weights = weights_query(f)
    url = 'https://fonts.googleapis.com/css2?family=' + name.replace(' ', '+') + ':' + q + '&display=swap'
    try:
        css = get(url)
    except Exception:
        # Some families refuse the weight range: take the default.
        css = get('https://fonts.googleapis.com/css2?family=' + name.replace(' ', '+') + '&display=swap')
    faces = []
    for sub, block in re.findall(r'/\*\s*([a-z-]+)\s*\*/\s*@font-face\s*{([^}]*)}', css):
        if sub not in SUBSETS:
            continue
        src = re.search(r'url\((https://[^)]+\.woff2)\)', block)
        weight = re.search(r'font-weight:\s*([0-9 ]+);', block)
        rng = re.search(r'unicode-range:\s*([^;]+);', block)
        style = re.search(r'font-style:\s*(\w+);', block)
        if not src or (style and style.group(1) != 'normal'):
            continue
        w = weight.group(1).strip() if weight else '400'
        file = f"{slug(name)}/{sub}-{w.replace(' ', '-')}.woff2"
        path = os.path.join(OUT, file)
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as fh:
                fh.write(get(src.group(1), binary=True))
        faces.append({'file': file, 'weight': w, 'range': rng.group(1).strip() if rng else None})
    return {
        'family': name,
        'category': f['category'],
        'hebrew': 'hebrew' in f['subsets'],
        'weights': weights,
        'faces': faces,
    }


def main():
    fams = choose()
    print(f'{len(fams)} families ({sum("hebrew" in f["subsets"] for f in fams)} with Hebrew)')
    with cf.ThreadPoolExecutor(12) as ex:
        results = list(ex.map(lambda f: _safe(fetch, f), fams))
    done = [r for r in results if r and r['faces']]
    css = ['/* Lumora’s built-in fonts (Google Fonts, open-source licensed). Made by scripts/fetch_fonts.py. */']
    for r in done:
        for face in r['faces']:
            css.append(
                '@font-face{font-family:"%s";font-style:normal;font-weight:%s;font-display:swap;src:url("%s") format("woff2");%s}'
                % (r['family'], face['weight'], face['file'], f"unicode-range:{face['range']};" if face['range'] else '')
            )
    with open(os.path.join(OUT, 'fonts.css'), 'w') as fh:
        fh.write('\n'.join(css) + '\n')
    listing = [{'family': r['family'], 'category': r['category'], 'hebrew': r['hebrew']} for r in done]
    with open(os.path.join(OUT, 'fonts.json'), 'w') as fh:
        json.dump(listing, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(done)} fonts written')


def _safe(fn, f):
    try:
        return fn(f)
    except Exception as e:  # noqa: BLE001 - a family that fails is left out
        print('skipped', f['family'], e)
        return None


if __name__ == '__main__':
    main()
