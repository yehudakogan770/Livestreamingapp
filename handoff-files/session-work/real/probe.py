import subprocess, sys, glob, os
d = sys.argv[1]
for f in sorted(glob.glob(os.path.join(d, '*.mp4'))):
    dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout.strip()
    st = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout.split()
    print(os.path.basename(f), dur, st, os.path.getsize(f))
