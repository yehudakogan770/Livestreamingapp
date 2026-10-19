import subprocess, sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for id in sys.argv[2:]:
    dst = os.path.join(out, id + '.mp4')
    if os.path.exists(dst):
        continue
    for v in ['hd_1280_720_25fps', 'hd_1280_720_30fps', 'hd_1280_720_24fps', 'hd_1366_720_25fps', 'hd_1920_1080_25fps']:
        url = f'https://videos.pexels.com/video-files/{id}/{id}-{v}.mp4'
        r = subprocess.run(['curl', '-sS', '-f', '-A', 'Mozilla/5.0', '-o', dst, url])
        if r.returncode == 0:
            print(id, v, os.path.getsize(dst))
            break
    else:
        print('fail', id)
