import subprocess, shutil
R = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/real'
I = '/home/user/Livestreamingapp/.claude/worktrees/agent-a28f31ba65a5e6c6f/docs/img'
for src, dst in [('main-good.png', 'main.jpg'), ('look.png', 'look.jpg'), ('manual.png', 'manual.jpg'), ('s-edit.png', 'edit.jpg'), ('s-color.png', 'studio-color.jpg')]:
    subprocess.run(['python3', '-I', R + '/encode.py', f'{R}/out/{src}', f'{I}/{dst}'], check=True)
shutil.copy(f'{R}/out/hall.jpg', f'{I}/hall.jpg')
