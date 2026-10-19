import subprocess, sys, os
from PIL import Image, ImageFilter, ImageEnhance
S = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad'
src = S + '/foot/ph/hall-src.jpg'
if not os.path.exists(src):
    subprocess.run(['curl', '-sS', '-L', '-f', '-A', 'Mozilla/5.0', '-o', src, 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&w=2400'], check=True)
im = Image.open(src).convert('RGB')
w, h = im.size
# 2000x958: keep the full width, the audience in the lower part.
im = im.resize((2000, round(h * 2000 / w)), Image.LANCZOS)
top = max(0, im.height - 958 - 40)
im = im.crop((0, top, 2000, top + 958))
im = im.filter(ImageFilter.GaussianBlur(3))
im = ImageEnhance.Brightness(im).enhance(0.75)
im = ImageEnhance.Color(im).enhance(0.85)
out = sys.argv[1]
q = 80
while True:
    im.save(out, quality=q, optimize=True, progressive=True)
    if os.path.getsize(out) <= 200_000 or q < 50:
        break
    q -= 5
print(out, q, os.path.getsize(out), im.size)
