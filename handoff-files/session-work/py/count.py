s = open('docs/COMPETITORS-PLANNER-DECK-AUDIENCE.md').read()
for sec in s.split('\n## ')[1:]:
    rows = [l for l in sec.split('\n') if l.startswith('| ') and not l.startswith('| Feature') and not l.startswith('| ---') and not l.startswith('| Complaint')]
    rows = [r for r in rows if r.count('|') >= 6]
    c = {'✅': 0, '◐': 0, '❌': 0}
    for r in rows:
        cell = r.split('|')[2].strip()
        if cell in c:
            c[cell] += 1
    print(sec[:30].strip(), len(rows), c)
