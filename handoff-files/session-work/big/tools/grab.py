# grab.py out.jpg file@t[@vf] ... : 960x540 frames, 2 columns
import subprocess, sys
from PIL import Image, ImageDraw
T = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big/cand/_g.png'
ims = []
for spec in sys.argv[2:]:
    parts = spec.split('@')
    f, t = parts[0], parts[1]
    vf = (parts[2] + ',' if len(parts) > 2 else '') + 'scale=960:540'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', t, '-i', f, '-frames:v', '1', '-vf', vf, T], check=True)
    im = Image.open(T).convert('RGB')
    ImageDraw.Draw(im).text((6, 6), spec.split('/')[-1], fill=(255, 255, 0))
    ims.append(im)
rows = (len(ims) + 1) // 2
s = Image.new('RGB', (1920, 540 * rows))
for i, im in enumerate(ims):
    s.paste(im, ((i % 2) * 960, (i // 2) * 540))
s.save(sys.argv[1], quality=85)
