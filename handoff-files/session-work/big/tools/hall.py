import subprocess, sys, os
from PIL import Image, ImageFilter, ImageEnhance
B = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big'
os.makedirs(B + '/ph', exist_ok=True)
src = B + '/ph/p2263410.jpg'
if not os.path.exists(src):
    subprocess.run(['curl', '-sS', '-L', '-f', '-A', 'Mozilla/5.0', '-o', src, 'https://images.pexels.com/photos/22669860/pexels-photo-22669860.jpeg?auto=compress&w=2400'], check=True)
im = Image.open(src).convert('RGB')
print('src', im.size)
w, h = im.size
top_frac = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
# 2000x958 like before.
im = im.resize((2000, round(h * 2000 / w)), Image.LANCZOS)
top = round((im.height - 958) * top_frac)
im = im.crop((0, top, 2000, top + 958))
im = im.filter(ImageFilter.GaussianBlur(5))
im = ImageEnhance.Brightness(im).enhance(0.75)
im = ImageEnhance.Color(im).enhance(0.9)
out = sys.argv[1]
q = 80
while True:
    im.save(out, quality=q, optimize=True, progressive=True)
    if os.path.getsize(out) <= 200_000 or q < 50:
        break
    q -= 5
print(out, q, os.path.getsize(out), im.size)
