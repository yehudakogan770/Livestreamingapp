"""List (or fix) blue-ish color literals. python3 scan.py [--fix] [--min-chroma N] files...
--fix: replaces blue-tinted grays / low-saturation blues in place with a neutral gray of the
same luminance (alpha kept). Saturated colors (chroma > SAT) are only listed, never fixed."""
import re, sys, colorsys

FIX = '--fix' in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith('--')]
args = [l.strip() for a in args for l in (open(a[1:]).read().split() if a.startswith('@') else [a])]
SAT = 60  # chroma above this = a "real" color: list only
HEX = re.compile(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])')
RGB = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,\s*[\d.]+\s*)?\)')


def blueish(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn < 3:
        return False
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    h *= 360
    return 165 <= h <= 285


def gray(r, g, b):
    y = round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    # tiny warm bias so it never reads cool
    return y


found = []
for f in args:
    try:
        src = open(f).read()
    except Exception:
        continue
    out = []
    for ln, line in enumerate(src.split('\n'), 1):
        def hx(m):
            v = m.group(1)
            if len(v) == 3:
                v = ''.join(c * 2 for c in v)
            r, g, b = int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
            if not blueish(r, g, b):
                return m.group(0)
            c = max(r, g, b) - min(r, g, b)
            found.append((f, ln, m.group(0), c, line.strip()[:110]))
            if FIX and c <= SAT:
                y = gray(r, g, b)
                return '#%02x%02x%02x' % (y, y, y)
            return m.group(0)

        def rg(m):
            r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if not blueish(r, g, b):
                return m.group(0)
            c = max(r, g, b) - min(r, g, b)
            found.append((f, ln, m.group(0), c, line.strip()[:110]))
            if FIX and c <= SAT:
                y = gray(r, g, b)
                a = m.group(4)
                return f'rgba({y}, {y}, {y}{a})' if a else f'rgb({y}, {y}, {y})'
            return m.group(0)

        line = HEX.sub(hx, line)
        line = RGB.sub(rg, line)
        out.append(line)
    if FIX:
        new = '\n'.join(out)
        if new != src:
            open(f, 'w').write(new)

for f, ln, c, ch, l in found:
    tag = 'SAT ' if ch > SAT else 'tint'
    print(f'{tag} {ch:3d} {f}:{ln}: {c}   | {l}')
