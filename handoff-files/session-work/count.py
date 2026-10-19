import sys
s = open(sys.argv[1]).read()
rows = [l for l in s.splitlines() if l.startswith('| ') and not l.startswith('| Tool') and not l.startswith('|---') and l.count('|') >= 15]
after = {'✅': 0, '◐': 0, '❌': 0}
before = {'✅': 0, '◐': 0, '❌': 0}
for r in rows:
    cells = [c.strip() for c in r.strip('|').split('|')]
    st = cells[1]
    mark = '✅' if st.startswith('✅') else '◐' if st.startswith('◐') else '❌'
    after[mark] += 1
    tool = cells[0].lower()
    if '**new**' in st:
        b = '✅' if ('transitions' in tool or 'picture effects' in tool or 'title designer' in tool) else ('◐' if 'speaking' in tool and False else '❌')
    else:
        b = mark
    before[b] += 1
print(len(rows), 'after', after, 'before', before)
for r in rows:
    cells = [c.strip() for c in r.strip('|').split('|')]
    if not cells[1].startswith('✅'):
        print(cells[1][:3], cells[0][:80])
