import re,sys
# (file, selector, mode) mode: 'label' -> sentence case, normal tracking, 12px; 'badge' -> keep caps, tracking 0.03em
jobs = [
 ('components/ScreenSelector.css','.selector__label','label'),
 ('components/TitleBar.css','.titlebar__name','brand'),
 ('auth/Gate.css','.gate__tag','label'),
 ('views/OverlayBar.css','.ovbar__label','label'),
 ('views/ControlView.css','.bus__key small','small'),
 ('views/ControlView.css','.switch__label','label'),
 ('views/ControlView.css','.tbar__labels','small'),
 ('views/ControlView.css','.bar__label','label'),
 ('views/ControlView.css','.field__label','label'),
 ('views/ControlView.css','.addinput__group','label'),
 ('views/ControlView.css','.strip__name--mix','label'),
 ('views/MultiviewView.css','.mv__head','brand'),
 ('views/ControlView.css','.switch__head .phead__meta','badge'),
 ('views/ControlView.css','.mon__tally','badge'),
 ('views/ControlView.css','.tile__badge','badge'),
 ('views/ControlView.css','.switch__take','badge'),
 ('views/ControlView.css','.switch__cut','badge'),
 ('views/ControlView.css','.btn--panic','badge'),
 ('views/ControlView.css','.bus__label','badge'),
 ('views/MultiviewView.css','.mv__tally','badge'),
 ('components/ScreenSelector.css','.selector__badge','badge'),
 ('components/MonitorScreen.css','.mscreen__tag','badge'),
 ('broadcast/broadcast.css','.bc-btn','badge'),
]
for f,sel,mode in jobs:
    s=open(f).read()
    i=s.find('\n'+sel+' {')
    if i<0: print('MISSING',f,sel); continue
    j=s.find('}',i)
    body=s[i:j]
    nb=body
    if mode in('label','small','brand'):
        nb=re.sub(r'\n\s*text-transform: uppercase;','',nb)
        nb=re.sub(r'\n\s*letter-spacing: [^;]+;','',nb)
        if mode=='label':
            nb=re.sub(r'font-size: [^;]+;','font-size: 12px;',nb)
            nb=re.sub(r'font-weight: 700;','font-weight: 600;',nb)
        if mode=='brand':
            nb=re.sub(r'font-size: 12px;','font-size: 13px;',nb)
            nb=re.sub(r'font-weight: 700;','font-weight: 600;',nb)
    else:
        nb=re.sub(r'letter-spacing: 0\.\d+em;','letter-spacing: 0.03em;',nb)
    s=s[:i]+nb+s[j:]
    open(f,'w').write(s)
    print('ok',sel)
