# thumbs.py out.jpg id... : contact sheet of pexels video previews (preview-0 and preview-6)
import subprocess, sys, os
from PIL import Image, ImageDraw
C = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big/cand/th'
os.makedirs(C, exist_ok=True)
tiles = []
for id in sys.argv[2:]:
    row = []
    for n in (0, 6):
        f = f'{C}/{id}-{n}.jpg'
        if not os.path.exists(f):
            r = subprocess.run(['curl', '-sS', '-f', '-A', 'Mozilla/5.0', '-o', f, f'https://images.pexels.com/videos/{id}/pictures/preview-{n}.jpg'], capture_output=True)
            if r.returncode and n == 0:
                subprocess.run(['curl', '-sS', '-f', '-A', 'Mozilla/5.0', '-o', f, f'https://images.pexels.com/videos/{id}/pexels-photo-{id}.jpeg?auto=compress&w=640'], capture_output=True)
        try:
            im = Image.open(f).convert('RGB')
            im.thumbnail((320, 320))
        except Exception:
            im = Image.new('RGB', (320, 180), (60, 0, 0))
        row.append(im)
    tiles.append((id, row))
W, H = 640, 200
cols = 3
rows = (len(tiles) + cols - 1) // cols
s = Image.new('RGB', (W * cols, H * rows), (20, 20, 20))
d = ImageDraw.Draw(s)
for i, (id, row) in enumerate(tiles):
    x0, y0 = (i % cols) * W, (i // cols) * H
    x = x0
    for im in row:
        s.paste(im, (x, y0))
        x += im.width
    d.rectangle((x0, y0, x0 + 90, y0 + 14), fill=(0, 0, 0))
    d.text((x0 + 3, y0 + 2), id, fill=(255, 255, 0))
s.save(sys.argv[1], quality=82)
