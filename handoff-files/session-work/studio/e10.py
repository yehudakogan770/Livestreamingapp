root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/ui/Deliver.tsx', [
("""              {presets
                .filter((x) => x.group === g)""","""              {presets
                // HDR presets only for HDR sequences.
                .filter((x) => x.group === g && (!x.video?.hdr || isHdr(s)))"""),
("""export function DeliverDialog(""","""import { isHdr } from '../render/hdr';

export function DeliverDialog("""),
])
