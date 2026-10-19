W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('app/src/views/EngineDialog.tsx', [
("""  'Green screen, color adjustments and the frame delay are not applied to cameras yet (crop, zoom, move and flip are).',
  'Stream, web page, screen capture and guest inputs are not in the engine yet.',""","""  'Background removal, blur behind people and auto-framing are not applied to cameras yet (green screen, light and color, crop, zoom, move, flip and the picture delay are).',"""),
])
edit('docs/ENGINE.md', [
("""### What Unified (beta) does not do yet
""","""### More inputs and the picture processor on the GPU (Phase 2)

- **Stream, web page, screen-capture and guest inputs**: their pictures are
  already in the app's frame store (`browser.rs`: streams received by FFmpeg
  in `streams.rs`, pages, guests and screens captured with Windows Graphics
  Capture), as JPEG or PNG. The engine takes them from there directly (no
  HTTP: `EncodedFrames`, `EncodedSource`) and decodes them on each input's own
  thread (`zune-jpeg`, `png`), see-through PNGs keeping their alpha.
- **Green screen and light and color** (`look.rs`, `compose.wgsl: look`): the
  web picture processor's settings and order (`chroma.ts`) in the engine's one
  shader — blur or sharpness, the key on the colors as the camera saw them
  (chroma distance, softness, spill), white balance, exposure, brightness,
  shadows and highlights, contrast, gamma, saturation, black and white,
  vignette, grain — per picture, in the same pass that places it (no extra
  copy). Background removal, blur behind people and auto-framing need the web
  processor's person-finding model and are not in the engine.
- **Picture delay** (`delay.rs`): a camera held back by its delay keeps its
  last frames (up to four seconds) and shows the one from that long ago.
- **Group opacity**: a layer of several pictures (a split screen) that fades,
  wipes, blurs or luma-wipes is drawn whole into a see-through scratch target
  and faded as one (`gpu::needs_group`), so its background no longer shows
  through its boxes mid-fade.

### What Unified (beta) does not do yet
"""),
("""- Green screen, colour adjustments, frame delay, auto-framing on cameras (crop,
  zoom, pan, flip, rotate are done).
- Stream (SRT/RTMP), web page, screen-capture and guest inputs; NDI inputs.""","""- Background removal, blur behind people and auto-framing on cameras (green
  screen, light and colour, crop, zoom, pan, flip, rotate and the picture delay
  are done)."""),
("""- Group opacity: a layer made of several pictures (a split screen) fades each
  picture separately, so its background shows through its boxes mid-fade.
""",""""""),
("""  mode; the multiview drawn by the engine in its own window. Next: NV12 uploads and read-back;
  stream/NDI/file inputs with hardware decode (`-hwaccel d3d11va`); chroma key
  and colour adjustments in the shader (port of `chroma.ts`); group opacity;
  device-lost recovery.""","""  mode; the multiview drawn by the engine in its own window; stream, web page,
  screen-capture and guest inputs; green screen and light and colour in the
  shader (port of `chroma.ts`); the picture delay; group opacity. Next: NV12
  uploads and read-back; files with hardware decode (`-hwaccel d3d11va`);
  device-lost recovery."""),
])
