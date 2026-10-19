import re, os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
p = 'docs/COMPETITORS-LUMORA.md'
s = open(p).read()
s = re.sub(r"\| Alerts \(follows, subscriptions, tips\)\s*\|\s*SL, PR\s*\|[^\n]*",
           "| Alerts (follows, subscriptions, tips) | SL, PR | ◐ (new) Super Chats, members, subscribers, bits and raids thanked on screen by themselves; not new followers |", s)
s = s.replace("""  or fit gaming streams more than events. Word clouds belong with the audience
  pages and are on that list.""", """  or fit gaming streams more than events (new followers on Twitch need a
  Twitch sign-in; every other kind of support is thanked on screen). Word
  clouds belong with the audience pages and are on that list.""")
s = s.replace("Cloud recording copy, AI clips, alerts, Zoom input, word clouds.", "Cloud recording copy, AI clips, follower alerts, Zoom input, word clouds.")
s = s.replace("""find any command by typing (Ctrl+K), Twitch, Kick, LinkedIn and X in the
streaming list.""", """find any command by typing (Ctrl+K), thank-yous on screen for viewers'
support (Super Chats, members, subscribers, bits, raids), Twitch, Kick,
LinkedIn and X in the streaming list.""")
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

p = 'app/src/help/manual.ts'
s = open(p).read()
old = """      'Tip: Nothing goes on screen by itself. You choose every comment, so nothing unwanted is ever shown.',"""
new = """      '• Support from viewers is marked in the list: Super Chats and Super Stickers, new members (YouTube), new subscribers, gift subscriptions, bits and raids (Twitch). Show puts the name with what they sent on the card.',
      '• “Thank supporters on screen by themselves”: each new one shows on the first chat comments card for 8 seconds, one after another, then goes off.',
      'Tip: Plain comments never go on screen by themselves. You choose every one, so nothing unwanted is ever shown.',"""
assert old in s
s = s.replace(old, new, 1)
s = s.replace("keywords: 'chat comments youtube twitch facebook viewers social questions show comment on screen',",
              "keywords: 'chat comments youtube twitch facebook viewers social questions show comment on screen super chat member subscriber bits raid alert thank',", 1)
open(p, 'w').write(s)
