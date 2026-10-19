W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'docs/ENGINE.md'
s=open(p).read()
import re
lines=s.split('\n')
for i,l in enumerate(lines):
    if l.startswith('| App glue '):
        cells=[c for c in l.split('|')]
        cells[3]=" Mode saved in `live-engine.json`; `live_engine_info / set_mode / preview / health / test_record / graphics / audio / capture_start / capture_stop / probe`; `open_output`/`close_output` route Live/Back to the engine in Unified mode; the overlay renderer windows opened and closed with it (`sync_renderers`); show changes forwarded from `announce`. "
        lines[i]='|'.join(cells)
    if l.startswith('| UI '):
        cells=[c for c in l.split('|')]
        cells[3]=" Settings → Engine (how it is doing: frame time, late frames, graphics, encoding; what is not in it yet); in Unified mode `SourceView` shows cameras from the engine's previews (the WebView never opens them); `EngineHealthWatch` feeds `inputHealth` (the backup lineup) from the engine; recording and streaming go through the engine (`recorder.ts`); the test event runs with the engine answering for its screens. "
        lines[i]='|'.join(cells)
    if l.startswith('| Camera exclusive access'):
        lines[i]=l.replace('Phase 2 moves the recorder onto the engine feed so Lumora opens each camera exactly once.','Since Phase 2 the recorder is on the engine feed (ISO files too), so in Unified mode Lumora opens each camera exactly once.')
s='\n'.join(lines)
open(p,'w').write(s)
