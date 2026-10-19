import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

rep('docs/LIVE_ACCOUNTS.md', """- `pages_read_engagement` — read the Page's details
""", """- `pages_read_engagement` — read the Page's details
- `pages_read_user_content` — read the comments on the live video (Lumora's
  live chat)
""")
rep('docs/LIVE_ACCOUNTS.md', """  shows its status and link, and ends it (`end_live_video`) when they stop.
  Lumora posts nothing else.\"""", """  shows its status and link, and ends it (`end_live_video`) when they stop.
  Lumora posts nothing else.\"
- _pages_read_user_content_: "While the live video is on, the operator can
  open Lumora's live chat and read its comments (`GET /{live-video-id}/comments`)
  to choose one to show on screen. Comments are read only, never stored or
  posted.\"""")
