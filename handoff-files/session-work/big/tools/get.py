# get.py id[=url] ... : download to big/src/<id>.mp4 (skip if present), print probe
import subprocess, sys, os
D = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big/src'
os.makedirs(D, exist_ok=True)
V = [f'{q}_{f}fps' for q in ['hd_1280_720', 'hd_1920_1080', 'sd_960_540'] for f in ['25', '30', '24', '60', '50']]
for spec in sys.argv[1:]:
    id, _, url = spec.partition('=')
    dst = f'{D}/{id}.mp4'
    if not os.path.exists(dst):
        for u in ([url] if url else [f'https://videos.pexels.com/video-files/{id}/{id}-{v}.mp4' for v in V]):
            r = subprocess.run(['curl', '-sS', '-f', '-A', 'Mozilla/5.0', '-o', dst, u], capture_output=True)
            if r.returncode == 0:
                print('from', u)
                break
        else:
            print(id, 'FAIL')
            continue
    st = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'csv=p=0', dst], capture_output=True, text=True).stdout.split()
    print(id, st, os.path.getsize(dst), flush=True)
