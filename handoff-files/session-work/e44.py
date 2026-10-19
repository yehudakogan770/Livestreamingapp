W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'docs/ENGINE.md'
s=open(p).read()
lines=s.split('\n')
for i,l in enumerate(lines):
    if l.startswith('| Upload 4 camera frames'):
        c=l.split('|')
        c[2]=' 4 × 3.1 MB NV12 = 0.75 GB/s (it was 4 × 8.3 MB RGBA = 2 GB/s before Phase 2) '
        c[3]=' Done in Phase 2: cameras deliver NV12 (Media Foundation\'s own format; RGB32 only when a camera can\'t), uploaded as two planes and made RGB on the GPU once per new frame (`yuv.wgsl`; BT.709 for HD, BT.601 below). On integrated GPUs uploads are memory copies. '
        lines[i]='|'.join(c)
    if l.startswith('| Encoder read-back '):
        c=l.split('|')
        c[2]=' 3.1 MB/frame NV12 = 190 MB/s download (RGBA was 8.3 MB = 500 MB/s); pipelined (two buffers, one frame late), so no stall '
        c[3]=' Done in Phase 2: each screen feed is converted to NV12 on the GPU (`fs_nv12`, BT.709 limited, tagged so) and read back as such; hardware encoders take NV12 as it is. Phase 3: hand the D3D texture to NVENC/AMF/QSV directly. '
        lines[i]='|'.join(c)
    if l.startswith('| 640×360 + FFmpeg x264 feed, 90 frames'):
        lines.insert(i+1, '| Phase 2, 640×360 + x264 feed (NV12), 120 frames (≈ 1.6) | 44.0 / 53.9            | upload 20.8, draw 7.3, previews 11.8, feed (NV12 pass + read-back) 4.8; 114 frames in, **0 dropped** |')
        lines.insert(i+2, '| Phase 2, 1080p + x264 feed (NV12), 150 frames (≈ 1.6)    | 132 / 155              | upload 23, draw 12, previews 45, feed 35.5 (the NV12 pass runs on the CPU here); 143 in, **0 dropped** |')
        break
s='\n'.join(lines)
a="""- **Picture delay** (`delay.rs`)"""
assert s.count(a)==1
s=s.replace(a,"""- **NV12 both ways**: cameras' frames cross to the GPU as NV12 (two planes,
  12 bits a pixel) and are made RGB there; the encoder feeds are made NV12 on
  the GPU and read back at a third of RGBA's bytes (see the cost table).
  Files are decoded with `-hwaccel auto` (D3D11 on Windows; FFmpeg falls back
  to the processor by itself). Tested: NV12 red (BT.601 and BT.709) drawn red,
  12 bits a pixel uploaded; the feeds' NV12 decoded back by FFmpeg to the
  right colors.
- **Picture delay** (`delay.rs`)""")
a="""  shader (port of `chroma.ts`); the picture delay; group opacity. Next: NV12
  uploads and read-back; files with hardware decode (`-hwaccel d3d11va`).
  Device-lost recovery: done."""
assert s.count(a)==1, s.count(a)
s=s.replace(a,"""  shader (port of `chroma.ts`); the picture delay; group opacity; NV12 uploads
  and read-back; files with hardware decode; device-lost recovery.""")
open(p,'w').write(s)
