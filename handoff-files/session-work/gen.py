# Flat camera-ID slates for the ?demo project: a camera name, burned-in timecode, a gray step chart.
import subprocess, sys
out = sys.argv[1]
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FM = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
cams = [('wide', 'CAM 1', 'Wide', '0x34383d', 120), ('close', 'CAM 2', 'Close-up', '0x2f3a36', 110), ('side', 'CAM 3', 'Side', '0x3a3532', 120), ('live', 'PGM', 'Program', '0x2b2e33', 120)]
for name, cam, label, bg, dur in cams:
    steps = []
    for i in range(11):
        v = int(round(16 + (235 - 16) * i / 10))
        steps.append(f"drawbox=x={140 + i * 91}:y=560:w=91:h=60:color=0x{v:02x}{v:02x}{v:02x}:t=fill")
    chips = ['0xb4403a', '0xb4a03a', '0x3aa44a', '0x3aa0b4', '0x3a4ab4', '0xa43ab4']
    for i, c in enumerate(chips):
        steps.append(f"drawbox=x={140 + i * 167}:y=620:w={167 if i < 5 else 166}:h=24:color={c}:t=fill")
    vf = ','.join([
        "drawbox=x=140:y=96:w=1001:h=440:color=0x00000033:t=fill",
        "drawbox=x=140:y=96:w=1001:h=440:color=0x8a8f96:t=1",
        f"drawtext=fontfile={FM}:text='{cam}':fontcolor=0x9aa0a8:fontsize=28:x=172:y=126",
        f"drawtext=fontfile={FB}:text='{label}':fontcolor=0xe6e8eb:fontsize=96:x=(w-text_w)/2:y=250",
        f"drawtext=fontfile={F}:text='Spring Gala - 3 May 2026':fontcolor=0x9aa0a8:fontsize=26:x=(w-text_w)/2:y=376",
        f"drawtext=fontfile={FM}:timecode='19\\:00\\:00\\:00':rate=30:fontcolor=0xffffff:fontsize=34:box=1:boxcolor=0x000000cc:boxborderw=8:x=(w-text_w)/2:y=470",
        *steps,
    ])
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c={bg}:s=1280x720:r=30:d={dur}']
    if name == 'live':
        cmd += ['-i', '/home/user/Livestreamingapp/editor/app/public/demo/live.webm', '-map', '0:v', '-map', '1:a?', '-c:a', 'copy']
    cmd += ['-vf', vf, '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '200k', '-g', '60', '-t', str(dur), f'{out}/{name}.webm']
    subprocess.run(cmd, check=True)
    print('ok', name)
