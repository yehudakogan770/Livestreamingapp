import re, sys


def gray(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    if r == g == b:
        return None
    if max(r, g, b) - min(r, g, b) > 22:
        return None
    if not (b >= r):
        return None  # only cool (blue-tinted) grays
    y = round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    return '#%02x%02x%02x' % (y, y, y)


apply = '--apply' in sys.argv
for f in [a for a in sys.argv[1:] if a != '--apply']:
    s = open(f).read()

    def rep(m):
        g = gray(m.group(0))
        if g:
            print(f, m.group(0), '->', g)
        return g or m.group(0)

    t = re.sub(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', rep, s)
    if apply and t != s:
        open(f, 'w').write(t)
