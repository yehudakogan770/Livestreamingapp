import sys; sys.path.insert(0,'.')
from brand import mark
polish = open('lumora/project/Pesukim.dc.html').read()
polish = polish[polish.index('/* lumora-polish:start */'):polish.index('/* lumora-polish:end */')+len('/* lumora-polish:end */')]
# key, name, css family, weight, spacing, extra css, iris size factor, blurb
F = [
 ('syne', 'Syne', "'Syne'", 800, '-0.02em', '', 0.76, 'Made for an art centre: wide, quirky letterforms that get wider as they get bolder. Artsy and confident.'),
 ('shoulders', 'Big Shoulders', "'Big Shoulders Display'", 800, '0.01em', 'text-transform: uppercase;', 0.76, 'Tall, condensed, industrial. The look of stadium scoreboards and arena screens; huge countdown numbers.'),
 ('fraunces', 'Fraunces', "'Fraunces'", 800, '-0.02em', "font-variation-settings: 'SOFT' 100, 'WONK' 1;", 0.7, 'A soft, chunky display serif with playful curves. Warm and celebratory, very different from other tech apps.'),
 ('dela', 'Dela Gothic', "'Dela Gothic One'", 400, '0em', '', 0.74, 'Ultra-heavy, blocky and bold. Reads from the back of the hall and feels like a poster.'),
 ('krona', 'Krona One', "'Krona One'", 400, '-0.01em', '', 0.76, 'Extra wide and heavy with a Scandinavian-signage feel. Strong and steady on big screens.'),
 ('tilt', 'Tilt Warp', "'Tilt Warp'", 400, '0em', '', 0.76, 'Bold letters with a built-in sense of depth, like they are leaning into the light.'),
]
link = '<link href="https://fonts.googleapis.com/css2?family=Syne:wght@800&amp;family=Big+Shoulders+Display:wght@800&amp;family=Fraunces:opsz,wght,SOFT,WONK@144,800,100,1&amp;family=Dela+Gothic+One&amp;family=Krona+One&amp;family=Tilt+Warp&amp;display=swap" rel="stylesheet">'
def fs(k):
    f=[x for x in F if x[0]==k][0]
    return f"font-family: {f[2]}, 'Segoe UI', sans-serif; font-weight: {f[3]}; letter-spacing: {f[4]}; {f[5]}"
def word(k, size, color='#ffffff'):
    f=[x for x in F if x[0]==k][0]; ir = round(size * f[6])
    txt_all = 'LUMORA' if 'uppercase' in f[5] else 'Lumora'
    a, b = ('LUM', 'RA') if 'uppercase' in f[5] else ('Lum', 'ra')
    plain = f'<span style="{fs(k)} font-size: {size}px; line-height: 1; color: {color};">{txt_all}</span>'
    iris = f'<span style="display: inline-flex; align-items: baseline; {fs(k)} font-size: {size}px; line-height: 1; color: {color};">{a}<span style="display: inline-block; width: {ir}px; height: {ir}px; margin: 0 {round(size*0.02)}px; transform: translateY({round(ir*0.1)}px);">{mark(ir)}</span>{b}</span>'
    return f'<sc-if value="{{{{irisO}}}}" hint-placeholder-val="{{{{true}}}}">{iris}</sc-if><sc-if value="{{{{plainO}}}}" hint-placeholder-val="{{{{false}}}}"><span style="display: inline-flex; align-items: center; gap: {round(size*0.3)}px;">{mark(round(size*1.05))}{plain}</span></sc-if>'
cards=''
for i,(k,name,fam,w,ls,ex,irf,why) in enumerate(F):
    cards+=f'''
      <div style="{{{{cards.{k}.box}}}}">
        <div style="height: 150px; border-radius: 8px; background: radial-gradient(circle at 50% 35%, #1d2230 0%, #0c0d11 75%); border: 1px solid #262a32; display: flex; align-items: center; justify-content: center;">{word(k, 58)}</div>
        <div style="display: flex; align-items: baseline; gap: 12px;">
          <span style="{fs(k)} font-size: 18px; color: #ffffff; flex-grow: 1; white-space: nowrap; overflow: hidden;">Back Screen</span>
          <span style="{fs(k)} font-size: 34px; line-height: 1; color: #ffffff;">04:59</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; flex-grow: 1;">
          <span style="font-size: 14px; font-weight: 600; color: #ffffff;"><span style="font-family: Consolas, monospace; color: #8e9096; font-weight: 400;">{chr(65+i)}</span>  {name}</span>
          <span style="font-size: 12px; line-height: 1.45; color: #a9abb0;">{why}</span>
        </div>
        <button onClick="{{{{cards.{k}.pick}}}}" style="{{{{cards.{k}.btn}}}}">{{{{cards.{k}.label}}}}</button>
      </div>'''
def per(fn):
    return ''.join(f'<sc-if value="{{{{is.{k}}}}}" hint-placeholder-val="{{{{{"true" if k=="syne" else "false"}}}}}">{fn(k)}</sc-if>' for k,*_ in F)
FJS = ', '.join(k + ': ' + repr(n) for k,n,*_ in F)
html=f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lumora — Brand font round 2</title>
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
<div style="width: 1440px; height: 1180px; box-sizing: border-box; background: #15171b; padding: 32px 40px; display: flex; flex-direction: column; gap: 20px; font-family: 'Segoe UI', system-ui, sans-serif; color: #e4e5e7; overflow: hidden;">
  <div style="display: flex; align-items: flex-end; gap: 16px;">
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 24px; font-weight: 600; color: #ffffff;">Lumora's font — round 2: more character</span>
      <span style="font-size: 13px; color: #8e9096;">Bolder typefaces with real personality. Turn on "Logo as the O" to build the iris right into the name, so the wordmark belongs only to Lumora.</span>
    </div>
    <div style="flex-grow: 1;"></div>
    <div style="display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: #101216; border: 1px solid #2c3038;">
      <button onClick="{{{{setIris}}}}" style="{{{{irisBtn}}}}">Logo as the O</button>
      <button onClick="{{{{setPlain}}}}" style="{{{{plainBtn}}}}">Logo beside the name</button>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;">{cards}
  </div>

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex-grow: 1; min-height: 0;">
    <div style="border-radius: 10px; overflow: hidden; border: 1px solid #2c3038; background: radial-gradient(circle at 50% 42%, #1c2738 0%, #0a0c10 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;">
      {per(lambda k: word(k, 80))}
      <span style="font-size: 12px; color: #8e9096;">Startup screen · {{{{chosenName}}}}</span>
    </div>
    <div style="border-radius: 10px; overflow: hidden; border: 1px solid #2c3038; background: radial-gradient(circle at 50% 40%, #1c2a4a, #070a12 75%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">
      {per(lambda k: f'<span style="{fs(k)} font-size: 22px; color: #d8b56a; letter-spacing: 0.1em; text-transform: uppercase;">The celebration begins in</span><span style="{fs(k)} font-size: 120px; line-height: 1; color: #ffffff;">04:59</span>')}
      <span style="font-size: 12px; color: #8e9096;">Hype countdown on the big screen</span>
    </div>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":1180}}}}'>
class Component extends DCLogic {{
  constructor(props) {{ super(props); this.state = {{ pick: 'syne', iris: true }}; }}
  renderVals() {{
    const st = this.state;
    const N = {{ {FJS} }};
    const cards = {{}}, is = {{}};
    Object.keys(N).forEach((k) => {{
      const on = st.pick === k; is[k] = on;
      cards[k] = {{ pick: () => this.setState({{ pick: k }}), label: on ? 'Chosen ✓' : 'Choose',
        box: `display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 10px; background: ${{on ? '#1b262d' : '#1c1f25'}}; border: 2px solid ${{on ? '#4fb3bf' : '#2a2e36'}}; box-sizing: border-box;`,
        btn: `height: 34px; border-radius: 6px; border: ${{on ? '0' : '1px solid #3a3f48'}}; background: ${{on ? '#4fb3bf' : '#2a2e36'}}; color: ${{on ? '#0e2a2e' : '#e4e5e7'}}; font-size: 12px; font-weight: 600;` }};
    }});
    const seg = (on) => `height: 30px; padding: 0 14px; border: 0; border-radius: 4px; background: ${{on ? '#243039' : 'transparent'}}; color: ${{on ? '#ffffff' : '#a9abb0'}}; font-size: 12px; font-weight: 600; box-shadow: ${{on ? 'inset 0 0 0 1px #4fb3bf' : 'none'}};`;
    return {{ cards, is, chosenName: N[st.pick], irisO: st.iris, plainO: !st.iris,
      setIris: () => this.setState({{ iris: true }}), setPlain: () => this.setState({{ iris: false }}), irisBtn: seg(st.iris), plainBtn: seg(!st.iris) }};
  }}
}}
</script>
</body>
</html>
'''
open('lumora/project/FontRound2.dc.html','w').write(html)
