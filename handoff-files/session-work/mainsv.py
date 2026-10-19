import json
p='Main.dc.html'; s=open(p).read()
BTN="height: 26px; padding: 0 8px; border-radius: 4px; border: 1px solid #3a3f48; background: #2a2e36; color: #e4e5e7; font-size: 11px; font-weight: 600; white-space: nowrap;"
i0=s.index('              <span style="font-size: 12px; font-weight: 600; color: #b4b8bf; white-space: nowrap;">Back-screen loop</span>')
i1=s.index('              <div style="flex-grow: 1;"></div>\n              <a href="BackLoops.dc.html"')
new_strip='''              <span style="font-size: 12px; font-weight: 600; color: #b4b8bf; white-space: nowrap;">Stage visuals</span>
              <select aria-label="Music type" value="{{svBankVal}}" onChange="{{onSvBank}}" style="height: 26px; max-width: 150px; border-radius: 4px; border: 1px solid #2c3038; background: #101216; color: #e4e5e7; font-size: 11px; padding: 0 6px;"><sc-for list="{{svBanks}}" as="sb" hint-placeholder-count="14"><option value="{{sb.v}}">{{sb.n}}</option></sc-for></select>
              <div style="display: flex; align-items: center; gap: 4px;">
                <button onClick="{{svSlower}}" aria-label="Slower" style="BTN width: 24px; padding: 0;">−</button>
                <span style="font-family: Consolas, monospace; font-size: 13px; font-weight: 700; color: #ffffff; width: 30px; text-align: center;">{{svBpm}}</span>
                <button onClick="{{svFaster}}" aria-label="Faster" style="BTN width: 24px; padding: 0;">+</button>
                <button onClick="{{svTap}}" style="BTN">Tap</button>
              </div>
              <sc-for list="{{svPads}}" as="sp" hint-placeholder-count="3"><button onClick="{{sp.press}}" style="{{sp.style}}">{{sp.name}}</button></sc-for>
              <button onClick="{{toggleFollow}}" title="Change scenes by themselves with the music" style="{{followStyle}}">Autopilot</button>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #a9abb0; white-space: nowrap; min-width: 0;">Energy<input type="range" min="0" max="100" value="55" aria-label="Visuals energy" style="width: 80px; min-width: 40px;"></label>
'''.replace('BTN',BTN)
s=s[:i0]+new_strip+s[i1:]
old_card='''              <div style="height: 30px; display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                <span style="font-size: 11px; color: #8e9096; white-space: nowrap;">Loop energy</span><input type="range" min="0" max="100" value="55" aria-label="Loop energy" style="flex-grow: 1; min-width: 40px;">
                <span style="font-size: 11px; color: #8e9096; white-space: nowrap;">Speed</span><input type="range" min="0" max="100" value="40" aria-label="Loop speed" style="flex-grow: 1; min-width: 40px;">
              </div>'''
new_card='''              <div style="height: 30px; display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                <button onClick="{{svSlower}}" aria-label="Slower" style="BTN width: 24px; padding: 0;">−</button>
                <span style="display: flex; flex-direction: column; align-items: center; width: 32px; line-height: 1;"><span style="font-family: Consolas, monospace; font-size: 13px; font-weight: 700; color: #ffffff;">{{svBpm}}</span><span style="font-size: 8px; color: #8e9096;">BPM</span></span>
                <button onClick="{{svFaster}}" aria-label="Faster" style="BTN width: 24px; padding: 0;">+</button>
                <button onClick="{{svTap}}" style="BTN">Tap</button>
                <div style="flex-grow: 1;"></div>
                <sc-for list="{{svPads}}" as="sp" hint-placeholder-count="3"><button onClick="{{sp.press}}" style="{{sp.style}}">{{sp.name}}</button></sc-for>
              </div>'''.replace('BTN',BTN)
assert old_card in s; s=s.replace(old_card,new_card)
a='''                <button onClick="{{toggleFollow}}" style="{{followStyle}}">Follow the music</button>'''
assert a in s; s=s.replace(a,'''                <button onClick="{{toggleFollow}}" title="Change scenes by themselves with the music" style="{{followStyle}} height: 30px;">Autopilot</button>''')
a='>Loops</a>'; assert a in s; s=s.replace(a,'>Visuals</a>')
a="loop1: { name: 'Aurora loop', sub: 'Back-screen loop · 00:30'"; assert a in s
s=s.replace(a,"loop1: { name: 'Stage visuals', sub: 'Music visuals · live'")
banks=["Slow","Medium","Fast","Bounce","Electric","Acoustic","Worship","Hip hop","Rock","Latin","Retro 80s","Party & kids","Space","Simcha & events"]
a="      toggleFollow: () => set({ follow: !st.follow }),\n"; assert a in s
logic=a+'''      svBanks: BANKS.map((n, i) => ({ v: String(i), n })), svBankVal: String(st.svBank ?? 13),
      onSvBank: (e) => set({ svBank: Number(e.target.value) }),
      svBpm: st.svBpm ?? 118,
      svSlower: () => set({ svBpm: Math.max(60, (st.svBpm ?? 118) - 1) }),
      svFaster: () => set({ svBpm: Math.min(200, (st.svBpm ?? 118) + 1) }),
      svTap: () => {
        const now = Date.now(), taps = [...(this._svTaps || []).filter((t) => now - t < 2500), now];
        this._svTaps = taps;
        if (taps.length >= 2) set({ svBpm: Math.max(60, Math.min(200, Math.round(60000 / ((now - taps[0]) / (taps.length - 1))))) });
      },
      svPads: [['flash', 'Flash'], ['dark', 'Blackout'], ['next', 'Next']].map(([id, name]) => {
        const on = id === 'flash' ? !!st.svFlash : id === 'dark' ? !!st.svDark : false;
        return { name, style: `BTN border-color: ${on ? '#4fb3bf' : '#3a3f48'}; background: ${on ? (id === 'flash' ? '#e4e5e7' : '#243039') : '#2a2e36'}; color: ${on && id === 'flash' ? '#15171b' : '#e4e5e7'};`,
          press: () => {
            if (id === 'flash') { set({ svFlash: true }); clearTimeout(this._svFl); this._svFl = setTimeout(() => this.setState({ svFlash: false }), 250); }
            else if (id === 'dark') set({ svDark: !st.svDark });
            else set({ svScene: ((st.svScene ?? 0) + 1) % 20 });
          } };
      }),
'''.replace('BTN',BTN).replace('BANKS',json.dumps(banks))
s=s.replace(a,logic)
open(p,'w').write(s)
