import re
polish = open('project/Pesukim.dc.html').read()
polish = polish[polish.index('/* lumora-polish:start */'):polish.index('/* lumora-polish:end */')+len('/* lumora-polish:end */')]

# Each mark: fn(fg, accent) -> inner svg (viewBox 0 0 48 48)
MARKS = [
 ('beam', 'Beam', 'Three rays of light from one source: one app lighting the Live screen, the Back screen and the Monitor.',
  lambda fg, ac: f'<circle cx="11" cy="37" r="4.5" fill="{ac}"></circle><path d="M17.8 35.2 L38 29.8" stroke="{fg}" stroke-width="5.5" stroke-linecap="round"></path><path d="M15.9 32.1 L30.8 17.2" stroke="{fg}" stroke-width="5.5" stroke-linecap="round" opacity="0.8"></path><path d="M12.8 30.2 L18.2 10" stroke="{fg}" stroke-width="5.5" stroke-linecap="round" opacity="0.55"></path>'),
 ('tally', 'Tally', 'The red on-air light inside a ring: the signal every crew watches.',
  lambda fg, ac: f'<path d="M36.5 11.5 A17 17 0 1 0 41 24" fill="none" stroke="{fg}" stroke-width="5" stroke-linecap="round"></path><circle cx="24" cy="24" r="6.5" fill="{ac}"></circle>'),
 ('horizon', 'Horizon', 'Light rising over the stage, with aurora arcs overhead. Lumora comes from lumen (light) and aurora.',
  lambda fg, ac: f'<path d="M6 36 H42" stroke="{fg}" stroke-width="4" stroke-linecap="round"></path><path d="M14 36 A10 10 0 0 1 34 36 Z" fill="{ac}"></path><path d="M9 29 A16 16 0 0 1 39 29" fill="none" stroke="{fg}" stroke-width="3.5" stroke-linecap="round"></path><path d="M13 16.5 A20 20 0 0 1 35 16.5" fill="none" stroke="{fg}" stroke-width="3.5" stroke-linecap="round" opacity="0.55"></path>'),
 ('lmark', 'L-mark', 'A bold L with a soft corner and a spotlight dot. Simple, and still readable at 16 px.',
  lambda fg, ac: f'<path d="M15 8 V28 A11 11 0 0 0 26 39 H36" fill="none" stroke="{fg}" stroke-width="7" stroke-linecap="round"></path><circle cx="35" cy="15" r="5.5" fill="{ac}"></circle>'),
 ('screens', 'Three screens', 'Three stacked screens, with the front one lit. The idea at the heart of the app: pick which screen you control.',
  lambda fg, ac: f'<rect x="17" y="7" width="24" height="16" rx="3" fill="none" stroke="{fg}" stroke-width="3" opacity="0.5"></rect><rect x="12" y="15" width="24" height="16" rx="3" fill="none" stroke="{fg}" stroke-width="3" opacity="0.8"></rect><rect x="7" y="23" width="24" height="16" rx="3" fill="{ac}"></rect>'),
]
TEAL, TEAL_D, RED = '#4fb3bf', '#1f6f79', '#e0473b'
def acc(k, light=False):
    if k == 'tally': return RED
    return TEAL_D if light else TEAL
def svg(k, size, fg, ac, extra=''):
    m = [x for x in MARKS if x[0] == k][0]
    return f'<svg width="{size}" height="{size}" viewBox="0 0 48 48" aria-hidden="true" style="flex-shrink: 0;{extra}">{m[3](fg, ac)}</svg>'
WORD = "font-family: 'Sora', 'Segoe UI', sans-serif; font-weight: 600; letter-spacing: -0.01em;"

cards = []
for i, (k, name, why, _) in enumerate(MARKS):
    cards.append(f'''
      <div style="{{{{cards.{k}.box}}}}">
        <div style="height: 150px; border-radius: 6px; background: #101216; border: 1px solid #2c3038; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;">
          {svg(k, 64, '#ffffff', acc(k))}
          <span style="{WORD} font-size: 22px; color: #ffffff;">Lumora</span>
        </div>
        <div style="height: 72px; border-radius: 6px; background: #f4f4f1; display: flex; align-items: center; justify-content: center; gap: 10px;">
          {svg(k, 36, '#15171b', acc(k, True))}
          <span style="{WORD} font-size: 22px; color: #15171b;">Lumora</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="width: 56px; height: 56px; border-radius: 13px; background: #1e2127; border: 1px solid #3a3f48; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">{svg(k, 38, '#ffffff', acc(k))}</span>
          <span style="width: 32px; height: 32px; border-radius: 8px; background: {TEAL_D if k != 'tally' else '#2a2e36'}; display: flex; align-items: center; justify-content: center;">{svg(k, 22, '#ffffff', '#ffffff' if k != 'tally' else RED)}</span>
          <span style="display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; border-radius: 4px; background: #2a2e36; font-size: 11px; color: #d4d5d8;">{svg(k, 16, '#ffffff', acc(k))}Lumora</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1;">
          <span style="font-size: 15px; font-weight: 600; color: #ffffff;"><span style="font-family: Consolas, monospace; color: #8e9096; font-weight: 400;">{i+1}</span>  {name}</span>
          <span style="font-size: 12px; line-height: 1.45; color: #a9abb0;">{why}</span>
        </div>
        <button onClick="{{{{cards.{k}.pick}}}}" style="{{{{cards.{k}.btn}}}}">{{{{cards.{k}.label}}}}</button>
      </div>''')

def per(fn):
    return ''.join(f'<sc-if value="{{{{is.{k}}}}}" hint-placeholder-val="{{{{{"true" if k=="beam" else "false"}}}}}">{fn(k)}</sc-if>' for k, *_ in MARKS)

titlebar = per(lambda k: f'<span style="display: flex; align-items: center; gap: 8px;">{svg(k, 18, "#ffffff", acc(k))}<span style="{WORD} font-size: 14px; color: #ffffff;">Lumora</span></span>')
splash = per(lambda k: f'<span style="display: flex; flex-direction: column; align-items: center; gap: 14px;">{svg(k, 88, "#ffffff", acc(k))}<span style="{WORD} font-size: 34px; color: #ffffff;">Lumora</span></span>')
web = per(lambda k: f'<span style="display: flex; align-items: center; gap: 9px;">{svg(k, 26, "#15171b", acc(k, True))}<span style="{WORD} font-size: 19px; color: #15171b;">Lumora</span></span>')
taskbar = per(lambda k: f'<span style="width: 34px; height: 34px; border-radius: 6px; background: rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; box-shadow: inset 0 -2px 0 {TEAL};">{svg(k, 22, "#ffffff", acc(k))}</span>')

html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lumora — Logo options</title>
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
<div style="width: 1440px; height: 1060px; box-sizing: border-box; background: #15171b; padding: 32px 40px; display: flex; flex-direction: column; gap: 22px; font-family: 'Segoe UI', system-ui, sans-serif; color: #e4e5e7; overflow: hidden;">
  <div style="display: flex; align-items: flex-end; gap: 16px;">
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 24px; font-weight: 600; color: #ffffff;">Lumora logo — pick one</span>
      <span style="font-size: 13px; color: #8e9096;">Each mark is shown on dark, on light, as an app icon, a small button icon and a 16 px favicon. The wordmark is the same for all five, so you're only comparing the marks.</span>
    </div>
    <div style="flex-grow: 1;"></div>
    <span style="font-size: 13px; color: #a9abb0;">Chosen: <span style="color: #ffffff; font-weight: 600;">{{{{chosenName}}}}</span></span>
  </div>

  <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px;">{''.join(cards)}
  </div>

  <div style="display: flex; flex-direction: column; gap: 10px; min-height: 0; flex-grow: 1;">
    <span style="font-size: 12px; font-weight: 600; color: #b4b8bf;">In use — {{{{chosenName}}}}</span>
    <div style="display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: 16px; flex-grow: 1; min-height: 0;">
      <div style="border-radius: 8px; overflow: hidden; border: 1px solid #2c3038; display: flex; flex-direction: column; background: #15171b;">
        <div style="height: 34px; flex-shrink: 0; display: flex; align-items: center; gap: 14px; padding: 0 12px; background: #1a1d22; border-bottom: 1px solid #2c3038; font-size: 12px; color: #d4d5d8;">{titlebar}<span>Event</span><span>Presets</span><span>Cues</span><span>Library</span><div style="flex-grow: 1;"></div><span style="font-family: Consolas, monospace; color: #a9abb0;">19:42:05</span></div>
        <div style="flex-grow: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px;">
          <div style="position: relative; border-radius: 4px; overflow: hidden; border: 2px solid #2f8f4e;"><dc-import name="Scene" kind="closeup" hint-size="100%,100%"></dc-import></div>
          <div style="position: relative; border-radius: 4px; overflow: hidden; border: 2px solid #c7372f;"><dc-import name="Scene" kind="stage" hint-size="100%,100%"></dc-import></div>
        </div>
        <div style="height: 44px; flex-shrink: 0; display: flex; align-items: center; gap: 6px; padding: 0 10px; background: #0f1a2a;">{taskbar}<span style="font-size: 11px; color: #a9abb0;">Windows taskbar</span></div>
      </div>
      <div style="border-radius: 8px; overflow: hidden; border: 1px solid #2c3038; background: radial-gradient(circle at 50% 40%, #1d2a3a, #0c0e12 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;">
        {splash}
        <div style="width: 180px; height: 3px; border-radius: 2px; background: #2c3038; overflow: hidden;"><div style="width: 62%; height: 100%; background: {TEAL};"></div></div>
        <span style="font-size: 11px; color: #8e9096;">Starting · loading presets</span>
      </div>
      <div style="border-radius: 8px; overflow: hidden; border: 1px solid #2c3038; background: #f4f4f1; display: flex; flex-direction: column;">
        <div style="height: 56px; flex-shrink: 0; display: flex; align-items: center; gap: 18px; padding: 0 18px; border-bottom: 1px solid #deded8; font-size: 12px; color: #4a4d55;">{web}<div style="flex-grow: 1;"></div><span>Features</span><span>Download</span></div>
        <div style="flex-grow: 1; padding: 22px 18px; display: flex; flex-direction: column; gap: 10px;">
          <span style="{WORD} font-size: 24px; line-height: 1.2; color: #15171b;">Run the whole event from one screen.</span>
          <span style="font-size: 12.5px; line-height: 1.5; color: #4a4d55;">Live stream, projector and stage monitor, all offline on your Windows PC.</span>
          <span style="align-self: flex-start; height: 34px; padding: 0 14px; border-radius: 6px; background: #1f6f79; color: #ffffff; font-size: 12px; font-weight: 600; display: flex; align-items: center;">Download for Windows</span>
        </div>
      </div>
    </div>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":1060}}}}'>
class Component extends DCLogic {{
  componentDidMount() {{ this.__fill(); this.__onRange = (e) => {{ if (e.target && e.target.type === 'range') this.__fill(); }}; document.addEventListener('input', this.__onRange, true); }}
  componentDidUpdate() {{ this.__fill(); }}
  componentWillUnmount() {{ document.removeEventListener('input', this.__onRange, true); }}
  __fill() {{ document.querySelectorAll('input[type=range]').forEach((el) => {{ const min = Number(el.min) || 0, max = el.max === '' ? 100 : Number(el.max), v = Number(el.value); el.style.setProperty('--fill', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%'); }}); }}
  constructor(props) {{ super(props); this.state = {{ pick: 'beam' }}; }}
  renderVals() {{
    const st = this.state;
    const NAMES = {{ {', '.join(f"{k}: '{n}'" for k, n, *_ in MARKS)} }};
    const cards = {{}}, is = {{}};
    Object.keys(NAMES).forEach((k) => {{
      const on = st.pick === k;
      is[k] = on;
      cards[k] = {{
        pick: () => this.setState({{ pick: k }}),
        label: on ? 'Chosen ✓' : 'Choose this',
        box: `display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 8px; background: ${{on ? '#1c2a31' : '#1e2127'}}; border: 2px solid ${{on ? '#4fb3bf' : '#2c3038'}}; box-sizing: border-box;`,
        btn: `height: 36px; border-radius: 6px; border: ${{on ? '0' : '1px solid #3a3f48'}}; background: ${{on ? '#4fb3bf' : '#2a2e36'}}; color: ${{on ? '#0e2a2e' : '#e4e5e7'}}; font-size: 13px; font-weight: 600;`
      }};
    }});
    return {{ cards, is, chosenName: NAMES[st.pick] }};
  }}
}}
</script>
</body>
</html>
'''
open('project/LogoOptions.dc.html', 'w').write(html)
