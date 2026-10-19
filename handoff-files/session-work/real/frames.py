import subprocess, sys, os
# frames.py out.jpg file t1 t2 ... (one row per file given as file@t1,t2,t3)
from PIL import Image, ImageDraw
out = sys.argv[1]
rows = []
for spec in sys.argv[2:]:
    f, ts = spec.split('@')
    row = []
    for t in ts.split(','):
        tmp = f'/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/real/_f.png'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', t, '-i', f, '-frames:v', '1', '-vf', 'scale=384:216', tmp], check=True)
        im = Image.open(tmp).convert('RGB')
        ImageDraw.Draw(im).text((6, 6), os.path.basename(f) + ' @' + t, fill=(255, 255, 0))
        row.append(im)
    rows.append(row)
cols = max(len(r) for r in rows)
s = Image.new('RGB', (384 * cols, 216 * len(rows)))
for y, r in enumerate(rows):
    for x, im in enumerate(r):
        s.paste(im, (x * 384, y * 216))
s.save(out, quality=80)
