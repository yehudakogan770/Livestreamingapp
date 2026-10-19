# peek.py out.jpg id[=url]... : download a small version of each pexels video, take 3 frames, tile, delete the video
import subprocess, sys, os
from PIL import Image, ImageDraw
B = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big/cand'
V = []
for q in ['sd_640_360', 'sd_960_540', 'sd_1006_540', 'sd_960_506', 'hd_1280_720', 'hd_1920_1080']:
    for f in ['25', '30', '24', '50', '60']:
        V.append(f'{q}_{f}fps')
rows = []
for spec in sys.argv[2:]:
    id, _, url = spec.partition('=')
    tmp = f'{B}/peek-{id}.mp4'
    ok = False
    for v in ([None] if url else V):
        u = url or f'https://videos.pexels.com/video-files/{id}/{id}-{v}.mp4'
        r = subprocess.run(['curl', '-sS', '-f', '-A', 'Mozilla/5.0', '-o', tmp, u], capture_output=True)
        if r.returncode == 0:
            ok = True
            break
    row = []
    if ok:
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp], capture_output=True, text=True).stdout or 0)
        for k in (0.1, 0.5, 0.9):
            fr = f'{B}/_peek.png'
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', str(dur * k), '-i', tmp, '-frames:v', '1', '-vf', 'scale=384:-2', fr])
            try:
                im = Image.open(fr).convert('RGB')
                im.thumbnail((384, 216))
                row.append(im)
            except Exception:
                pass
        os.remove(tmp)
        print(id, 'ok', round(dur, 1), flush=True)
    else:
        print(id, 'fail', flush=True)
    rows.append((id, row))
s = Image.new('RGB', (384 * 3, 216 * len(rows)), (20, 20, 20))
d = ImageDraw.Draw(s)
for y, (id, row) in enumerate(rows):
    for x, im in enumerate(row):
        s.paste(im, (x * 384, y * 216))
    d.rectangle((0, y * 216, 90, y * 216 + 14), fill=(0, 0, 0))
    d.text((3, y * 216 + 2), id, fill=(255, 255, 0))
s.save(sys.argv[1], quality=80)
