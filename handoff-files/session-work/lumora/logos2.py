import math
polish = open('project/Pesukim.dc.html').read()
polish = polish[polish.index('/* lumora-polish:start */'):polish.index('/* lumora-polish:end */')+len('/* lumora-polish:end */')]
TEAL, TEAL_D, RED = '#4fb3bf', '#1f6f79', '#e5483c'
def P(cx, cy, r, a): a = math.radians(a); return (cx + r*math.cos(a), cy + r*math.sin(a))
def arc(cx, cy, r, a0, a1):
    x0, y0 = P(cx, cy, r, a0); x1, y1 = P(cx, cy, r, a1)
    return f'M{x0:.2f} {y0:.2f} A{r} {r} 0 {1 if a1-a0>180 else 0} 1 {x1:.2f} {y1:.2f}'

def m_stack(fg, ac, red):
    return (f'<rect x="17" y="7" width="25" height="16" rx="2.5" fill="none" stroke="{fg}" stroke-width="2.6" opacity="0.4"></rect>'
            f'<rect x="11.5" y="13.5" width="25" height="16" rx="2.5" fill="none" stroke="{fg}" stroke-width="2.6" opacity="0.7"></rect>'
            f'<rect x="6" y="20" width="25" height="16.5" rx="2.5" fill="{fg}"></rect>'
            f'<circle cx="26" cy="25" r="2.6" fill="{red}"></circle>'
            f'<rect x="10" y="40" width="17" height="2.6" rx="1.3" fill="{fg}" opacity="0.7"></rect>')
def m_iris(fg, ac, red):
    g = 16
    segs = [(-90 + g/2 + 120*i, -90 - g/2 + 120*(i+1)) for i in range(3)]
    cols = [ac, fg, fg]; ops = [1, 0.75, 0.45]
    return ''.join(f'<path d="{arc(24,24,17,a,b)}" fill="none" stroke="{c}" stroke-width="5" stroke-linecap="round" opacity="{o}"></path>' for (a,b),c,o in zip(segs,cols,ops)) + f'<circle cx="24" cy="24" r="6.5" fill="{red}"></circle>'
def m_cascade(fg, ac, red):
    return (f'<path d="M30 15 L42 17 V31 L30 33 Z" fill="{fg}" opacity="0.35"></path>'
            f'<path d="M19 11.5 L33 14 V34 L19 36.5 Z" fill="{fg}" opacity="0.65"></path>'
            f'<path d="M5 8 L22 11 V37 L5 40 Z" fill="{ac}"></path>'
            f'<circle cx="10" cy="15" r="2.4" fill="{red}"></circle>')
def m_signal(fg, ac, red):
    return f'<circle cx="13" cy="24" r="6.5" fill="{red}"></circle>' + ''.join(
        f'<path d="{arc(13,24,r,-48,48)}" fill="none" stroke="{fg}" stroke-width="4" stroke-linecap="round" opacity="{o}"></path>' for r,o in [(13,1),(20,0.7),(27,0.42)])
def m_finder(fg, ac, red):
    L = 8
    c = [(5,11,1,1),(43,11,-1,1),(5,37,1,-1),(43,37,-1,-1)]
    br = ''.join(f'<path d="M{x} {y+L*dy} V{y} H{x+L*dx}" fill="none" stroke="{fg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>' for x,y,dx,dy in c)
    return br + f'<circle cx="24" cy="24" r="6" fill="{red}"></circle><circle cx="24" cy="24" r="10" fill="none" stroke="{red}" stroke-width="1.6" opacity="0.45"></circle>'
def m_lscreen(fg, ac, red):
    return (f'<path d="M9 10 H39 A3 3 0 0 1 42 13 V34" fill="none" stroke="{fg}" stroke-width="2.6" stroke-linecap="round" opacity="0.45"></path>'
            f'<path d="M9 9 V35 A3 3 0 0 0 12 38 H42" fill="none" stroke="{fg}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path>'
            f'<circle cx="33.5" cy="19" r="4.2" fill="{red}"></circle>')

MARKS = [
 ('stack', 'Tally stack', '2 + 5', 'Three stacked screens, with the front one lit and a red on-air light in its corner. The stand underneath makes it read as a monitor, even at 16 px.', m_stack),
 ('iris', 'Iris', '2 + 5', 'A lens iris made of three segments, one for each screen. The teal segment is the screen you are controlling, and the red centre is the on-air light.', m_iris),
 ('cascade', 'Cascade', '5', 'Three screens in perspective going back into depth, like a stage with a projector wall. The front screen is lit teal, with a tally light.', m_cascade),
 ('signal', 'On air', '2', 'A red on-air light sending out three waves, one for each screen. It reads as broadcast straight away.', m_signal),
 ('finder', 'Viewfinder', '2', 'Camera-frame corners around a recording light. The language of live production.', m_finder),
 ('lscreen', 'Monitor L', '2 + 5', 'A screen whose frame forms a bold L for Lumora, with the on-air light in the corner. It works as both a monogram and an icon.', m_lscreen),
]
def svg(k, size, fg, ac, red=RED, extra=''):
    f = [m for m in MARKS if m[0]==k][0][4]
    return f'<svg width="{size}" height="{size}" viewBox="0 0 48 48" aria-hidden="true" style="flex-shrink: 0;{extra}">{f(fg, ac, red)}</svg>'
WORD = "font-family: 'Sora', 'Segoe UI', sans-serif; font-weight: 600; letter-spacing: -0.015em;"
ICON = "background: linear-gradient(180deg, #2b3039 0%, #16181d 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 12px rgba(0,0,0,0.5); border: 1px solid #0b0c0f;"

cards = []
for i, (k, name, tag, why, _) in enumerate(MARKS):
    cards.append(f'''
      <div style="{{{{cards.{k}.box}}}}">
        <div style="height: 196px; border-radius: 8px; background: radial-gradient(circle at 50% 30%, #1d2230 0%, #0c0d11 75%); border: 1px solid #262a32; display: flex; align-items: center; justify-content: center; gap: 18px;">
          {svg(k, 84, '#ffffff', TEAL)}
          <span style="{WORD} font-size: 40px; color: #ffffff;">Lumora</span>
        </div>
        <div style="display: flex; gap: 10px; height: 84px;">
          <div style="flex-grow: 1; border-radius: 8px; background: #f5f5f2; display: flex; align-items: center; justify-content: center; gap: 10px;">
            {svg(k, 38, '#14161a', TEAL_D)}
            <span style="{WORD} font-size: 24px; color: #14161a;">Lumora</span>
          </div>
          <div style="width: 196px; flex-shrink: 0; border-radius: 8px; background: #101216; border: 1px solid #262a32; display: flex; align-items: center; justify-content: center; gap: 12px;">
            <span style="width: 58px; height: 58px; border-radius: 14px; {ICON} display: flex; align-items: center; justify-content: center;">{svg(k, 40, '#ffffff', TEAL)}</span>
            <span style="display: flex; flex-direction: column; gap: 6px; align-items: center;">{svg(k, 24, '#ffffff', TEAL)}{svg(k, 16, '#ffffff', TEAL)}</span>
          </div>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="display: flex; flex-direction: column; gap: 3px; flex-grow: 1; min-width: 0;">
            <span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: #ffffff;"><span style="font-family: Consolas, monospace; color: #8e9096; font-weight: 400;">{chr(65+i)}</span>{name}<span style="height: 17px; padding: 0 6px; border-radius: 3px; background: #2a2e36; font-size: 10px; font-weight: 500; color: #a9abb0; line-height: 17px;">from {tag}</span></span>
            <span style="font-size: 12px; line-height: 1.45; color: #a9abb0;">{why}</span>
          </div>
          <button onClick="{{{{cards.{k}.pick}}}}" style="{{{{cards.{k}.btn}}}}">{{{{cards.{k}.label}}}}</button>
        </div>
      </div>''')

def per(fn):
    return ''.join(f'<sc-if value="{{{{is.{k}}}}}" hint-placeholder-val="{{{{{"true" if k=="stack" else "false"}}}}}">{fn(k)}</sc-if>' for k, *_ in MARKS)
titlebar = per(lambda k: f'<span style="display: flex; align-items: center; gap: 8px;">{svg(k, 18, "#ffffff", TEAL)}<span style="{WORD} font-size: 14px; color: #ffffff;">Lumora</span></span>')
splash = per(lambda k: f'<span style="display: flex; align-items: center; gap: 14px;">{svg(k, 56, "#ffffff", TEAL)}<span style="{WORD} font-size: 30px; color: #ffffff;">Lumora</span></span>')
taskbar = per(lambda k: f'<span style="width: 40px; height: 40px; border-radius: 6px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; box-shadow: inset 0 -2px 0 {TEAL};">{svg(k, 24, "#ffffff", TEAL)}</span>')
tab = per(lambda k: f'<span style="display: flex; align-items: center; gap: 7px;">{svg(k, 16, "#14161a", TEAL_D)}<span style="font-size: 12px; color: #14161a;">Lumora — Download</span></span>')

html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lumora — Logo round 2</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600&amp;display=swap" rel="stylesheet">
<style>
{polish}

button{{cursor:pointer;background-image:none;box-shadow:none}}
body{{margin:0;background:#15171b;font-family:'Segoe UI',system-ui,sans-serif;color:#e4e5e7}}
button{{font-family:inherit}}
</style>
</helmet>
<div style="width: 1440px; height: 1160px; box-sizing: border-box; background: #15171b; padding: 32px 40px; display: flex; flex-direction: column; gap: 20px; font-family: 'Segoe UI', system-ui, sans-serif; color: #e4e5e7; overflow: hidden;">
  <div style="display: flex; align-items: flex-end; gap: 16px;">
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 24px; font-weight: 600; color: #ffffff;">Lumora logo — round 2</span>
      <span style="font-size: 13px; color: #8e9096;">Built from your picks: 2 (the on-air tally light) and 5 (three screens). Each is shown large, on light, as a Windows app icon, and at 24 and 16 px.</span>
    </div>
    <div style="flex-grow: 1;"></div>
    <span style="font-size: 13px; color: #a9abb0;">Chosen: <span style="color: #ffffff; font-weight: 600;">{{{{chosenName}}}}</span></span>
  </div>

  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px;">{''.join(cards)}
  </div>

  <div style="display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 20px; flex-grow: 1; min-height: 0;">
    <div style="border-radius: 8px; overflow: hidden; border: 1px solid #2c3038; display: flex; flex-direction: column; background: #15171b;">
      <div style="height: 34px; flex-shrink: 0; display: flex; align-items: center; gap: 14px; padding: 0 12px; background: #1a1d22; border-bottom: 1px solid #2c3038; font-size: 12px; color: #d4d5d8;">{titlebar}<span>Event</span><span>Presets</span><span>Cues</span><div style="flex-grow: 1;"></div><span style="font-family: Consolas, monospace; color: #a9abb0;">19:42:05</span></div>
      <div style="flex-grow: 1; min-height: 0;"></div>
      <div style="height: 48px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 6px; background: #0f1a2a;">{taskbar}<span style="font-size: 11px; color: #8e9096; margin-left: 6px;">Windows taskbar</span></div>
    </div>
    <div style="border-radius: 8px; overflow: hidden; border: 1px solid #2c3038; background: radial-gradient(circle at 50% 40%, #1d2a3a, #0c0e12 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;">
      {splash}
      <div style="width: 160px; height: 3px; border-radius: 2px; background: #2c3038; overflow: hidden;"><div style="width: 62%; height: 100%; background: {TEAL};"></div></div>
    </div>
    <div style="border-radius: 8px; overflow: hidden; border: 1px solid #2c3038; background: #dfe1e5; display: flex; flex-direction: column;">
      <div style="height: 36px; flex-shrink: 0; display: flex; align-items: flex-end; padding: 0 10px;"><span style="height: 30px; padding: 0 12px; border-radius: 8px 8px 0 0; background: #ffffff; display: flex; align-items: center;">{tab}</span></div>
      <div style="flex-grow: 1; background: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #8e9096;">Browser tab (favicon)</div>
    </div>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":1160}}}}'>
class Component extends DCLogic {{
  componentDidMount() {{ this.__fill(); this.__onRange = (e) => {{ if (e.target && e.target.type === 'range') this.__fill(); }}; document.addEventListener('input', this.__onRange, true); }}
  componentDidUpdate() {{ this.__fill(); }}
  componentWillUnmount() {{ document.removeEventListener('input', this.__onRange, true); }}
  __fill() {{ document.querySelectorAll('input[type=range]').forEach((el) => {{ const min = Number(el.min) || 0, max = el.max === '' ? 100 : Number(el.max), v = Number(el.value); el.style.setProperty('--fill', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%'); }}); }}
  constructor(props) {{ super(props); this.state = {{ pick: 'stack' }}; }}
  renderVals() {{
    const st = this.state;
    const NAMES = {{ {', '.join(f"{k}: '{n}'" for k, n, *_ in MARKS)} }};
    const cards = {{}}, is = {{}};
    Object.keys(NAMES).forEach((k) => {{
      const on = st.pick === k;
      is[k] = on;
      cards[k] = {{
        pick: () => this.setState({{ pick: k }}),
        label: on ? 'Chosen ✓' : 'Choose',
        box: `display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 10px; background: ${{on ? '#1b262d' : '#1c1f25'}}; border: 2px solid ${{on ? '#4fb3bf' : '#2a2e36'}}; box-sizing: border-box;`,
        btn: `flex-shrink: 0; height: 34px; padding: 0 14px; border-radius: 6px; border: ${{on ? '0' : '1px solid #3a3f48'}}; background: ${{on ? '#4fb3bf' : '#2a2e36'}}; color: ${{on ? '#0e2a2e' : '#e4e5e7'}}; font-size: 12px; font-weight: 600; white-space: nowrap;`
      }};
    }});
    return {{ cards, is, chosenName: NAMES[st.pick] }};
  }}
}}
</script>
</body>
</html>
'''
open('project/LogoRound2.dc.html', 'w').write(html)
