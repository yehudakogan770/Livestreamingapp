import re
root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/'
pat=re.compile(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> origin/claude/festive-curie-637ic2\n', re.S)

# lib.rs: both sides, ours first.
p=root+'src-tauri/src/lib.rs'
s=open(p).read()
s=pat.sub(lambda m: m.group(1)+m.group(2), s)
open(p,'w').write(s)

# Cargo.toml: every member of both.
p=root+'Cargo.toml'
s=open(p).read()
def members(m):
    a=re.findall(r'"([^"]+)"', m.group(1)); b=re.findall(r'"([^"]+)"', m.group(2))
    out=[]
    for x in b+a:
        if x not in out: out.append(x)
    # keep the apps at the end
    apps=[x for x in out if x.endswith('src-tauri')]
    rest=[x for x in out if not x.endswith('src-tauri')]
    return 'members = ['+', '.join('"%s"'%x for x in rest+apps)+']\n'
s=pat.sub(members, s)
open(p,'w').write(s)

# App.tsx
p=root+'app/src/App.tsx'
s=open(p).read()
parts=pat.findall(s)
s=pat.sub(lambda m: '@@C@@', s)
first=parts[0][0]+parts[0][1]
second="""  const part = isTitlerWindow()
    ? TitlerWindow
    : isVisionWorker()
      ? VisionView
      : overlayScreen()
        ? OverlayView
        : isMultiview()
          ? MultiviewView
          : outputScreen()
            ? OutputView
            : isSeatWindow()
              ? SeatWindow
"""
s=s.replace('@@C@@',first,1).replace('@@C@@',second,1)
s=s.replace("""              ? SeatWindow
            : Control;""","""              ? SeatWindow
              : Control;""")
open(p,'w').write(s)
