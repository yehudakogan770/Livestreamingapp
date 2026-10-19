import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/ui/Timeline.tsx')
f.rep("""const TOOLS: [Tool, string, string, string][] = [
  ['select', '↖', 'Selection', 'V'],
  ['ripple', '⇤', 'Ripple edit: trims and moves what follows', 'B'],
  ['roll', '⇹', 'Rolling edit: moves a cut between two clips', 'N'],
  ['razor', '✂', 'Razor: cut a clip in two', 'C'],
  ['slip', '⇔', 'Slip: show another part of the clip, in the same place', 'Y'],
  ['slide', '⇆', 'Slide: move a clip between its neighbors', 'U'],
  ['hand', '✥', 'Hand: drag the timeline along', 'H'],
  ['text', 'T', 'Type: click on the timeline to add words', 'T'],
];""", """const TOOLS: [Tool, LucideIcon, string, string][] = [
  ['select', MousePointer2, 'Selection', 'V'],
  ['ripple', ArrowLeftToLine, 'Ripple edit: trims and moves what follows', 'B'],
  ['roll', UnfoldHorizontal, 'Rolling edit: moves a cut between two clips', 'N'],
  ['razor', Scissors, 'Razor: cut a clip in two', 'C'],
  ['slip', ChevronsLeftRight, 'Slip: show another part of the clip, in the same place', 'Y'],
  ['slide', MoveHorizontal, 'Slide: move a clip between its neighbors', 'U'],
  ['hand', Hand, 'Hand: drag the timeline along', 'H'],
  ['text', Type, 'Type: click on the timeline to add words', 'T'],
];""", icons=['MousePointer2', 'ArrowLeftToLine', 'UnfoldHorizontal', 'Scissors', 'ChevronsLeftRight', 'MoveHorizontal', 'Hand', 'Type', 'type LucideIcon'])
f.rep("""          {TOOLS.map(([t, icon, name, key]) => (""", """          {TOOLS.map(([t, Icon, name, key]) => (""")
f.rep("""              onClick={() => actions.tool(t)}
            >
              {icon}
            </button>""", """              onClick={() => actions.tool(t)}
            >
              <Icon />
            </button>""")
f.rep("""          ⊓ Snap""", """          <Magnet />
          Snap""", icons=['Magnet'])
f.rep("""          onClick={actions.linkedSelection}
        >
          Linked""", """          onClick={actions.linkedSelection}
        >
          <Link2 />
          Linked""", icons=['Link2'])
f.rep("""          ▾ Marker""", """          <Bookmark />
          Marker""", icons=['Bookmark'])
f.rep("""onClick={() => actions.zoom(1 / 1.5)}>
          −
        </button>""", """onClick={() => actions.zoom(1 / 1.5)}>
          <ZoomOut />
        </button>""", icons=['ZoomOut'])
f.rep("""onClick={() => actions.zoom(1.5)}>
          +
        </button>""", """onClick={() => actions.zoom(1.5)}>
          <ZoomIn />
        </button>""", icons=['ZoomIn'])
f.rep("""title="See the whole sequence (\\)" onClick={() => actions.zoomToFit(size.w)}>
          Fit""", """title="See the whole sequence (\\)" onClick={() => actions.zoomToFit(size.w)}>
          <Maximize2 />
          Fit""", icons=['Maximize2'])
f.rep("""className="tbtn" aria-label="Zoom out\"""", """className="tbtn tbtn--icon" aria-label="Zoom out\"""")
f.rep("""className="tbtn" aria-label="Zoom in\"""", """className="tbtn tbtn--icon" aria-label="Zoom in\"""")
f.rep("""      <button type="button" className="tl__seq" title="Sequence settings" onClick={() => ui.set({ dialog: 'sequence' })}>
        {current(project).name}
      </button>""", """      <button type="button" className="tl__seq" title="Sequence settings" onClick={() => ui.set({ dialog: 'sequence' })}>
        <Film />
        <span>{current(project).name}</span>
      </button>""", icons=['Film'])
# track headers
f.rep("""        title="Target: Insert and Overwrite put clips on this track\"""", """        title={`Target ${t.name}: Insert and Overwrite put clips on this track`}""")
f.rep("""          title={t.locked ? 'Unlock' : 'Lock (nothing on it changes)'}
          aria-pressed={t.locked}
          onClick={() => set({ locked: !t.locked }, 'Lock track')}
        >
          {t.locked ? 'Locked' : 'Lock'}
        </button>""", """          title={t.locked ? 'Unlock' : 'Lock (nothing on it changes)'}
          aria-label="Lock"
          aria-pressed={t.locked}
          onClick={() => set({ locked: !t.locked }, 'Lock track')}
        >
          {t.locked ? <Lock /> : <LockOpen />}
        </button>""", icons=['Lock', 'LockOpen'])
f.rep("""            title={t.off ? 'Show this track' : 'Hide this track'}
            aria-pressed={t.off}
            onClick={() => set({ off: !t.off }, 'Hide track')}
          >
            {t.off ? '◌' : '◉'}
          </button>""", """            title={t.off ? 'Show this track' : 'Hide this track'}
            aria-label="Hide"
            aria-pressed={t.off}
            onClick={() => set({ off: !t.off }, 'Hide track')}
          >
            {t.off ? <EyeOff /> : <Eye />}
          </button>""", icons=['Eye', 'EyeOff'])
f.rep("""              title="Mute"
              aria-pressed={t.off}
              onClick={() => set({ off: !t.off }, 'Mute track')}
            >
              M
            </button>""", """              title="Mute"
              aria-label="Mute"
              aria-pressed={t.off}
              onClick={() => set({ off: !t.off }, 'Mute track')}
            >
              {t.off ? <VolumeX /> : <Volume2 />}
            </button>""", icons=['VolumeX', 'Volume2'])
f.rep("""              title="Solo (hear only this)"
              aria-pressed={t.solo}
              onClick={() => set({ solo: !t.solo }, 'Solo track')}
            >
              S
            </button>""", """              title="Solo (hear only this)"
              aria-label="Solo"
              aria-pressed={t.solo}
              onClick={() => set({ solo: !t.solo }, 'Solo track')}
            >
              <Headphones />
            </button>""", icons=['Headphones'])
# waveform: crisp, lighter, with a center line
f.rep("""    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    const mid = h / 2;""", """    const mid = Math.round(h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, mid, width, 1);
    ctx.fillStyle = 'rgba(214,226,218,0.78)';""")
f.rep("""      const v = (peak / 255) * (h / 2 - 2);
      ctx.fillRect(px, mid - v, 1, v * 2);""", """      const v = Math.round((peak / 255) * (h / 2 - 3));
      if (v > 0) ctx.fillRect(px, mid - v, 1, v * 2 + 1);""")
# meters: solid zones (green to -18, amber to -6, red above), no gradient
f.rep("""        const top = y(peaks[i] ?? -90);
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, '#2f8f4e');
        grad.addColorStop(0.75, '#c9b23a');
        grad.addColorStop(0.92, '#d2453a');
        ctx.fillStyle = grad;
        ctx.fillRect(x, top, 7, h - top);""", """        const top = y(peaks[i] ?? -90);
        // Solid zones, as on a desk: green to -18 dB, amber to -6, red above.
        for (const [lo, hi, col] of METER_ZONES) {
          const a = Math.max(top, y(hi));
          const b = y(lo);
          if (b > a) {
            ctx.fillStyle = col;
            ctx.fillRect(x, a, 7, b - a);
          }
        }""")
f.rep("""const RULER = 28;""", """const RULER = 28;
/** Level meter zones: [from dB, to dB, color]. */
export const METER_ZONES: [number, number, string][] = [
  [-90, -18, '#2f9a55'],
  [-18, -6, '#d6a93a'],
  [-6, 6, '#e0453a'],
];""")
f.rep("""        ctx.fillStyle = '#1c1c1e';""", """        ctx.fillStyle = '#121417';""")
f.save()
