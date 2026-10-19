def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/ui/Monitors.tsx', [
("""import { PlayheadTime } from './Timeline';""","""import { PlayheadTime } from './Timeline';
import { DroppedFrames, ProxyToggle } from './Playback';"""),
("""          <option value={0.25}>1/4</option>
        </select>
""","""          <option value={0.25}>1/4</option>
        </select>
        <ProxyToggle ui={ui} on={u.proxies} />
        <DroppedFrames engine={engine} />
"""),
])
print('ok')
