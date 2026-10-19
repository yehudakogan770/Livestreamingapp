import re
SC=lambda k: f'<dc-import name="Scene" kind="{k}" hint-size="100%,100%"></dc-import>'
BOX=lambda k: f'<div style="position: absolute; inset: 0;">{SC(k)}</div>'
miss=[]
def ed(f,a,b,regex=False,count=1):
    s=open(f).read()
    if regex:
        n=re.subn(a,b,s,count=count,flags=re.S)
        if n[1]==0: miss.append((f,a[:70])); return
        s=n[0]
    else:
        if a not in s: miss.append((f,a[:70])); return
        s=s.replace(a,b,count)
    open(f,'w').write(s)

# Pesukim
ed('Pesukim.dc.html','<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding-bottom: 120px;"><span style="font-size: 22px; color: rgba(255,255,255,0.35);">Camera 1 · stage</span></div>',BOX('stage'))

# Slideshow
ed('Slideshow.dc.html','<div style="{{pvCam}}">\n','<div style="{{pvCam}}">\n            '+BOX('stage')+'\n')
ed('Slideshow.dc.html','<span style="position: absolute; left: 12px; bottom: 10px; font-size: 11px; color: rgba(255,255,255,0.55);">{{camName}} · live camera</span>','<span style="position: absolute; left: 12px; bottom: 10px; height: 18px; padding: 0 6px; border-radius: 3px; background: rgba(10,11,13,0.7); font-size: 11px; line-height: 18px; color: #ffffff;">{{camName}}</span>')
ed('Slideshow.dc.html','<div style="position: absolute; inset: 0; background: #403143; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">','<div style="position: absolute; inset: 0;">'+SC('tribute')+'</div>\n          <div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 16px; background: rgba(8,9,11,0.72); display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">')
ed('Slideshow.dc.html','<span style="font-size: 24px; font-weight: 600; color: rgba(255,255,255,0.85);">▶ {{videoName}}</span>','<span style="font-size: 16px; font-weight: 600; color: #ffffff;">{{videoName}}</span>')
ed('Slideshow.dc.html','<div style="{{it.thumb}}">{{it.thumbLabel}}</div>','<div style="{{it.thumb}}"><dc-import name="Scene" kind="{{it.scene}}" hint-size="100%,100%"></dc-import><span style="position: absolute; right: 2px; bottom: 2px; min-width: 12px; height: 12px; padding: 0 2px; border-radius: 2px; background: rgba(10,11,13,0.75); font-size: 8px; line-height: 12px; text-align: center; color: #ffffff;">{{it.thumbLabel}}</span></div>')
ed('Slideshow.dc.html',"        thumb: `width: 64px; height: 36px; flex-shrink: 0; border-radius: 3px;","        scene: vid ? 'tribute' : 'slides',\n        thumb: `position: relative; overflow: hidden; width: 64px; height: 36px; flex-shrink: 0; border-radius: 3px;")

# InputSettings
ed('InputSettings.dc.html','<div style="{{afterPane}}"><span style="font-size: 18px; color: rgba(255,255,255,0.6);">[Camera 1 picture]</span></div>','<div style="{{afterPane}}"><div style="position: absolute; inset: 0; filter: saturate(1.25) contrast(1.08) brightness(1.05) sepia(0.12);">'+SC('stage')+'</div></div>')
ed('InputSettings.dc.html','<div style="{{beforePane}}"><span style="font-size: 18px; color: rgba(255,255,255,0.5); white-space: nowrap;">[Camera 1 picture]</span></div>','<div style="{{beforePane}}"><div style="position: absolute; inset: 0; filter: saturate(0.8) brightness(0.88);">'+SC('stage')+'</div></div>')
ed('InputSettings.dc.html','<div style="{{l.thumb}}"></div>','<div style="{{l.thumb}}"><div style="position: absolute; inset: 0;">'+SC('stage')+'</div><span style="{{l.tint}}"></span></div>')
ed('InputSettings.dc.html',"        thumb: `height: 44px; border-radius: 4px; background-color: ${c};` })),","        thumb: `position: relative; overflow: hidden; height: 44px; border-radius: 4px; background-color: ${c};`, tint: `position: absolute; inset: 0; background: ${c}; mix-blend-mode: color; opacity: 0.55;` })),")

# GreenScreen: background layer -> picture, person stays keyed silhouette
ed('GreenScreen.dc.html',r'<sc-if value="\{\{c\.isBg\}\}" hint-placeholder-val="\{\{false\}\}">.*?</sc-if>','<sc-if value="{{c.isBg}}" hint-placeholder-val="{{false}}">\n              '+BOX('stage')+'\n              <span style="position: absolute; left: 12px; bottom: 10px; height: 18px; padding: 0 6px; border-radius: 3px; background: rgba(10,11,13,0.7); font-size: 11px; line-height: 18px; color: #ffffff;">{{c.label}}</span>\n            </sc-if>',regex=True)
ed('GreenScreen.dc.html','<div style="display: flex; flex-direction: column; gap: 4px; width: 120px;"><div style="{{s.thumb}}"></div>','<div style="display: flex; flex-direction: column; gap: 4px; width: 120px;"><div style="{{s.thumb}}"><dc-import name="Scene" kind="{{s.scene}}" hint-size="100%,100%"></dc-import></div>')
ed('GreenScreen.dc.html',r"saved: \[\['Studio desk', '#27403f'\], \['Stage backdrop', '#3b3446'\], \['Virtual set', '#2c3848'\], \['\[Your scene\]', '#473a2c'\]\]\.map\(\(\[name, c\]\) => \(\{ name, thumb: `",
   "saved: [['Studio desk', '#27403f', 'split'], ['Stage backdrop', '#3b3446', 'stage'], ['Virtual set', '#2c3848', 'side'], ['[Your scene]', '#473a2c', 'opening']].map(([name, c, scene]) => ({ name, scene, thumb: `position: relative; overflow: hidden; ",regex=True)

# AddInput
s=open('AddInput.dc.html').read()
i=s.find('<span style="font-size: 14px; color: rgba(255,255,255,0.55);">[Camera picture]</span>')
if i>0:
    s=s.replace('<span style="font-size: 14px; color: rgba(255,255,255,0.55);">[Camera picture]</span>',BOX('stage'),1); open('AddInput.dc.html','w').write(s)
else: miss.append(('AddInput','camera picture'))
