import subprocess, os
D = '/home/user/Livestreamingapp/.claude/worktrees/agent-a28f31ba65a5e6c6f/docs/media'
for n in ['podium', 'wide', 'audience']:
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', f'{D}/{n}.mp4', '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', f'{D}/{n}.webm'], check=True)
for f in sorted(os.listdir(D)):
    print(f, os.path.getsize(f'{D}/{f}'))
