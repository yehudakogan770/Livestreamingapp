import sys
s = open(sys.argv[1]).read()
for l in s.splitlines():
    if l.startswith('| ') and not l.startswith('| Tool') and l.count('|') >= 15:
        cells = [c.strip() for c in l.strip('|').split('|')]
        if not cells[1][:1] in ('✅', '◐', '❌'):
            print(repr(cells[:3]))
