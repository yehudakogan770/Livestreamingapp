# photos.py out.jpg id... : contact sheet of pexels photos
import subprocess, sys, os
from PIL import Image, ImageDraw
C = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big/cand/ph'
os.makedirs(C, exist_ok=True)
ims = []
for id in sys.argv[2:]:
    f = f'{C}/{id}.jpg'
    if not os.path.exists(f):
        subprocess.run(['curl', '-sS', '-f', '-A', 'Mozilla/5.0', '-o', f, f'https://images.pexels.com/photos/{id}/pexels-photo-{id}.jpeg?auto=compress&w=640'])
    try:
        im = Image.open(f).convert('RGB')
        im.thumbnail((480, 320))
    except Exception:
        im = Image.new('RGB', (480, 320), (60, 0, 0))
    ims.append((id, im))
cols = 4
rows = (len(ims) + cols - 1) // cols
s = Image.new('RGB', (480 * cols, 320 * rows), (20, 20, 20))
d = ImageDraw.Draw(s)
for i, (id, im) in enumerate(ims):
    x, y = (i % cols) * 480, (i // cols) * 320
    s.paste(im, (x, y))
    d.rectangle((x, y, x + 80, y + 14), fill=(0, 0, 0))
    d.text((x + 3, y + 2), id, fill=(255, 255, 0))
s.save(sys.argv[1], quality=80)
