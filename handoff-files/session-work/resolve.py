import sys
p = sys.argv[1] + '/docs/FEATURES.md'
s = open(p).read()
a = s.index('<<<<<<< HEAD\n')
m = s.index('=======\n', a)
b = s.index('>>>>>>> origin/claude/festive-curie-637ic2\n', m)
mine = s[a + len('<<<<<<< HEAD\n'):m]
theirs = s[m + len('=======\n'):b]
mine = mine.replace('(65 of 78 tools ✅, 6 ◐, 7 ❌)', '(66 of 78 tools ✅, 5 ◐, 7 ❌)')
mine = mine.replace('- ✅ **Color** — stills and a reference wipe; drawn masks; rounded shape masks', '- ✅ **Color** — stills and a reference wipe; drawn masks that can be animated (rotoscoping); rounded shape masks')
mine = mine.replace('- ⬜ Still to come: animated drawn masks, HDR and color management', '- ⬜ Still to come: HDR and color management')
s = s[:a] + theirs + mine + s[b + len('>>>>>>> origin/claude/festive-curie-637ic2\n'):]
open(p, 'w').write(s)
