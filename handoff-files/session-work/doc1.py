import re, os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
p = 'docs/COMPETITORS-LUMORA.md'
s = open(p).read()
s = re.sub(r"\| Drawing on screen live \(telestrator\)\s*\|\s*vMix 28, TC\s*\|\s*❌\s*\|", "| Drawing on screen live (telestrator) | vMix 28, TC | ✅ (new) lines and arrows over the picture |", s)
s = re.sub(r"\| Timer and messages on a speaker's phone \|\s*ST\s*\|[^\n]*", "| Timer and messages on a speaker's phone | ST | ✅ (new) the speaker's slides page shows the timer's colors and the Monitor message |", s)
s = re.sub(r"- \*\*Drawing on screen \(telestrator\)\.\*\*.*?(?=\n- \*\*)", "", s, flags=re.S)
s = s.replace("""progress bar), find any command by typing (Ctrl+K), Twitch, Kick, LinkedIn
and X in the streaming list.""", """progress bar) and on the speaker's phone, drawing on screen (telestrator),
find any command by typing (Ctrl+K), Twitch, Kick, LinkedIn and X in the
streaming list.""")
rows = [l for l in s.split('\n') if l.startswith('| ') and l.count('|') == 4 and not l.startswith('| Feature') and not l.startswith('| ---')]
c = {'✅': 0, '◐': 0, '❌': 0}
for r in rows:
    last = r.split('|')[3].strip()
    for k in c:
        if last.startswith(k):
            c[k] += 1
print(c)
s = re.sub(r"\| ✅ Lumora has it\s*\|\s*\d+\s*\|", f"| ✅ Lumora has it | {c['✅']} |", s)
s = re.sub(r"\| ◐ Partly, or another way\s*\|\s*\d+\s*\|", f"| ◐ Partly, or another way | {c['◐']} |", s)
s = re.sub(r"\| ❌ Not yet\s*\|\s*\d+\s*\|", f"| ❌ Not yet | {c['❌']} |", s)
open(p, 'w').write(s)
