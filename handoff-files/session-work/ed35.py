import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p,a)
        s=s.replace(a,b)
    open(p,'w').write(s)
edit('Designer.tsx', [
('''  AlignCenterHorizontal,
  AlignCenterVertical,''','''  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,'''),
('''              aria-label="Distribute across"
            >
              ⇹
            </button>''','''              aria-label="Distribute across"
            >
              <AlignHorizontalDistributeCenter size={15} />
            </button>'''),
('''              aria-label="Distribute down"
            >
              ⇵
            </button>''','''              aria-label="Distribute down"
            >
              <AlignVerticalDistributeCenter size={15} />
            </button>'''),
])
edit('Timeline.tsx', [
("import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock, Diamond, Clock } from 'lucide-react';","import { ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Lock, Unlock, Diamond, Clock } from 'lucide-react';"),
('''            <button className="tt-ico" onClick={(e) => (e.stopPropagation(), jump(-1))} aria-label="Previous keyframe">
              ‹
            </button>''','''            <button className="tt-ico" onClick={(e) => (e.stopPropagation(), jump(-1))} aria-label="Previous keyframe" title="Previous keyframe">
              <ChevronLeft size={12} />
            </button>'''),
('''            <button className="tt-ico" onClick={(e) => (e.stopPropagation(), jump(1))} aria-label="Next keyframe">
              ›
            </button>''','''            <button className="tt-ico" onClick={(e) => (e.stopPropagation(), jump(1))} aria-label="Next keyframe" title="Next keyframe">
              <ChevronRight size={12} />
            </button>'''),
('''                <button
                  className="tt-link"
                  title="Repeat part of HOLD while the graphic is on air"''','''                <button
                  className="tt-mini"
                  title="Repeat part of HOLD while the graphic is on air"'''),
('''                <button
                  className="tt-link"
                  title="A cue marker (an audio cue or a note) at the playhead"''','''                <button
                  className="tt-mini"
                  title="A cue marker (an audio cue or a note) at the playhead"'''),
])
edit('Panels.tsx', [
('''          <button
            className="tt-link tt-grow"
            onClick={async () => {
              const r = await host.readLibrary(m.id);''','''          <button
            className="tt-lib-item tt-grow"
            title={`Open ${m.name}`}
            onClick={async () => {
              const r = await host.readLibrary(m.id);'''),
])
edit('designer.css', [
('''.tt-link {
  color: var(--tt-dim) !important;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-align: left;
  padding: 0 !important;
}
.tt-link:hover {
  color: var(--tt-text) !important;
}''','''.tt-link {
  color: var(--tt-dim) !important;
  text-decoration: none;
  text-underline-offset: 2px;
  text-align: left;
  padding: 0 !important;
}
.tt-link:hover {
  color: var(--tt-text) !important;
  text-decoration: underline;
}
/* A small bordered button (the timeline's Add loop, Add cue). */
.tt-mini {
  padding: 1px 7px !important;
  font-size: 11px;
  color: var(--tt-dim) !important;
  border: 1px solid var(--tt-line-2) !important;
  border-radius: var(--tt-radius);
  white-space: nowrap;
}
.tt-mini:hover {
  color: var(--tt-text) !important;
  background: var(--tt-hover) !important;
}
.tt-lib-item {
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tt-side-item:hover .tt-lib-item {
  color: var(--tt-text);
}'''),
])
