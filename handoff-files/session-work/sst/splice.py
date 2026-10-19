import re
W = '/home/user/Livestreamingapp/.claude/worktrees/agent-a2ecfe2bb48128a84/docs/index.html'
D = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/sst/studio.html'
s = open(W).read()
a = s.index('      <!-- Light: Lumora Studio. -->')
b = s.index('      <!-- Light: comments. -->')
s = s[:a] + open(D).read() + '\n' + s[b:]

R = 'https://github.com/yehudakogan770/Livestreamingapp/releases/latest/download/'
a = s.index('          <img src="img/lumora-mark.svg" alt="" width="64" height="64" class="dl__mark" />')
b = s.index('          <p class="fine">', a)
s = s[:a] + f'''          <h2>Ready for your best event yet?</h2>
          <p>Both apps are free. No subscription, no watermark.</p>
          <div class="dlcards">
            <article class="dlcard">
              <img src="img/lumora-mark.svg" alt="" width="56" height="56" />
              <h3>Lumora</h3>
              <p>Live production, streaming and recording.</p>
              <a class="btn btn--red btn--big" href="{R}Lumora-Setup.exe">Download Lumora</a>
            </article>
            <article class="dlcard dlcard--studio">
              <img src="img/studio-mark.svg" alt="" width="56" height="56" />
              <h3>Lumora Studio</h3>
              <p>Video editing, color, sound and captions.</p>
              <a class="btn btn--amber btn--big" href="{R}Lumora-Studio-Setup.exe">Download Lumora Studio</a>
            </article>
          </div>
          <ul class="dl__more">
            <li>
              <a href="planner/">Lumora Planner</a>
              <span>Plan the run of show with your team, in the browser.</span>
            </li>
            <li>
              <a href="{R}Lumora.streamDeckPlugin">Stream Deck plugin</a>
              <span>TAKE, CUT, inputs with tally, overlays, replay, recording and going live from an Elgato Stream Deck.</span>
            </li>
          </ul>
''' + s[b:]
s = s.replace('''For Windows 10 and 11. The first time, Windows may say it doesn't recognize the app: click <b>More info</b>, then <b>Run anyway</b>. Then make your
            account in Lumora: each new account is approved by the Lumora team.''', '''For Windows 10 and 11, 64-bit. The first time, Windows may say it doesn't recognize the app: click <b>More info</b>, then <b>Run anyway</b>. Then
            make your account: each new account is approved by the Lumora team, and the same account works in both apps.''')
open(W, 'w').write(s)
