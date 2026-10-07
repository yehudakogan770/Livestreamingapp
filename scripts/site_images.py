"""Smaller copies of the website's pictures (npm run site:images).

The JPGs in docs/img and docs/media are the sources (and the fallback for old
browsers); this writes the copies the pages use beside them:

  SCREENSHOTS  docs/img/<name>-640/-1280/-1920.avif and .webp, and
               <name>-640/-1280.jpg (docs/img/<name>.jpg is the 1920 one).
               Used by the <picture> elements in docs/index.html, which say
               width="1920" height="1080": keep the sources 1920x1080.
  BACKGROUNDS  docs/img/<name>.avif and .webp at full size (site.css image-set()).
  FRAMES       docs/media/<name>.webp at full size (the live demo's still
               frames and slides, drawn by site.js).

Run it again after replacing any of these JPGs (same file names), then
commit the JPGs and the new copies. Needs Pillow 11.3 or newer (AVIF):
pip install -U pillow
"""

import os
import sys

from PIL import Image, features

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')
SCREENSHOTS = ['main', 'look', 'edit', 'studio-color']
BACKGROUNDS = ['hall']
FRAMES = ['speaker', 'wide', 'audience', 'slides']
WIDTHS = (640, 1280, 1920)
AVIF_Q = 80
WEBP_Q = 92
JPG_Q = 92


def save(im, path, fmt, **kw):
    im.save(path, fmt, **kw)
    print(f'  {os.path.relpath(path, ROOT):32} {os.path.getsize(path) // 1024:5} KB')


def avif(im, path, sharp_text=True):
    # 4:4:4 keeps small colored text in the screenshots crisp.
    save(im, path, 'AVIF', quality=AVIF_Q, speed=4, subsampling='4:4:4' if sharp_text else '4:2:0')


def main():
    if not features.check('avif'):
        sys.exit('This Pillow cannot write AVIF: pip install -U pillow (11.3 or newer)')
    for name in SCREENSHOTS:
        src = Image.open(os.path.join(ROOT, 'img', name + '.jpg')).convert('RGB')
        print(f'img/{name}.jpg {src.width}x{src.height}')
        for w in WIDTHS:
            im = src if w >= src.width else src.resize((w, round(src.height * w / src.width)), Image.LANCZOS)
            base = os.path.join(ROOT, 'img', f'{name}-{w}')
            avif(im, base + '.avif')
            save(im, base + '.webp', 'WEBP', quality=WEBP_Q, method=6)
            if w < WIDTHS[-1]:
                save(im, base + '.jpg', 'JPEG', quality=JPG_Q, optimize=True, progressive=True)
    for name in BACKGROUNDS:
        src = Image.open(os.path.join(ROOT, 'img', name + '.jpg')).convert('RGB')
        print(f'img/{name}.jpg {src.width}x{src.height}')
        avif(src, os.path.join(ROOT, 'img', name + '.avif'))
        save(src, os.path.join(ROOT, 'img', name + '.webp'), 'WEBP', quality=WEBP_Q, method=6)
    for name in FRAMES:
        src = Image.open(os.path.join(ROOT, 'media', name + '.jpg')).convert('RGB')
        print(f'media/{name}.jpg {src.width}x{src.height}')
        save(src, os.path.join(ROOT, 'media', name + '.webp'), 'WEBP', quality=WEBP_Q, method=6)


if __name__ == '__main__':
    main()
