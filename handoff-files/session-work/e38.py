W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('app/src/engine/unified.ts', [
("""  notes: string[];
  error: string | null;
}""","""  notes: string[];
  error: string | null;
  /** Times the graphics card was reset (a driver reset) and the engine started again on it. */
  recoveries?: number;
}"""),
])
edit('app/src/views/EngineDialog.tsx', [
("""                    {s.lateFrames} of {s.frames}
                  </dd>""","""                    {s.lateFrames} of {s.frames}
                    {s.recoveries ? ` (the graphics card was reset ${s.recoveries} time${s.recoveries === 1 ? '' : 's'}; the engine carried on)` : ''}
                  </dd>"""),
])
edit('docs/ENGINE.md', [
("""- **Group opacity**: a layer of several pictures""","""- **Device-lost recovery**: a lost graphics device (a driver reset — Windows'
  TDR —, the card removed) is noticed (`set_device_lost_callback`) and a new
  one made from the same instance on the next frame (`LiveEngine::recover`):
  the screens' and feeds' targets are made again, the windows' surfaces
  configured again, the sources upload their next frames, and the overlay
  renderers' next frame is refused once so they send every plane whole. The
  Engine dialog counts the resets. Tested with `Device::destroy` on Linux
  (`a_lost_graphics_device_is_replaced_and_the_show_goes_on`); a real TDR
  (`dxcap -forcetdr`) needs Windows.
- **Group opacity**: a layer of several pictures"""),
("""- Device-lost recovery (driver reset / TDR) — the engine reports GPU errors
  and carries on, but doesn't rebuild the device yet.
""",""""""),
("""  uploads and read-back; files with hardware decode (`-hwaccel d3d11va`);
  device-lost recovery.""","""  uploads and read-back; files with hardware decode (`-hwaccel d3d11va`).
  Device-lost recovery: done."""),
])
