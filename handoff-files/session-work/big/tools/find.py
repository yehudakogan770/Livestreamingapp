# find.py id... : print first working pexels file variant (HEAD)
import subprocess, sys
V = []
for q in ['sd_960_540', 'sd_640_360', 'hd_1280_720', 'sd_1006_540', 'sd_960_506', 'hd_1920_1080', 'uhd_2560_1440', 'uhd_3840_2160']:
    for f in ['25', '30', '24', '50', '60']:
        V.append(f'{q}_{f}fps')
for id in sys.argv[1:]:
    for v in V:
        url = f'https://videos.pexels.com/video-files/{id}/{id}-{v}.mp4'
        r = subprocess.run(['curl', '-sS', '-I', '-o', '/dev/null', '-w', '%{http_code}', '-A', 'Mozilla/5.0', url], capture_output=True, text=True)
        if r.stdout == '200':
            print(id, v, flush=True)
            break
    else:
        print(id, 'none', flush=True)
