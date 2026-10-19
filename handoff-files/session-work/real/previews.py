from PIL import Image
S = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad'
I = '/home/user/Livestreamingapp/.claude/worktrees/agent-a28f31ba65a5e6c6f/docs/img'
for n in ['main', 'look', 'manual', 'edit', 'studio-color', 'hall', 'og']:
    Image.open(f'{I}/{n}.jpg').save(f'{S}/site-real-{n}.png')
    print(n)
