import re

ROOT = '/home/user/Livestreamingapp/.claude/worktrees/agent-a22c0ed40f10ed52f/'


def add_imports(s, names):
    names = set(names)
    m = re.search(r"^import \{([^}]*)\} from 'lucide-react';\n", s, re.M)
    if m:
        have = {x.strip() for x in m.group(1).split(',') if x.strip()}
        allv = sorted(have | names, key=lambda x: (x.startswith('type '), x.lower()))
        return s[: m.start()] + "import { " + ', '.join(allv) + " } from 'lucide-react';\n" + s[m.end():]
    # after the first import line
    m = re.search(r"^import [^\n]*\n", s, re.M)
    line = "import { " + ', '.join(sorted(names, key=str.lower)) + " } from 'lucide-react';\n"
    return s[: m.start()] + line + s[m.start():]


class File:
    def __init__(self, rel):
        self.p = ROOT + rel
        self.s = open(self.p).read()
        self.icons = set()

    def rep(self, a, b, cnt=1, icons=()):
        n = self.s.count(a)
        assert n == cnt, (self.p, a[:80], n)
        self.s = self.s.replace(a, b)
        self.icons |= set(icons)

    def sub(self, pat, b, icons=(), min_count=1):
        self.s, n = re.subn(pat, b, self.s, flags=re.M)
        assert n >= min_count, (self.p, pat, n)
        self.icons |= set(icons)
        return n

    def save(self):
        if self.icons:
            self.s = add_imports(self.s, self.icons)
        open(self.p, 'w').write(self.s)


GLYPH = {'↺': 'RotateCcw', '✕': 'X', '×': 'X', '▾': 'ChevronDown', '◂': 'ChevronLeft', '▸': 'ChevronRight', '↶': 'Undo2', '↷': 'Redo2', '⊡': 'Scan', '⇡': 'ArrowUpFromLine', '⇞': 'FoldHorizontal', '↓': 'ArrowDown'}


def glyph_lines(f):
    """Lines that are only a glyph become the matching icon."""
    def r(m):
        g = m.group(2)
        name = GLYPH[g]
        f.icons.add(name)
        return f"{m.group(1)}<{name} />"
    f.s = re.sub(r"^(\s*)([" + ''.join(GLYPH) + r"])\s*$", r, f.s, flags=re.M)
