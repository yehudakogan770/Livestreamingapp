"""From big/clean: the website clips (docs/media), the camera feeds Lumora's
screenshots use (big/feeds), and the Lumora Studio demo media (big/demo).
make_media.py site|feeds|demo ..."""
import subprocess, os, sys
B = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big'
C = B + '/clean'
DOCS = '/home/user/Livestreamingapp/.claude/worktrees/agent-ace45bb64fa23b74f/docs/media'
SLIDES = B + '/tonight.png'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT2 = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def ff(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args, check=True)


def loop_filter(ss, t, f, extra=''):
    """A seamless loop of t seconds starting at ss: the last f seconds fade into the start."""
    pre = f'scale=640:360:flags=lanczos{"," + extra if extra else ""},setsar=1'
    return (
        f'[0:v]{pre},split[a][b];'
        f'[a]trim={ss + f}:{ss + t + f},setpts=PTS-STARTPTS[m];'
        f'[b]trim={ss}:{ss + f},setpts=PTS-STARTPTS,format=yuva420p,fade=in:st=0:d={f}:alpha=1,setpts=PTS+{t - f}/TB[h];'
        f'[m][h]overlay=eof_action=pass,format=yuv420p[v]'
    )


SITE = {
    # name: (clean file, start, seconds, crf mp4, crf webm)
    'speaker': ('close', 18.0, 7.0, 26, 38),
    'wide': ('wide', 0.5, 7.0, 26, 38),
    'audience': ('aud', 3.0, 7.0, 26, 38),
}


def site():
    for name, (src, ss, t, crf, crf9) in SITE.items():
        fc = loop_filter(ss, t, 0.8)
        mp4, webm = f'{DOCS}/{name}.mp4', f'{DOCS}/{name}.webm'
        while True:
            ff(['-i', f'{C}/{src}.mp4', '-filter_complex', fc, '-map', '[v]', '-an', '-t', str(t), '-r', '25', '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', str(crf), '-preset', 'slow', '-movflags', '+faststart', mp4])
            if os.path.getsize(mp4) <= 245_000:
                break
            crf += 2
        while True:
            ff(['-i', f'{C}/{src}.mp4', '-filter_complex', fc, '-map', '[v]', '-an', '-t', str(t), '-r', '25', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', str(crf9), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', webm])
            if os.path.getsize(webm) <= 245_000:
                break
            crf9 += 3
        ff(['-ss', str(ss + 0.8), '-i', f'{C}/{src}.mp4', '-frames:v', '1', '-vf', 'scale=640:360:flags=lanczos', '-q:v', '5', f'{DOCS}/{name}.jpg'])
        print(name, crf, crf9, os.path.getsize(mp4), os.path.getsize(webm), os.path.getsize(f'{DOCS}/{name}.jpg'), flush=True)


FEEDS = {'wide': 'wide', 'stage': 'stage', 'close': 'close', 'aud': 'aud'}


def feeds():
    out = B + '/feeds'
    os.makedirs(out, exist_ok=True)
    for name, src in FEEDS.items():
        # Forward then backward, so the loop has no jump; at most 30 s.
        ff(['-t', '15', '-i', f'{C}/{src}.mp4', '-filter_complex', '[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-an',
            '-c:v', 'libvpx', '-b:v', '4M', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0', f'{out}/{name}.webm'])
        print(name, os.path.getsize(f'{out}/{name}.webm'), flush=True)
    # A still of the speaker for the Event look window.
    ff(['-ss', '21', '-i', f'{C}/close.mp4', '-frames:v', '1', '-q:v', '3', f'{out}/speaker-still.jpg'])


T = 120
VP8 = ['-c:v', 'libvpx', '-b:v', '900k', '-deadline', 'good', '-cpu-used', '5', '-auto-alt-ref', '0', '-pix_fmt', 'yuv420p']
OPUS = ['-c:a', 'libopus', '-b:a', '64k']
ANGLES = {
    'wide': ['wide'],
    'stage': ['stage'],
    'closeup': ['close'],
    'audience': ['aud', 'aud2'],
}
CUTS = [(0, 'wide'), (6, 'closeup'), (18, 'slides'), (26, 'stage'), (37, 'closeup'), (52, 'audience'), (58, 'closeup'), (74, 'wide'), (84, 'stage'), (96, 'audience'), (104, 'wide')]


def demo():
    out = B + '/demo'
    os.makedirs(out, exist_ok=True)
    for name, srcs in ANGLES.items():
        # Each source forward and backward, repeated to 2 minutes.
        lst = f'{out}/{name}.txt'
        parts = []
        for s in srcs:
            pp = f'{out}/_{s}_pp.mp4'
            if not os.path.exists(pp):
                ff(['-i', f'{C}/{s}.mp4', '-filter_complex', '[0:v]scale=640:360,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]' if s != 'close' else '[0:v]scale=640:360[v]',
                    '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', pp])
            parts.append(pp)
        with open(lst, 'w') as f:
            for _ in range(12):
                for p in parts:
                    f.write(f"file '{p}'\n")
        ff(['-f', 'concat', '-safe', '0', '-i', lst, '-t', str(T), '-an', '-vf', 'fps=25', *VP8, f'{out}/{name}.webm'])
        os.remove(lst)
        print('made', name, flush=True)
    inputs = []
    for n in ['wide', 'stage', 'closeup', 'audience']:
        inputs += ['-i', f'{out}/{n}.webm']
    inputs += ['-loop', '1', '-t', str(T), '-i', SLIDES]
    idx = {'wide': 0, 'stage': 1, 'closeup': 2, 'audience': 3, 'slides': 4}
    parts = []
    for k, (at, a) in enumerate(CUTS):
        end = CUTS[k + 1][0] if k + 1 < len(CUTS) else T
        parts.append(f'[{idx[a]}:v]trim={at}:{end},setpts=PTS-STARTPTS,scale=640:360,fps=25,format=yuv420p,setsar=1[p{k}]')
    fc = ';'.join(parts) + ';' + ''.join(f'[p{k}]' for k in range(len(CUTS))) + f'concat=n={len(CUTS)}:v=1:a=0[c];'
    lt = "enable='between(t,7,15)+between(t,59,66)'"
    fc += (
        f"[c]drawbox=x=40:y=268:w=230:h=50:color=0x0a0b0e@0.85:t=fill:{lt},"
        f"drawbox=x=40:y=268:w=4:h=50:color=0x1f8f99@1:t=fill:{lt},"
        f"drawtext=fontfile={FONT}:text='Marco Reyes':x=54:y=276:fontsize=18:fontcolor=white:{lt},"
        f"drawtext=fontfile={FONT2}:text='Host':x=54:y=299:fontsize=11:fontcolor=0xc8d6dc:{lt}[v]"
    )

    def speech(active):
        gate = "gt(sin(2*PI*t*2.3)*sin(2*PI*t*0.37+1.1)+0.35*sin(2*PI*t*5.1),0.02)*(0.55+0.45*abs(sin(2*PI*t*3.7)))"
        return f"anoisesrc=color=pink:sample_rate=48000:seed=3:d={T},bandpass=f=900:width_type=h:w=1600,volume='({gate})*({active})*4':eval=frame"
    audio = {
        'podium': speech('lt(t,95)+gt(t,112)'),
        'hand': speech('between(t,97,111)*0.8'),
        'room': f"anoisesrc=color=brown:sample_rate=48000:seed=5:d={T},volume='0.08+0.9*(between(t,0,4)+between(t,49,52)+between(t,114,120))*(0.6+0.4*sin(2*PI*t*9))':eval=frame",
        'music': f"aevalsrc='0.18*(sin(2*PI*220*t)+sin(2*PI*277.2*t)+sin(2*PI*329.6*t))*(0.5+0.5*sin(2*PI*t*2))*(0.35+0.65*lt(mod(t,8),4))*(0.25+0.75*(lt(t,10)+gt(t,110)))':s=48000:d={T}",
    }
    for name, src in audio.items():
        dst = f'{out}/{name}.webm'
        if not os.path.exists(dst):
            ff(['-f', 'lavfi', '-i', src, '-t', str(T), *OPUS, dst])
    ff([*inputs, '-i', f'{out}/podium.webm', '-i', f'{out}/hand.webm', '-i', f'{out}/room.webm',
        '-filter_complex', fc + ';[5:a][6:a][7:a]amix=inputs=3:normalize=0[a]',
        '-map', '[v]', '-map', '[a]', '-t', str(T), *VP8, *OPUS, f'{out}/live.webm'])
    for f in sorted(os.listdir(out)):
        if f.startswith('_'):
            os.remove(f'{out}/{f}')
            continue
        print(f, os.path.getsize(f'{out}/{f}'))


for step in sys.argv[1:]:
    {'site': site, 'feeds': feeds, 'demo': demo}[step]()
