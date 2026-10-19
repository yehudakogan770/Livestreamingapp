import subprocess, os, sys
S = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad'
HD = S + '/foot/hd'
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
LOOK = 'eq=contrast=1.08:saturation=1.12:gamma=0.97'
clips = {
    'podium': ('8716429', 1.0, 6.0),
    'wide': ('8716579', 1.5, 6.0),
    'audience': ('8716444', 1.2, 6.0),
}
def run(a):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + a, check=True)
for name, (id, ss, t) in clips.items():
    src = f'{HD}/{id}.mp4'
    run(['-ss', str(ss), '-t', str(t), '-i', src, '-an', '-vf', f'scale=640:360,{LOOK},fps=25', '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', f'{out}/{name}.mp4'])
    run(['-ss', str(ss + 0.2), '-i', src, '-frames:v', '1', '-vf', f'scale=640:360,{LOOK}', '-q:v', '5', f'{out}/{name}.jpg'])
run(['-i', S + '/real/media/slides.png', '-vf', 'scale=1280:720', '-q:v', '4', f'{out}/slides.jpg'])
for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)))
