root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/ui/Monitors.tsx', [
("""        {clock && <span className="vmon__clock">{clock}</span>}
        <span className="vmon__fill" />""","""        {clock && <span className="vmon__clock">{clock}</span>}
        {(s.color === 'pq' || s.color === 'hlg') && (
          <button
            type="button"
            className="vmon__clock vmon__hdr"
            title="An HDR sequence: shown tone-mapped for this screen; the film keeps the HDR signal. Click to change it (Sequence settings)."
            onClick={() => ui.set({ dialog: 'sequence' })}
          >
            HDR {s.color === 'pq' ? 'PQ' : 'HLG'}
          </button>
        )}
        <span className="vmon__fill" />"""),
])
edit('editor/app/src/editor.css', [
(""".vmon__fill {
  flex: 1;""",""".vmon__hdr {
  cursor: pointer;
  color: var(--text);
}
.vmon__hdr:hover {
  border-color: var(--text-dim);
}
.vmon__fill {
  flex: 1;"""),
(""".scopes__title {
  margin-right: auto;
  font-size: 12px;
  font-weight: 600;
}""",""".scopes__title {
  margin-right: auto;
  font-size: 12px;
  font-weight: 600;
}
.scopes__space {
  margin-right: 8px;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 10px;
}"""),
])
