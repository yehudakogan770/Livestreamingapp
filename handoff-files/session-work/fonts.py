import sys; sys.path.insert(0,'.')
from brand import mark
polish = open('lumora/project/Pesukim.dc.html').read()
polish = polish[polish.index('/* lumora-polish:start */'):polish.index('/* lumora-polish:end */')+len('/* lumora-polish:end */')]
F = [
 ('sora', 'Sora', "'Sora'", 600, '-0.015em', 'Current choice. Geometric and calm; clean, but you see it in many apps.'),
 ('unbounded', 'Unbounded', "'Unbounded'", 600, '-0.02em', 'Wide and rounded with a lot of personality. Instantly recognisable on a big screen.'),
 ('bricolage', 'Bricolage Grotesque', "'Bricolage Grotesque'", 700, '-0.025em', 'A modern grotesque with ink-trap details. Distinctive but still professional.'),
 ('saira', 'Saira', "'Saira'", 600, '0em', 'Squared, slightly condensed. Feels like sports and broadcast TV graphics; great numbers.'),
 ('michroma', 'Michroma', "'Michroma'", 400, '0.02em', 'Extended and technical, like the labels on broadcast hardware. Best for name and headings only.'),
 ('spacegrotesk', 'Space Grotesk', "'Space Grotesk'", 600, '-0.02em', 'A technical grotesque with quirky letters (a, t, y). Friendly and precise.'),
]
link = '<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600&amp;family=Unbounded:wght@600&amp;family=Bricolage+Grotesque:opsz,wght@12..96,700&amp;family=Saira:wght@600&amp;family=Michroma&amp;family=Space+Grotesk:wght@600&amp;display=swap" rel="stylesheet">'
def fs(k): f=[x for x in F if x[0]==k][0]; return f"font-family: {f[2]}, 'Segoe UI', sans-serif; font-weight: {f[3]}; letter-spacing: {f[4]};"
cards=''
for i,(k,name,fam,w,ls,why) in enumerate(F):
    cards+=f'''
      <div style="{{{{cards.{k}.box}}}}">
        <div style="height: 110px; border-radius: 8px; background: radial-gradient(circle at 50% 35%, #1d2230 0%, #0c0d11 75%); border: 1px solid #262a32; display: flex; align-items: center; justify-content: center; gap: 12px;">{mark(46)}<span style="{fs(k)} font-size: 36px; color: #ffffff;">Lumora</span></div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="{fs(k)} font-size: 15px; color: #ffffff; flex-grow: 1; white-space: nowrap;">Live Screen · Back · Monitor</span>
          <span style="{fs(k)} font-size: 24px; color: #ffffff;">04:59</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; flex-grow: 1;">
          <span style="font-size: 14px; font-weight: 600; color: #ffffff;"><span style="font-family: Consolas, monospace; color: #8e9096; font-weight: 400;">{i+1}</span>  {name}</span>
          <span style="font-size: 12px; line-height: 1.45; color: #a9abb0;">{why}</span>
        </div>
        <button onClick="{{{{cards.{k}.pick}}}}" style="{{{{cards.{k}.btn}}}}">{{{{cards.{k}.label}}}}</button>
      </div>'''
FJS = ', '.join(k + ': [' + repr(n) + ', "' + fs(k) + '"]' for k,n,*_ in F)
html=f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lumora — Brand font</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{link}
<style>
{polish}

button{{cursor:pointer;background-image:none;box-shadow:none}}
body{{margin:0;background:#15171b;font-family:'Segoe UI',system-ui,sans-serif;color:#e4e5e7}}
button{{font-family:inherit}}
</style>
</helmet>
<div style="width: 1440px; height: 1120px; box-sizing: border-box; background: #15171b; padding: 32px 40px; display: flex; flex-direction: column; gap: 20px; font-family: 'Segoe UI', system-ui, sans-serif; color: #e4e5e7; overflow: hidden;">
  <div style="display: flex; align-items: flex-end; gap: 16px;">
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 24px; font-weight: 600; color: #ffffff;">Lumora's own font — pick one</span>
      <span style="font-size: 13px; color: #8e9096;">Used for the name, headings, screen names, big buttons and countdown numbers. Small menu text stays in Segoe UI so it's easy to read. Every option is free to bundle with the app, so it works offline.</span>
    </div>
    <div style="flex-grow: 1;"></div>
    <span style="font-size: 13px; color: #a9abb0; white-space: nowrap;">Chosen: <span style="color: #ffffff; font-weight: 600;">{{{{chosenName}}}}</span></span>
  </div>

  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;">{cards}
  </div>

  <div style="display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; flex-grow: 1; min-height: 0;">
    <div style="border-radius: 10px; overflow: hidden; border: 1px solid #2c3038; background: #15171b; display: flex; flex-direction: column;">
      <div style="height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 16px; padding: 0 14px; background: #1a1d22; border-bottom: 1px solid #2c3038; font-size: 12px; color: #d4d5d8;">
        <span style="display: flex; align-items: center; gap: 8px;">{mark(18)}<span style="{{{{f}}}} font-size: 15px; color: #ffffff;">Lumora</span></span><span>Event</span><span>Presets</span><span>Cues</span><span>Library</span>
      </div>
      <div style="padding: 12px 14px; display: flex; gap: 8px;">
        <sc-for list="{{{{tabs}}}}" as="t" hint-placeholder-count="3">
          <span style="{{{{t.style}}}}"><span style="{{{{f}}}} font-size: 16px; color: #ffffff;">{{{{t.name}}}}</span><span style="font-size: 11px; color: #a9abb0;">{{{{t.sub}}}}</span></span>
        </sc-for>
      </div>
      <div style="flex-grow: 1; display: grid; grid-template-columns: 1fr 180px; gap: 12px; padding: 0 14px 14px; min-height: 0;">
        <div style="position: relative; border-radius: 6px; overflow: hidden; border: 2px solid #c7372f; background: radial-gradient(circle at 50% 40%, #1c2a4a, #070a12 75%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
          <span style="{{{{f}}}} font-size: 18px; color: #d8b56a; text-transform: uppercase; letter-spacing: 0.12em;">The celebration begins in</span>
          <span style="{{{{f}}}} font-size: 88px; line-height: 1; color: #ffffff;">04:59</span>
          <span style="position: absolute; left: 8px; top: 8px; height: 18px; padding: 0 6px; border-radius: 3px; background: #c7372f; font-size: 10px; font-weight: 600; line-height: 18px; color: #fff;">PROGRAM · HYPE COUNTDOWN</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <span style="height: 58px; border-radius: 6px; background: #c7372f; display: flex; align-items: center; justify-content: center;"><span style="{{{{f}}}} font-size: 20px; color: #ffffff; letter-spacing: 0.06em;">TAKE</span></span>
          <span style="height: 40px; border-radius: 6px; border: 1px solid #3a3f48; background: #2a2e36; display: flex; align-items: center; justify-content: center;"><span style="{{{{f}}}} font-size: 14px; color: #ffffff; letter-spacing: 0.06em;">CUT</span></span>
          <span style="flex-grow: 1; border-radius: 6px; background: #101216; border: 1px solid #2c3038; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;"><span style="font-size: 10px; color: #8e9096;">Recording</span><span style="{{{{f}}}} font-size: 22px; color: #ffffff;">00:42:17</span></span>
        </div>
      </div>
    </div>
    <div style="border-radius: 10px; overflow: hidden; border: 1px solid #2c3038; background: radial-gradient(circle at 50% 42%, #1c2738 0%, #0a0c10 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;">
      <span style="display: flex; align-items: center; gap: 18px;">{mark(84)}<span style="{{{{f}}}} font-size: 56px; color: #ffffff;">Lumora</span></span>
      <span style="font-size: 12px; color: #8e9096;">Startup screen</span>
    </div>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":1120}}}}'>
class Component extends DCLogic {{
  constructor(props) {{ super(props); this.state = {{ pick: 'bricolage', tab: 'live' }}; }}
  renderVals() {{
    const st = this.state;
    const F = {{ {FJS} }};
    const cards = {{}};
    Object.keys(F).forEach((k) => {{
      const on = st.pick === k;
      cards[k] = {{ pick: () => this.setState({{ pick: k }}), label: on ? 'Chosen ✓' : 'Choose',
        box: `display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 10px; background: ${{on ? '#1b262d' : '#1c1f25'}}; border: 2px solid ${{on ? '#4fb3bf' : '#2a2e36'}}; box-sizing: border-box;`,
        btn: `height: 34px; border-radius: 6px; border: ${{on ? '0' : '1px solid #3a3f48'}}; background: ${{on ? '#4fb3bf' : '#2a2e36'}}; color: ${{on ? '#0e2a2e' : '#e4e5e7'}}; font-size: 12px; font-weight: 600;` }};
    }});
    const tabs = [['live', 'Live Screen', 'Display 2 + stream'], ['back', 'Back Screen', 'Display 3'], ['monitor', 'Monitor', 'Display 4 · text']].map(([id, name, sub]) => {{
      const on = st.tab === id;
      return {{ name, sub, style: `flex: 1 1 0; height: 50px; padding: 0 12px; border-radius: 8px; border: 2px solid ${{on ? '#4fb3bf' : '#2c3038'}}; background: ${{on ? '#243039' : '#1e2127'}}; display: flex; flex-direction: column; justify-content: center; gap: 1px; box-sizing: border-box;` }};
    }});
    return {{ cards, tabs, f: F[st.pick][1], chosenName: F[st.pick][0] }};
  }}
}}
</script>
</body>
</html>
'''
open('lumora/project/FontOptions.dc.html','w').write(html)
