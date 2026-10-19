import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/collab/CollabUi.tsx')
f.rep("""    <div className={`lockbar${v.kind === 'mine' ? ' is-mine' : ''}`} role="status">
      {body}""", """    <div className={`lockbar${v.kind === 'mine' ? ' is-mine' : ''}`} role="status">
      {v.kind === 'mine' ? <PenLine /> : <Lock />}
      {body}""", icons=['PenLine', 'Lock'])
f.rep("""            Add at {timecode(t, fps)}""", """            <MessageSquarePlus />
            Add at {timecode(t, fps)}""", icons=['MessageSquarePlus'])
f.rep("""      <button type="button" className="comment__go" onClick={onGo} title="Go to this frame">
        <span className="comment__time">{timecode(c.frame, fps)}</span>""", """      <button type="button" className="comment__go" onClick={onGo} title="Go to this frame">
        <MessageSquare className="comment__icon" />
        <span className="comment__time">{timecode(c.frame, fps)}</span>""", icons=['MessageSquare'])
f.rep("""          <button type="button" className="linkbtn" onClick={onDelete}>
            Delete
          </button>""", """          <button type="button" className="linkbtn comment__del" onClick={onDelete}>
            <Trash2 />
            Delete
          </button>""", icons=['Trash2'])
f.save()
