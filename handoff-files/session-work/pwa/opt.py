import sys
from PIL import Image
n = int(sys.argv[1])
for p in sys.argv[2:]:
    im = Image.open(p).convert('RGB')
    q = im.quantize(colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q.save(p, optimize=True)
