D = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big/cap/'


def edit(name, pairs):
    p = D + name
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (name, a)
        s = s.replace(a, b)
    open(p, 'w').write(s)


WT = ('agent-a28f31ba65a5e6c6f', 'agent-aac173dd6e086a9e6')
edit('vite.app.config.ts', [WT])
edit('vite.st.config.ts', [WT, ("scratchpad/real/demo' + path.slice(5)", "scratchpad/big/demo' + path.slice(5)")])
edit('og.html', [WT])
edit('lumora.js', [("/real/real/media/podium-still.jpg", "/real/big/feeds/speaker-still.jpg")])
edit('fake-devices.js', [
    ("""    ['cam-wide', 'Wide', '/real/foot/webm/8716579.webm'],
    ['cam-left', 'Stage left', '/real/foot/webm/8716574.webm'],
    ['cam-close', 'Podium close-up', '/real/foot/webm/8716429.webm'],
    ['cam-aud', 'Audience', '/real/foot/webm/8716444.webm'],""", """    ['cam-wide', 'Wide', '/real/big/feeds/wide.webm'],
    ['cam-left', 'Stage', '/real/big/feeds/stage.webm'],
    ['cam-close', 'Speaker close-up', '/real/big/feeds/close.webm'],
    ['cam-aud', 'Audience', '/real/big/feeds/aud.webm'],"""),
    ("['mic-podium', 'Podium', 0.55, 'speech'],", "['mic-podium', 'Speaker', 0.55, 'speech'],"),
])
