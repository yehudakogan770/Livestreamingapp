import os, sys
from PIL import Image
# encode.py src.png dst.jpg [maxbytes]
src, dst = sys.argv[1], sys.argv[2]
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 250_000
im = Image.open(src).convert('RGB')
q = 88
while True:
    im.save(dst, quality=q, optimize=True, progressive=True, subsampling=2 if q < 80 else 0)
    if os.path.getsize(dst) <= limit or q <= 40:
        break
    q -= 3
print(os.path.basename(dst), im.size, q, os.path.getsize(dst))
