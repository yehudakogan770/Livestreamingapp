root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa01ea85ebaf42c39/app/src/broadcast/'
def edit(name, pairs):
    p=root+name
    s=open(p).read()
    for a,b in pairs:
        assert a in s, (name, a)
        s=s.replace(a,b,1)
    open(p,'w').write(s)

edit('PerfChip.tsx', [("""                    {b?.status.streaming?.speed != null && ` · keeping up at ${Math.round(b.status.streaming.speed * 100)}%`}
                  </td>
                </tr>
              )}""","""                    {b?.status.streaming?.speed != null && ` · keeping up at ${Math.round(b.status.streaming.speed * 100)}%`}
                  </td>
                </tr>
              )}
              {b?.status.recording?.encoder && (
                <tr>
                  <th>Recording encoder</th>
                  <td>{b.status.recording.encoder}</td>
                </tr>
              )}
              {b?.status.streaming?.encoder && (
                <tr>
                  <th>Stream encoder</th>
                  <td>{b.status.streaming.encoder}</td>
                </tr>
              )}""")])
edit('BroadcastButtons.tsx', [("""        title={rec?.path ? `Recording to ${rec.path}` : 'Record the Live Screen to a file'}""",
"""        title={rec?.path ? `Recording to ${rec.path}${rec.encoder ? ` · ${rec.encoder}` : ''}` : 'Record the Live Screen to a file'}"""),
("""              : `Live on ${live.destinations.join(', ')}`""","""              : `Live on ${live.destinations.join(', ')}${live.encoder ? ` · ${live.encoder}` : ''}`""")])
