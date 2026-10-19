root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
import re
def edit(path, pairs, imp=None):
    p=root+path
    s=open(p).read()
    for old,new in pairs:
        assert old in s, (path, old[:80])
        s=s.replace(old,new,1)
    if imp:
        m = re.search(r"import \{([^}]*)\} from 'lucide-react';", s)
        if m:
            have=[x.strip() for x in m.group(1).split(',') if x.strip()]
            allx=sorted(set(have)|set(imp), key=str.lower)
            s=s[:m.start()]+"import { "+', '.join(allx)+" } from 'lucide-react';"+s[m.end():]
        else:
            i=s.index('import ')
            s=s[:i]+"import { "+', '.join(sorted(imp))+" } from 'lucide-react';\n"+s[i:]
    open(p,'w').write(s)

edit('views/VisualsPage.tsx',[
('''        <header className="vis__head">
          <h2>Stage visuals</h2>''','''        <header className="vis__head">
          <Spotlight className="vis__icon" aria-hidden="true" />
          <h2>Stage visuals</h2>'''),
('''aria-label="Slower" onClick={() => act({ type: 'visualsTempo', bpm: v.bpm - 1 })}>
              −
            </button>''','''aria-label="Slower" onClick={() => act({ type: 'visualsTempo', bpm: v.bpm - 1 })}>
              <Minus aria-hidden="true" />
            </button>'''),
('''aria-label="Faster" onClick={() => act({ type: 'visualsTempo', bpm: v.bpm + 1 })}>
              +
            </button>
            <button type="button" className="btn" onClick={tap} title="Tap along with the music (T)">
              Tap
            </button>
            <button type="button" className="btn" onClick={() => act({ type: 'visualsSync' })} title="Press on beat 1 of a bar (S)">
              Sync to 1
            </button>''','''aria-label="Faster" onClick={() => act({ type: 'visualsTempo', bpm: v.bpm + 1 })}>
              <Plus aria-hidden="true" />
            </button>
            <button type="button" className="btn" onClick={tap} title="Tap along with the music (T)">
              <Hand aria-hidden="true" />
              Tap
            </button>
            <button type="button" className="btn" onClick={() => act({ type: 'visualsSync' })} title="Press on beat 1 of a bar (S)">
              <Metronome aria-hidden="true" />
              Sync to 1
            </button>'''),
('''                ★ Favorites''','''                <Star aria-hidden="true" />
                Favorites'''),
], ['Spotlight','Minus','Plus','Hand','Metronome','Star'])

edit('views/VisualsPage.css',[
('''.vis-modal {
  /* Below the title bar (34px, as every page), then a small margin. */
  padding: 46px 12px 12px;
}''','''.vis-modal {
  /* Below the title bar (40px, as every page), then a small margin. */
  padding: 48px 8px 8px;
}'''),
('''.vis__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.vis__head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  white-space: nowrap;
}''','''.vis__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 14px;
  border-bottom: 1px solid #000;
  background: linear-gradient(#24282e, #1e2227);
  box-shadow:
    inset 0 2px 0 var(--accent),
    0 1px 0 rgba(255, 255, 255, 0.03);
  flex-wrap: wrap;
}
.vis__icon {
  width: 18px !important;
  height: 18px !important;
  color: var(--accent);
}
.vis__head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}'''),
('''.vis__bpm {
  min-width: 84px;
  text-align: center;
  font-size: 11px;
  color: var(--text-dim);
}
.vis__bpm b {
  font-size: 22px;
  color: var(--text);
  margin-right: 3px;
}''','''.vis__bpm {
  min-width: 96px;
  height: 32px;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  padding: 3px 10px 0;
  border: 1px solid #000;
  border-radius: var(--radius);
  background: var(--well);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}
.vis__bpm b {
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
}'''),
])
