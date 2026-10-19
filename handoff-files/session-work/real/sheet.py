import sys
from PIL import Image
files = sys.argv[2:]
cols = 3
ims = [Image.open(f).convert('RGB').resize((480, 270)) for f in files]
rows = (len(ims) + cols - 1) // cols
s = Image.new('RGB', (480 * cols, 270 * rows))
for i, im in enumerate(ims):
    s.paste(im, ((i % cols) * 480, (i // cols) * 270))
s.save(sys.argv[1], quality=80)
