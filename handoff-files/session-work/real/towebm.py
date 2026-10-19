import subprocess, sys, os
# towebm.py outdir id...  (1280x720 VP8, high bitrate, no sound; looks as delivered by a camera)
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
HD = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/foot/hd'
LOOK = 'eq=contrast=1.08:saturation=1.12:gamma=0.97'
for id in sys.argv[2:]:
    dst = f'{out}/{id}.webm'
    if os.path.exists(dst):
        continue
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', f'{HD}/{id}.mp4', '-an', '-vf', LOOK, '-c:v', 'libvpx', '-b:v', '4M', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0', dst], check=True)
    print(id, os.path.getsize(dst))
