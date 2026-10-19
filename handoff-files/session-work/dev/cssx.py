# Rewrite planner.css's device media queries as [data-device] selectors.
import re, sys
p = sys.argv[1]
s = open(p).read()

def match_brace(s, i):
    d = 0; j = i
    while j < len(s):
        c = s[j]
        if s.startswith('/*', j):
            j = s.index('*/', j) + 2; continue
        if c in '"\'':
            q = c; j += 1
            while s[j] != q:
                j += 2 if s[j] == '\\' else 1
            j += 1; continue
        if c == '{': d += 1
        elif c == '}':
            d -= 1
            if d == 0: return j
        j += 1
    raise Exception('unbalanced')

def split_sel(sel):
    out, d, cur = [], 0, ''
    for c in sel:
        if c in '([': d += 1
        if c in ')]': d -= 1
        if c == ',' and d == 0:
            out.append(cur); cur = ''
        else: cur += c
    out.append(cur)
    return out

def prefix_one(sel, root):
    st = sel.strip()
    lead = sel[:len(sel) - len(sel.lstrip())]
    # :where() keeps each rule's specificity as it was inside the media query.
    attr = root[len(':root'):]
    if st.startswith(':root'):
        return lead + ':root:where(' + attr + ')' + st[len(':root'):]
    if re.match(r'html\b', st):
        return lead + 'html:where(' + attr + ')' + st[4:]
    return lead + ':where(' + root + ') ' + st

def transform_body(body, root):
    out = ''; i = 0
    while i < len(body):
        if body.startswith('/*', i):
            k = body.index('*/', i) + 2; out += body[i:k]; i = k; continue
        if body[i].isspace():
            out += body[i]; i += 1; continue
        b = body.index('{', i)
        prelude = body[i:b]
        e = match_brace(body, b)
        inner = body[b+1:e]
        if prelude.strip().startswith('@keyframes'):
            out += body[i:e+1]
        elif prelude.strip().startswith('@'):
            out += prelude + '{' + transform_body(inner, root) + '}'
        else:
            parts = split_sel(prelude.rstrip())
            trail = prelude[len(prelude.rstrip()):]
            out += ','.join(prefix_one(x, root) for x in parts) + trail + '{' + inner + '}'
        i = e + 1
    return out

PH = ":root[data-device='phone']"
RULES = {
    '(max-width: 760px), (pointer: coarse) and (max-height: 500px)': (None, PH),
    '(pointer: coarse) and (max-height: 500px)': (None, ":root[data-device='phone'][data-orient='landscape']"),
    '(pointer: coarse) and (min-width: 761px)': (None, ":root[data-device='tablet']"),
    '(min-width: 761px) and (max-width: 1100px)': ('(max-width: 1100px)', ":root:not([data-device='phone'])"),
    '(min-width: 761px) and (max-width: 900px)': ('(max-width: 900px)', ":root:not([data-device='phone'])"),
}
out = ''; i = 0
pat = re.compile(r'@media\s*([^{]*?)\s*\{')
while True:
    m = pat.search(s, i)
    if not m:
        out += s[i:]; break
    q = m.group(1).strip()
    b = m.end() - 1
    e = match_brace(s, b)
    if q in RULES:
        keep, root = RULES[q]
        body = transform_body(s[b+1:e], root)
        out += s[i:m.start()]
        if keep:
            out += '@media ' + keep + ' {' + body + '}'
        else:
            body = re.sub(r'\n  ', '\n', body).strip('\n')
            out += body
        i = e + 1
    else:
        out += s[i:e+1]; i = e + 1
open(p, 'w').write(out)
