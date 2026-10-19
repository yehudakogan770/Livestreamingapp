"""Lumora Studio demo media (editor/app/src/demo.ts): four camera angles of the
Northwind Summit keynote, the live program, and the microphones, 2 minutes each."""
import subprocess, os
S = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad'
HD = S + '/foot/hd'
OUT = S + '/real/demo'
os.makedirs(OUT, exist_ok=True)
T = 120
LOOK = 'eq=contrast=1.08:saturation=1.12:gamma=0.97'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT2 = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

def ff(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args, check=True)

ANGLES = {
    'wide': ['8716579', '8716790', '8716432'],
    'stage': ['8716574', '8716575', '8716433'],
    'closeup': ['8716429', '8716441'],
    'audience': ['8716444', '8716428', '8716588', '8716576'],
}
VP8 = ['-c:v', 'libvpx', '-b:v', '900k', '-deadline', 'good', '-cpu-used', '5', '-auto-alt-ref', '0', '-pix_fmt', 'yuv420p']
for name, ids in ANGLES.items():
    dst = f'{OUT}/{name}.webm'
    if os.path.exists(dst):
        continue
    lst = f'{OUT}/{name}.txt'
    with open(lst, 'w') as f:
        for _ in range(6):
            for i in ids:
                f.write(f"file '{HD}/{i}.mp4'\n")
    ff(['-f', 'concat', '-safe', '0', '-i', lst, '-t', str(T), '-an', '-vf', 'scale=640:360,fps=25', *VP8, dst])
    os.remove(lst)
    print('made', name)

# The cuts made live (seconds, angle); 'slides' is the keynote slide.
CUTS = [(0, 'wide'), (6, 'closeup'), (18, 'slides'), (26, 'stage'), (37, 'closeup'), (52, 'audience'), (58, 'closeup'), (74, 'wide'), (84, 'stage'), (96, 'audience'), (104, 'wide')]
live = f'{OUT}/live.webm'
inputs = []
for n in ['wide', 'stage', 'closeup', 'audience']:
    inputs += ['-i', f'{OUT}/{n}.webm']
inputs += ['-loop', '1', '-t', str(T), '-i', S + '/real/media/slides.png']
idx = {'wide': 0, 'stage': 1, 'closeup': 2, 'audience': 3, 'slides': 4}
parts = []
for k, (at, a) in enumerate(CUTS):
    end = CUTS[k + 1][0] if k + 1 < len(CUTS) else T
    parts.append(f"[{idx[a]}:v]trim={at}:{end},setpts=PTS-STARTPTS,scale=640:360,fps=25,format=yuv420p,setsar=1[p{k}]")
fc = ';'.join(parts) + ';' + ''.join(f'[p{k}]' for k in range(len(CUTS))) + f'concat=n={len(CUTS)}:v=1:a=0,{LOOK}[c];'
# The name title during the first close-up and again later.
lt = "enable='between(t,7,15)+between(t,59,66)'"
fc += (
    f"[c]drawbox=x=40:y=268:w=230:h=50:color=0x0a0b0e@0.85:t=fill:{lt},"
    f"drawbox=x=40:y=268:w=4:h=50:color=0x1f8f99@1:t=fill:{lt},"
    f"drawtext=fontfile={FONT}:text='Daniel Brooks':x=54:y=276:fontsize=18:fontcolor=white:{lt},"
    f"drawtext=fontfile={FONT2}:text='Chief Product Officer':x=54:y=299:fontsize=11:fontcolor=0xc8d6dc:{lt}[v]"
)

# Sound: a speech-like podium mic, a handheld for the Q&A, the room, a music bed.
def speech(active):
    gate = "gt(sin(2*PI*t*2.3)*sin(2*PI*t*0.37+1.1)+0.35*sin(2*PI*t*5.1),0.02)*(0.55+0.45*abs(sin(2*PI*t*3.7)))"
    return f"anoisesrc=color=pink:sample_rate=48000:seed=3:d={T},bandpass=f=900:width_type=h:w=1600,volume='({gate})*({active})*4':eval=frame"
AUDIO = {
    'podium': speech('lt(t,95)+gt(t,112)'),
    'hand': speech('between(t,97,111)*0.8'),
    'room': f"anoisesrc=color=brown:sample_rate=48000:seed=5:d={T},volume='0.05+0.9*(between(t,0,4)+between(t,49,52)+between(t,114,120))*(0.6+0.4*sin(2*PI*t*9))':eval=frame",
    'music': f"aevalsrc='0.18*(sin(2*PI*220*t)+sin(2*PI*277.2*t)+sin(2*PI*329.6*t))*(0.5+0.5*sin(2*PI*t*2))*(0.35+0.65*lt(mod(t,8),4))*(0.25+0.75*(lt(t,10)+gt(t,110)))':s=48000:d={T}",
}
OPUS = ['-c:a', 'libopus', '-b:a', '64k']
for name, src in AUDIO.items():
    dst = f'{OUT}/{name}.webm'
    if os.path.exists(dst):
        continue
    ff(['-f', 'lavfi', '-i', src, '-t', str(T), *OPUS, dst])
    print('made', name)

if not os.path.exists(live):
    ff([*inputs, '-i', f'{OUT}/podium.webm', '-i', f'{OUT}/hand.webm', '-i', f'{OUT}/room.webm',
        '-filter_complex', fc + ';[5:a][6:a][7:a]amix=inputs=3:normalize=0[a]',
        '-map', '[v]', '-map', '[a]', '-t', str(T), *VP8, *OPUS, live])
    print('made live')
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(f'{OUT}/{f}'))
