import math
polish = open('project/Pesukim.dc.html').read()
polish = polish[polish.index('/* lumora-polish:start */'):polish.index('/* lumora-polish:end */')+len('/* lumora-polish:end */')]
RED = '#e5483c'
def P(r, a, cx=24, cy=24): a = math.radians(a); return (cx + r*math.cos(a), cy + r*math.sin(a))
def f(p): return f'{p[0]:.2f} {p[1]:.2f}'
def arc(r, a0, a1): return f'M{f(P(r,a0))} A{r} {r} 0 {1 if a1-a0>180 else 0} 1 {f(P(r,a1))}'
SEGS = lambda g: [(-90 + g/2 + 120*i, -90 - g/2 + 120*(i+1)) for i in range(3)]

# every mark: (fg, C=[c0,c1,c2], O=[o0,o1,o2], red, pulse, halo)
def t_open(fg, C, O, red, pulse, halo):
    return f'<path d="{arc(17,-20,300)}" fill="none" stroke="{fg}" stroke-width="5" stroke-linecap="round"></path><circle cx="24" cy="24" r="6.5" fill="{red}" opacity="{pulse}"></circle>'
def t_halo(fg, C, O, red, pulse, halo):
    return f'<circle cx="24" cy="24" r="18" fill="none" stroke="{fg}" stroke-width="3.2"></circle><circle cx="24" cy="24" r="{halo}" fill="none" stroke="{red}" stroke-width="2" opacity="0.4"></circle><circle cx="24" cy="24" r="6.8" fill="{red}" opacity="{pulse}"></circle>'
def t_notch(fg, C, O, red, pulse, halo):
    c = P(16, -45)
    return f'<path d="{arc(16,-18,288)}" fill="none" stroke="{fg}" stroke-width="5.5" stroke-linecap="round"></path><circle cx="{c[0]:.2f}" cy="{c[1]:.2f}" r="5" fill="{red}" opacity="{pulse}"></circle><circle cx="24" cy="24" r="4" fill="{fg}" opacity="0.35"></circle>'
def i_ring(fg, C, O, red, pulse, halo):
    return ''.join(f'<path d="{arc(17,a,b)}" fill="none" stroke="{C[i]}" stroke-width="5" stroke-linecap="round" opacity="{O[i]}"></path>' for i,(a,b) in enumerate(SEGS(16))) + f'<circle cx="24" cy="24" r="6.5" fill="{red}" opacity="{pulse}"></circle>'
def i_blades(fg, C, O, red, pulse, halo):
    out = ''
    for i,(a,b) in enumerate(SEGS(10)):
        out += f'<path d="M{f(P(20,a))} A20 20 0 0 1 {f(P(20,b))} L{f(P(11.5,b+22))} A11.5 11.5 0 0 0 {f(P(11.5,a+22))} Z" fill="{C[i]}" opacity="{O[i]}"></path>'
    return out + f'<circle cx="24" cy="24" r="5" fill="{red}" opacity="{pulse}"></circle>'
def i_thin(fg, C, O, red, pulse, halo):
    return ''.join(f'<path d="{arc(18,a,b)}" fill="none" stroke="{C[i]}" stroke-width="3" stroke-linecap="round" opacity="{O[i]}"></path>' for i,(a,b) in enumerate(SEGS(24))) + f'<circle cx="24" cy="24" r="{halo}" fill="none" stroke="{red}" stroke-width="1.6" opacity="0.4"></circle><circle cx="24" cy="24" r="7.5" fill="{red}" opacity="{pulse}"></circle>'

MARKS = [
 ('topen', 'Tally', 'tally', 'Round-1 favourite, tightened: an open ring with a solid on-air light.', t_open),
 ('thalo', 'Tally live', 'tally', 'A closed ring with a glow around the light, the way a tally lamp looks when it is lit.', t_halo),
 ('tnotch', 'Tally notch', 'tally', 'The light sits in the gap of the ring, like the tally lamp on top of a camera.', t_notch),
 ('iring', 'Iris', 'iris', 'Round-2 favourite: three segments for the three screens, with the lit one in the accent colour.', i_ring),
 ('iblades', 'Iris blades', 'iris', 'Solid aperture blades, like a real camera iris. The strongest shape at icon size.', i_blades),
 ('ithin', 'Iris fine', 'iris', 'Thinner segments and a bigger light: lighter and more elegant, best for large sizes.', i_thin),
]
def svg(k, size, fg, C, O, red=RED, pulse='1', halo='11'):
    fn = [m for m in MARKS if m[0]==k][0][4]
    return f'<svg width="{size}" height="{size}" viewBox="0 0 48 48" aria-hidden="true" style="flex-shrink: 0;">{fn(fg, C, O, red, pulse, halo)}</svg>'
def stat(k, size, fg='#ffffff', light=False):
    ac = '{{accD}}' if light else '{{acc}}'
    C = [ac, fg, fg]; O = ['1', '0.75', '0.45']
    return svg(k, size, fg, C, O)
def anim(k, size):
    return svg(k, size, '#ffffff', ['{{an.c0}}','{{an.c1}}','{{an.c2}}'], ['{{an.o0}}','{{an.o1}}','{{an.o2}}'], pulse='{{an.pulse}}', halo='{{an.halo}}')
ICON = "background: linear-gradient(180deg, #2b3039 0%, #16181d 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 12px rgba(0,0,0,0.5); border: 1px solid #0b0c0f;"

cards = ''
for i,(k,name,fam,why,_) in enumerate(MARKS):
    cards += f'''
      <div style="{{{{cards.{k}.box}}}}">
        <div style="height: 150px; border-radius: 8px; background: radial-gradient(circle at 50% 35%, #1d2230 0%, #0c0d11 75%); border: 1px solid #262a32; display: flex; align-items: center; justify-content: center;">{stat(k, 84)}</div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
          <span style="width: 46px; height: 46px; border-radius: 11px; {ICON} display: flex; align-items: center; justify-content: center;">{stat(k, 32)}</span>
          <span style="width: 46px; height: 46px; border-radius: 8px; background: #f5f5f2; display: flex; align-items: center; justify-content: center;">{stat(k, 30, '#14161a', True)}</span>
          <span style="display: flex; align-items: center; gap: 6px;">{stat(k, 24)}{stat(k, 16)}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; flex-grow: 1;">
          <span style="font-size: 14px; font-weight: 600; color: #ffffff;"><span style="font-family: Consolas, monospace; color: #8e9096; font-weight: 400;">{i+1}</span>  {name}</span>
          <span style="font-size: 11.5px; line-height: 1.45; color: #a9abb0;">{why}</span>
        </div>
        <button onClick="{{{{cards.{k}.pick}}}}" style="{{{{cards.{k}.btn}}}}">{{{{cards.{k}.label}}}}</button>
      </div>'''

def per(fn):
    return ''.join(f'<sc-if value="{{{{is.{k}}}}}" hint-placeholder-val="{{{{{"true" if k=="iring" else "false"}}}}}">{fn(k)}</sc-if>' for k,*_ in MARKS)

words = ''
for wid in ['sora', 'caps', 'lower']:
    words += f'''
          <button onClick="{{{{wm.{wid}.pick}}}}" style="{{{{wm.{wid}.box}}}}">
            <span style="display: flex; align-items: center; gap: 12px;">{per(lambda k: stat(k, 38))}<span style="{{{{wm.{wid}.style}}}}">{{{{wm.{wid}.text}}}}</span></span>
            <span style="font-size: 11px; color: #8e9096;">{{{{wm.{wid}.name}}}}</span>
          </button>'''

html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lumora — Logo round 3</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600&amp;display=swap" rel="stylesheet">
<style>
{polish}

button{{cursor:pointer;background-image:none;box-shadow:none}}
body{{margin:0;background:#15171b;font-family:'Segoe UI',system-ui,sans-serif;color:#e4e5e7}}
button{{font-family:inherit}}
</style>
</helmet>
<div style="width: 1440px; height: 1180px; box-sizing: border-box; background: #15171b; padding: 32px 40px; display: flex; flex-direction: column; gap: 20px; font-family: 'Segoe UI', system-ui, sans-serif; color: #e4e5e7; overflow: hidden;">
  <div style="display: flex; align-items: flex-end; gap: 16px;">
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 24px; font-weight: 600; color: #ffffff;">Lumora logo — round 3: Tally and Iris</span>
      <span style="font-size: 13px; color: #8e9096;">Three versions of each of your picks. Choose a mark, a wordmark and an accent colour; the preview at the bottom shows the full logo and its startup animation.</span>
    </div>
    <div style="flex-grow: 1;"></div>
    <span style="font-size: 13px; color: #a9abb0; white-space: nowrap;">Current: <span style="color: #ffffff; font-weight: 600;">{{{{summary}}}}</span></span>
  </div>

  <div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px;">{cards}
  </div>

  <div style="display: grid; grid-template-columns: 1fr 300px; gap: 20px;">
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <span style="font-size: 12px; font-weight: 600; color: #b4b8bf;">Wordmark</span>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;">{words}
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <span style="font-size: 12px; font-weight: 600; color: #b4b8bf;">Accent colour</span>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <sc-for list="{{{{accents}}}}" as="a" hint-placeholder-count="3">
          <button onClick="{{{{a.pick}}}}" style="{{{{a.box}}}}"><span style="{{{{a.sw}}}}"></span><span style="flex-grow: 1; text-align: left;">{{{{a.name}}}}</span><span style="font-size: 11px; color: #8e9096;">{{{{a.note}}}}</span></button>
        </sc-for>
      </div>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: 1.35fr 1fr; gap: 20px; flex-grow: 1; min-height: 0;">
    <div style="position: relative; border-radius: 10px; overflow: hidden; border: 1px solid #2c3038; background: radial-gradient(circle at 50% 42%, #1c2738 0%, #0a0c10 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;">
      <span style="display: flex; align-items: center; gap: 22px;">{per(lambda k: anim(k, 104))}<span style="{{{{wordBig}}}}">{{{{wordText}}}}</span></span>
      <div style="width: 220px; height: 3px; border-radius: 2px; background: #2c3038; overflow: hidden;"><div style="{{{{barFill}}}}"></div></div>
      <span style="font-size: 12px; color: #8e9096;">{{{{animNote}}}}</span>
      <span style="position: absolute; left: 14px; top: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #6f737b;">STARTUP SCREEN</span>
    </div>
    <div style="display: flex; flex-direction: column; gap: 14px; min-height: 0;">
      <div style="flex-grow: 1; border-radius: 10px; background: #f5f5f2; display: flex; align-items: center; justify-content: center; gap: 14px;">{per(lambda k: stat(k, 60, '#14161a', True))}<span style="{{{{wordLight}}}}">{{{{wordText}}}}</span></div>
      <div style="height: 120px; flex-shrink: 0; border-radius: 10px; background: #101216; border: 1px solid #2c3038; display: flex; align-items: center; justify-content: center; gap: 22px;">
        <span style="width: 84px; height: 84px; border-radius: 19px; {ICON} display: flex; align-items: center; justify-content: center;">{per(lambda k: stat(k, 58))}</span>
        <span style="display: flex; flex-direction: column; gap: 8px;">
          <span style="display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px; border-radius: 4px; background: #1a1d22; border: 1px solid #2c3038;">{per(lambda k: stat(k, 18))}<span style="{{{{wordSmall}}}}">{{{{wordText}}}}</span><span style="font-size: 12px; color: #a9abb0; margin-left: 8px;">Event   Presets   Cues</span></span>
          <span style="font-size: 11px; color: #8e9096;">App icon · title bar</span>
        </span>
      </div>
    </div>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":1180}}}}'>
class Component extends DCLogic {{
  componentDidMount() {{ this.__fill(); this.__onRange = (e) => {{ if (e.target && e.target.type === 'range') this.__fill(); }}; document.addEventListener('input', this.__onRange, true); this._t = setInterval(() => this.setState((s) => ({{ frame: s.frame + 1 }})), 700); }}
  componentDidUpdate() {{ this.__fill(); }}
  componentWillUnmount() {{ clearInterval(this._t); document.removeEventListener('input', this.__onRange, true); }}
  __fill() {{ document.querySelectorAll('input[type=range]').forEach((el) => {{ const min = Number(el.min) || 0, max = el.max === '' ? 100 : Number(el.max), v = Number(el.value); el.style.setProperty('--fill', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%'); }}); }}
  constructor(props) {{ super(props); this.state = {{ pick: 'iring', word: 'sora', accent: 'teal', frame: 0 }}; }}
  renderVals() {{
    const st = this.state;
    const NAMES = {{ {', '.join(f"{k}: '{n}'" for k,n,*_ in MARKS)} }};
    const FAM = {{ {', '.join(f"{k}: '{fam}'" for k,n,fam,*_ in MARKS)} }};
    const ACC = {{ teal: ['#4fb3bf', '#1f6f79', 'Teal', 'matches the app'], blue: ['#5b8def', '#2f5bb8', 'Signal blue', 'cooler, more corporate'], white: ['#ffffff', '#14161a', 'Mono', 'red light only'] }};
    const [acc, accD] = ACC[st.accent];
    const cards = {{}}, is = {{}};
    Object.keys(NAMES).forEach((k) => {{
      const on = st.pick === k; is[k] = on;
      cards[k] = {{
        pick: () => this.setState({{ pick: k }}), label: on ? 'Chosen ✓' : 'Choose',
        box: `display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 10px; background: ${{on ? '#1b262d' : '#1c1f25'}}; border: 2px solid ${{on ? acc === '#ffffff' ? '#d4d5d8' : acc : '#2a2e36'}}; box-sizing: border-box;`,
        btn: `height: 32px; border-radius: 6px; border: ${{on ? '0' : '1px solid #3a3f48'}}; background: ${{on ? '#4fb3bf' : '#2a2e36'}}; color: ${{on ? '#0e2a2e' : '#e4e5e7'}}; font-size: 12px; font-weight: 600;`
      }};
    }});
    const WM = {{
      sora: ['Lumora', 'Title case · Sora semibold', "font-family: 'Sora', 'Segoe UI', sans-serif; font-weight: 600; letter-spacing: -0.015em;", 1],
      caps: ['LUMORA', 'Capitals · wide spacing', "font-family: 'Sora', 'Segoe UI', sans-serif; font-weight: 500; letter-spacing: 0.22em;", 0.72],
      lower: ['lumora', 'Lower case · friendly', "font-family: 'Sora', 'Segoe UI', sans-serif; font-weight: 600; letter-spacing: -0.03em;", 1.05]
    }};
    const wm = {{}};
    Object.keys(WM).forEach((id) => {{
      const [text, name, font, sc] = WM[id]; const on = st.word === id;
      wm[id] = {{ text, name, pick: () => this.setState({{ word: id }}),
        style: `${{font}} font-size: ${{Math.round(30 * sc)}}px; color: #ffffff;`,
        box: `height: 92px; padding: 0 16px; border-radius: 8px; background: ${{on ? '#1b262d' : '#101216'}}; border: 2px solid ${{on ? '#4fb3bf' : '#2c3038'}}; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 6px; color: #e4e5e7;` }};
    }});
    const [wText, , wFont, wSc] = WM[st.word];
    const accents = Object.keys(ACC).map((id) => {{ const on = st.accent === id; return {{ name: ACC[id][2], note: ACC[id][3], pick: () => this.setState({{ accent: id }}),
      sw: `width: 18px; height: 18px; border-radius: 50%; background: ${{ACC[id][0]}}; border: 2px solid #0c0d10; box-shadow: 0 0 0 1px #3a3f48;`,
      box: `height: 36px; padding: 0 12px; border-radius: 6px; display: flex; align-items: center; gap: 10px; font-size: 13px; background: ${{on ? '#1b262d' : '#101216'}}; border: 1px solid ${{on ? '#4fb3bf' : '#2c3038'}}; color: #e4e5e7;` }}; }});
    const a = st.frame % 3, beat = st.frame % 2 === 0;
    const iris = FAM[st.pick] === 'iris';
    const an = {{
      c0: iris && a === 0 ? acc : '#ffffff', c1: iris && a === 1 ? acc : '#ffffff', c2: iris && a === 2 ? acc : '#ffffff',
      o0: !iris || a === 0 ? '1' : '0.5', o1: !iris || a === 1 ? '1' : '0.5', o2: !iris || a === 2 ? '1' : '0.5',
      pulse: iris ? '1' : (beat ? '1' : '0.55'), halo: beat ? '11' : '13'
    }};
    return {{
      cards, is, wm, accents, an, acc, accD,
      summary: NAMES[st.pick] + ' · ' + WM[st.word][1].split(' · ')[0] + ' · ' + ACC[st.accent][2],
      wordText: wText,
      wordBig: `${{wFont}} font-size: ${{Math.round(58 * wSc)}}px; color: #ffffff;`,
      wordLight: `${{wFont}} font-size: ${{Math.round(40 * wSc)}}px; color: #14161a;`,
      wordSmall: `${{wFont}} font-size: ${{Math.round(14 * wSc)}}px; color: #ffffff;`,
      barFill: `width: ${{[34, 67, 100][a]}}%; height: 100%; background: ${{acc}}; transition: width .6s ease;`,
      animNote: iris ? 'Startup: the lit segment moves Live → Back → Monitor, then settles.' : 'Startup: the on-air light pulses twice, then stays lit.'
    }};
  }}
}}
</script>
</body>
</html>
'''
open('project/LogoRound3.dc.html', 'w').write(html)
