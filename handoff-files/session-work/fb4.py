import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
p = 'app/src/views/ChatPanel.tsx'
s = open(p).read()
def rep(old, new):
    global s
    assert old in s, old
    s = s.replace(old, new, 1)

rep("""            {st.youtube.problem && <p className="field__note field__note--warn">{st.youtube.problem}</p>}""",
"""            {st.youtube.problem && <p className="field__note field__note--warn">{st.youtube.problem}</p>}
            <div className="chat__row">
              {dot(st.facebook.status)}
              <span className="chat__label">Facebook (the connected account’s live video)</span>
              {st.facebook.status === 'off' || st.facebook.status === 'error' ? (
                <button type="button" className="btn btn--small" onClick={() => chat.connectFacebook()}>
                  Connect
                </button>
              ) : (
                <button type="button" className="btn btn--small" onClick={() => chat.disconnectFacebook()}>
                  Stop
                </button>
              )}
            </div>
            {st.facebook.problem && <p className="field__note field__note--warn">{st.facebook.problem}</p>}""")
rep("""{st.twitch.status === 'on' || st.youtube.status === 'on' ? 'Waiting for comments…' : 'Connect to a chat above.'}""",
"""{st.twitch.status === 'on' || st.youtube.status === 'on' || st.facebook.status === 'on' ? 'Waiting for comments…' : 'Connect to a chat above.'}""")
rep("""<small>{m.platform === 'youtube' ? 'YT' : 'TW'}</small>""", """<small>{PLATFORM_SHORT[m.platform]}</small>""")
rep("""const KEY_STORE = 'lumora.youtubeKey';""", """const KEY_STORE = 'lumora.youtubeKey';
const PLATFORM_SHORT = { youtube: 'YT', twitch: 'TW', facebook: 'FB', other: '' } as const;""")
rep("""/**
 * The live chat, beside the controls (it doesn't block them). Connect to
 * Twitch or YouTube,""", """/**
 * The live chat, beside the controls (it doesn't block them). Connect to
 * Twitch, YouTube or Facebook,""")
open(p, 'w').write(s)
