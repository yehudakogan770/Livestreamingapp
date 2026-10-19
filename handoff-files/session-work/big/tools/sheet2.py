# sheet2.py out.jpg id... : like thumbs.py but only ids whose preview exists (uses cached th/)
import sys, os
from PIL import Image, ImageDraw
C = os.path.dirname(os.path.abspath(__file__)) + '/../cand/th'
tiles = []
for id in sys.argv[2:]:
    row = []
    for n in (0, 6):
        f = f'{C}/{id}-{n}.jpg'
        try:
            im = Image.open(f).convert('RGB'); im.thumbnail((320, 320)); row.append(im)
        except Exception:
            pass
    if row:
        tiles.append((id, row))
W, H, cols = 640, 200, 3
rows = (len(tiles) + cols - 1) // cols
s = Image.new('RGB', (W * cols, max(1, H * rows)), (20, 20, 20))
d = ImageDraw.Draw(s)
for i, (id, row) in enumerate(tiles):
    x0, y0 = (i % cols) * W, (i // cols) * H
    x = x0
    for im in row:
        s.paste(im, (x, y0)); x += im.width
    d.rectangle((x0, y0, x0 + 90, y0 + 14), fill=(0, 0, 0)); d.text((x0 + 3, y0 + 2), id, fill=(255, 255, 0))
s.save(sys.argv[1], quality=82)
print(len(tiles))
