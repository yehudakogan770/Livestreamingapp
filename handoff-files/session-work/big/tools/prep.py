"""Cleaned, graded 1280x720 25 fps intermediates of the source clips (big/clean).
Crops away signs, blurs readable banners, trims to the usable part."""
import subprocess, os, sys
B = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big'
S, O = B + '/src', B + '/clean'
os.makedirs(O, exist_ok=True)
LOOK = 'eq=contrast=1.06:saturation=1.08'
X264 = ['-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-an']


def blur(regions):
    """filter_complex chain on [0:v] that blurs (x,y,w,h) boxes; ends in [b]."""
    fc = '[0:v]split=%d[base]%s;' % (len(regions) + 1, ''.join(f'[s{i}]' for i in range(len(regions))))
    cur = 'base'
    for i, (x, y, w, h) in enumerate(regions):
        fc += f'[s{i}]crop={w}:{h}:{x}:{y},boxblur=14:3[r{i}];[{cur}][r{i}]overlay={x}:{y}[o{i}];'
        cur = f'o{i}'
    return fc, cur


CLIPS = {
    # name: (source, start, duration, pre-filter, regions to blur in source pixels)
    'wide': ('13082773', 16.0, 9.0, 'eq=gamma=1.18:contrast=1.04', []),

    'stage': ('10050961', 3.5, 8.8, '', []),
    'close': ('12985782', 0.0, 108.0, 'crop=1088:612:192:0', []),
    'aud': ('36499729', 0.0, 36.9, '', [(420, 350, 110, 250), (1380, 380, 100, 200), (880, 820, 170, 200)]),
    'aud2': ('13082739', 0.0, 7.5, '', []),
}
only = sys.argv[1:]
for name, (src, ss, t, pre, regions) in CLIPS.items():
    if only and name not in only:
        continue
    chain = ','.join(x for x in [pre, 'scale=1280:720:flags=lanczos', 'fps=25', LOOK, 'setsar=1'] if x)
    if regions:
        fc, last = blur(regions)
        fc += f'[{last}]{chain}[v]'
        args = ['-filter_complex', fc, '-map', '[v]']
    else:
        args = ['-vf', chain]
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(ss), '-t', str(t), '-i', f'{S}/{src}.mp4', *args, *X264, f'{O}/{name}.mp4'], check=True)
    print(name, os.path.getsize(f'{O}/{name}.mp4'), flush=True)
