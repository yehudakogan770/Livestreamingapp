import sys, re
sys.path.insert(0, '.')
from blades import blades
G = dict(R=21, r=10.5, twist=36, gap=9, dot=5.6)
TEAL, TEAL_D, RED = '#4fb3bf', '#1f6f79', '#e5483c'
def mark(size, fg='#ffffff', ac=TEAL, O=('1','0.8','0.5'), C=None, extra=''):
    C = C or (ac, fg, fg)
    return f'<svg width="{size}" height="{size}" viewBox="0 0 48 48" aria-hidden="true" style="flex-shrink: 0;{extra}">{blades(C=C, O=O, **G)}</svg>'
WORD = "font-family: 'Sora', 'Segoe UI', sans-serif; font-weight: 600; letter-spacing: -0.015em;"
FONT = '<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600&amp;display=swap" rel="stylesheet">'
if __name__ == '__main__':
    polish = open('lumora/project/Pesukim.dc.html').read()
    polish = polish[polish.index('/* lumora-polish:start */'):polish.index('/* lumora-polish:end */')+len('/* lumora-polish:end */')]
    ICON = "background: linear-gradient(180deg, #2b3039 0%, #16181d 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 6px 16px rgba(0,0,0,0.5); border: 1px solid #0b0c0f;"
    anim = mark(150, C=('{{an.c0}}','{{an.c1}}','{{an.c2}}'), O=('{{an.o0}}','{{an.o1}}','{{an.o2}}'))
    sw = [(TEAL,'Lumora teal','#4FB3BF','Lit blade, buttons, focus'),(TEAL_D,'Deep teal','#1F6F79','On light backgrounds'),(RED,'On-air red','#E5483C','The light, never anything else'),('#15171b','Graphite','#15171B','Backgrounds'),('#ffffff','White','#FFFFFF','Blades, text')]
    swatches = ''.join(f'<div style="display: flex; align-items: center; gap: 10px;"><span style="width: 34px; height: 34px; border-radius: 6px; background: {c}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);"></span><span style="display: flex; flex-direction: column; gap: 1px;"><span style="font-size: 13px; font-weight: 600; color: #ffffff;">{n} <span style="font-family: Consolas, monospace; font-weight: 400; font-size: 11px; color: #8e9096;">{h}</span></span><span style="font-size: 11px; color: #8e9096;">{u}</span></span></div>' for c,n,h,u in sw)
    sizes = ''.join(f'<span style="display: flex; flex-direction: column; align-items: center; gap: 6px;">{mark(s)}<span style="font-family: Consolas, monospace; font-size: 10px; color: #8e9096;">{s}</span></span>' for s in [64, 40, 24, 16])
    html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lumora — Brand</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{FONT}
<style>
{polish}

button{{cursor:pointer;background-image:none;box-shadow:none}}
body{{margin:0;background:#15171b;font-family:'Segoe UI',system-ui,sans-serif;color:#e4e5e7}}
button{{font-family:inherit}}
</style>
</helmet>
<div style="width: 1440px; height: 900px; box-sizing: border-box; background: #15171b; padding: 32px 40px; display: grid; grid-template-columns: 1fr 420px; grid-template-rows: auto 1fr 280px; gap: 20px; font-family: 'Segoe UI', system-ui, sans-serif; color: #e4e5e7; overflow: hidden;">
  <div style="grid-column: 1 / 3; display: flex; align-items: flex-end; gap: 16px;">
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 24px; font-weight: 600; color: #ffffff;">Lumora brand</span>
      <span style="font-size: 13px; color: #8e9096;">Iris blades · title-case wordmark in Sora SemiBold · teal accent. Three blades for the three screens; the lit blade is the screen you control; the red centre is on air.</span>
    </div>
  </div>

  <div style="position: relative; border-radius: 12px; border: 1px solid #262a32; background: radial-gradient(circle at 50% 40%, #1c2738 0%, #0a0c10 72%); display: flex; align-items: center; justify-content: center; gap: 34px;">
    {mark(170)}
    <span style="{WORD} font-size: 104px; color: #ffffff;">Lumora</span>
    <span style="position: absolute; left: 16px; top: 14px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #6f737b;">PRIMARY · ON DARK</span>
  </div>

  <div style="display: flex; flex-direction: column; gap: 16px; min-height: 0;">
    <div style="height: 140px; flex-shrink: 0; position: relative; border-radius: 12px; background: #f5f5f2; display: flex; align-items: center; justify-content: center; gap: 14px;">
      {mark(60, fg='#14161a', ac=TEAL_D, O=('1','0.85','0.45'))}<span style="{WORD} font-size: 42px; color: #14161a;">Lumora</span>
      <span style="position: absolute; left: 14px; top: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #8e9096;">ON LIGHT</span>
    </div>
    <div style="flex-grow: 1; border-radius: 12px; background: #101216; border: 1px solid #262a32; padding: 16px; display: flex; flex-direction: column; gap: 14px;">
      <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #6f737b;">APP ICON &amp; SIZES</span>
      <div style="display: flex; align-items: flex-end; gap: 18px;">
        <span style="width: 96px; height: 96px; border-radius: 22px; {ICON} display: flex; align-items: center; justify-content: center;">{mark(66)}</span>
        <span style="width: 48px; height: 48px; border-radius: 11px; {ICON} display: flex; align-items: center; justify-content: center;">{mark(33)}</span>
        <span style="width: 28px; height: 28px; border-radius: 7px; {ICON} display: flex; align-items: center; justify-content: center;">{mark(20)}</span>
      </div>
      <div style="display: flex; align-items: flex-end; gap: 20px;">{sizes}</div>
    </div>
  </div>

  <div style="position: relative; border-radius: 12px; border: 1px solid #262a32; background: #0c0e12; display: flex; align-items: center; justify-content: center; gap: 30px;">
    {anim}
    <span style="display: flex; flex-direction: column; gap: 10px; max-width: 360px;">
      <span style="{WORD} font-size: 26px; color: #ffffff;">{{{{an.label}}}}</span>
      <span style="font-size: 13px; line-height: 1.5; color: #a9abb0;">Startup animation: the lit blade steps Live → Back → Monitor, then settles on Live. In the app, the lit blade follows the screen you are controlling (F1 Live, F2 Back, F3 Monitor).</span>
    </span>
    <span style="position: absolute; left: 16px; top: 14px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #6f737b;">MOTION</span>
  </div>

  <div style="border-radius: 12px; border: 1px solid #262a32; background: #101216; padding: 16px; display: flex; flex-direction: column; gap: 10px;">
    <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #6f737b;">COLOURS</span>
    {swatches}
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":900}}}}'>
class Component extends DCLogic {{
  componentDidMount() {{ this._t = setInterval(() => this.setState((s) => ({{ frame: s.frame + 1 }})), 800); }}
  componentWillUnmount() {{ clearInterval(this._t); }}
  constructor(props) {{ super(props); this.state = {{ frame: 0 }}; }}
  renderVals() {{
    const a = this.state.frame % 3;
    const L = ['Live screen', 'Back screen', 'Monitor'];
    const c = (i) => i === a ? '{TEAL}' : '#ffffff', o = (i) => i === a ? '1' : String([0.8, 0.5, 0.8][(i - a + 3) % 3]);
    return {{ an: {{ c0: c(0), c1: c(1), c2: c(2), o0: o(0), o1: o(1), o2: o(2), label: L[a] }} }};
  }}
}}
</script>
</body>
</html>
'''
    open('lumora/project/Brand.dc.html', 'w').write(html)
