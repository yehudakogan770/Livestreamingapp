import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aa366926aba0928a0')
p='docs/ENGINE.md'
s=open(p).read()
old_start=s.index("Measured on the development container (4 vCPU")
old_end=s.index("For comparison, the web numbers in `PERFORMANCE.md`")
new='''Measured on the development container (4 vCPU shared with other jobs,
**no GPU: llvmpipe, Mesa's software rasterizer, through OpenGL**), so every
pixel is drawn by the CPU — these numbers are a floor for correctness and an
upper bound for cost, not a prediction for an event PC. The machine's load
moved a lot between runs (shown), so compare rows with the same load only:

| Run (load average)                                         | ms / frame (avg / p95) | Of which                                               |
| ---------------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| 1080p, 300 frames, synchronous read-back (≈ 10)            | 342 / 576              | upload 51, draw 64, outputs 156, encoder read-back 107 |
| 1080p, 150 frames, pipelined read-back (≈ 5)               | 149 / 185              | upload 26, draw 43, outputs 73, encoder read-back 5    |
| 640×360, 120 frames, synchronous read-back (≈ 10)          | 88.7 / 131             | upload 30, draw 19, outputs 26, read-back 11           |
| 640×360, 120 frames, pipelined read-back (≈ 5)             | 53.7 / 66              | upload 26, draw 11, outputs 15, read-back 0.6          |
| 640×360 + FFmpeg x264 feed, 90 frames (≈ 10)               | 98.9 / 161             | 90 frames in, **0 dropped**                            |
| Scene maths, 3 screens (CPU only, any run)                 | **0.01 ms**            |                                                        |

The encoder read-back is pipelined (`Compositor::read_pipelined`: two buffers
take turns, each frame returns the previous frame's pixels, so the engine
never waits for the copy): 107 → 5 ms at 1080p here, part of it the lower load.

'''
s=s[:old_start]+new+s[old_end:]
s=s.replace("| Encoder read-back       | 8.3 MB/frame = 500 MB/s download, ~1–2 ms stall (synchronous map)     | Phase 2: NV12 on the GPU before read-back (190 MB/s) and a two-buffer ring (no stall); Phase 3: hand the D3D texture to NVENC/AMF/QSV directly. |",
"| Encoder read-back       | 8.3 MB/frame = 500 MB/s download; pipelined (two buffers, one frame late), so no stall | Phase 2: NV12 on the GPU before read-back (190 MB/s); Phase 3: hand the D3D texture to NVENC/AMF/QSV directly. |")
s=s.replace("Read back the Live Screen → raw RGBA into FFmpeg","Read back the Live Screen (pipelined: one frame late, never a stall) → raw RGBA into FFmpeg")
open(p,'w').write(s)
