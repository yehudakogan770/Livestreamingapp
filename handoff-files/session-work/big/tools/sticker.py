# sticker.py in.mp4 out.mp4 : blur the red badge on the speaker's shirt (red blob in the lower part of the frame)
import subprocess, sys
import numpy as np
from PIL import Image, ImageFilter
src, dst = sys.argv[1], sys.argv[2]
W, H = 1280, 720
dec = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', '25', '-i', '-',
                        '-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-pix_fmt', 'yuv420p', dst], stdin=subprocess.PIPE)
last = None
n = 0
while True:
    buf = dec.stdout.read(W * H * 3)
    if len(buf) < W * H * 3:
        break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16)
    y0 = int(H * 0.45)
    r, g, b = a[y0:, :, 0], a[y0:, :, 1], a[y0:, :, 2]
    m = (r > 120) & (r - g > 65) & (r - b > 55)
    ys, xs = np.nonzero(m)
    box = None
    if len(xs) > 30:
        cx, cy = np.median(xs), np.median(ys)
        sel = (abs(xs - cx) < 90) & (abs(ys - cy) < 90)
        if sel.sum() > 30:
            x1, x2 = xs[sel].min(), xs[sel].max()
            yy1, yy2 = ys[sel].min(), ys[sel].max()
            box = (max(0, x1 - 22), max(0, yy1 + y0 - 22), min(W, x2 + 22), min(H, yy2 + y0 + 22))
    if box is None and last is not None:
        box = last  # hold for a moment when it is not found (motion blur)
    im = Image.fromarray(a.astype(np.uint8))
    if box is not None:
        reg = im.crop(box).filter(ImageFilter.GaussianBlur(12))
        # Pull the red out of it as well, so no logo shape is left.
        reg = Image.blend(reg, reg.convert('L').convert('RGB'), 0.6)
        im.paste(reg, box[:2])
    last = box if box is not None else None
    enc.stdin.write(im.tobytes())
    n += 1
enc.stdin.close()
enc.wait()
print('frames', n)
