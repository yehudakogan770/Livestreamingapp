# grid.py out.jpg img... : labelled grid of images, 5 columns, 320x180 tiles
import sys, os
from PIL import Image, ImageDraw
fs = sys.argv[2:]
cols = 5
rows = (len(fs) + cols - 1) // cols
s = Image.new('RGB', (320 * cols, 190 * rows), (20, 20, 20))
d = ImageDraw.Draw(s)
for i, f in enumerate(fs):
    try:
        im = Image.open(f).convert('RGB'); im.thumbnail((320, 180))
    except Exception:
        continue
    x, y = (i % cols) * 320, (i // cols) * 190
    s.paste(im, (x, y))
    d.rectangle((x, y, x + 80, y + 12), fill=(0, 0, 0)); d.text((x + 2, y + 1), os.path.basename(f).split('.')[0], fill=(255, 255, 0))
s.save(sys.argv[1], quality=82)
