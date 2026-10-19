import sys, glob, os
from PIL import Image, ImageDraw
d = sys.argv[1]
out = sys.argv[2]
files = sorted(glob.glob(os.path.join(d, '*.png')))
cols = 3
tw, th = 640, 360
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 20)), '#222')
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((tw, th))
    x = (i % cols) * tw
    y = (i // cols) * (th + 20)
    sheet.paste(im, (x, y + 20))
    dr.text((x + 4, y + 4), os.path.basename(f), fill='#fff')
sheet.save(out)
