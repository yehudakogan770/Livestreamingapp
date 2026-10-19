import re,glob,sys
KEEP={'mp4':'MP4','mov':'MOV','rtmp':'RTMP','srt':'SRT','ndi':'NDI','usb':'USB','hdmi':'HDMI','lut':'LUT','eq':'EQ','3d':'3D','pin':'PIN','qr':'QR','url':'URL','pgm':'PGM','pvw':'PVW','fps':'FPS','pc':'PC','tv':'TV','cpu':'CPU','gpu':'GPU','ram':'RAM','ok':'OK','lumora':'Lumora','pesukim':'Pesukim','youtube':'YouTube','facebook':'Facebook','chrome':'Chrome','windows':'Windows','ipad':'iPad','iphone':'iPhone','webm':'WebM','png':'PNG','svg':'SVG','pdf':'PDF','powerpoint':'PowerPoint','i':'I','f1':'F1','f2':'F2','f3':'F3','led':'LED','hd':'HD','4k':'4K','dj':'DJ','ptz':'PTZ','id':'ID','wi-fi':'Wi-Fi','live':'Live','back':'Back','screen':'Screen','monitor':'Monitor'}
SCREENWORDS={'live screen':'Live Screen','back screen':'Back Screen'}
def sentence(t):
    t=t.replace('&amp;','&')
    w=t.lower()
    for k,v in SCREENWORDS.items(): w=w.replace(k,v)
    out=[]
    for tok in re.split(r'(\W+)',w):
        low=tok.lower()
        if low in KEEP and low not in ('live','back','screen','monitor'): out.append(KEEP[low])
        else: out.append(tok)
    w=''.join(out)
    w=w.replace(' · ',' – ')
    w=w[:1].upper()+w[1:]
    return w.replace('&','&amp;')
def fix_label(m):
    style,text=m.group(1),m.group(2)
    if not re.search(r'[A-Z]{3}',text) or re.search(r'[a-z]',re.sub(r'\{\{[^}]*\}\}','',text)): return m.group(0)
    if '{{' in text: 
        text=re.sub(r'([^{}]+)(?=\{\{|$)',lambda x: sentence(x.group(1)) if re.search('[A-Z]{2}',x.group(1)) else x.group(1),text)
    else: text=sentence(text)
    style=re.sub(r'letter-spacing: 0\.\d+em;\s*','',style)
    style=re.sub(r'font-size: (9|10|11)px;','font-size: 12px;',style)
    style=style.replace('font-weight: 700;','font-weight: 600;')
    style=re.sub(r'color: #(8e9096|a9abb0);','color: #b4b8bf;',style)
    style=style.replace('text-transform: uppercase;','')
    return f'<span style="{style}">{text}</span>'
def calm_weights(s):
    def fw(m):
        st=m.group(0)
        fs=re.search(r'font-size: (\d+)px',st)
        if fs and int(fs.group(1))>=22: return st
        return st.replace('font-weight: 700','font-weight: 600').replace('font-weight: 800','font-weight: 600')
    s=re.sub(r'style="[^"]*font-weight: (700|800)[^"]*"',fw,s)
    s=re.sub(r'`[^`]*font-weight: (700|800)[^`]*`',fw,s)
    return s
for f in sys.argv[1:]:
    s=open(f).read()
    body,script=s.split('<script type="text/x-dc"',1)
    body=re.sub(r'<span style="([^"]*letter-spacing: 0\.\d+em[^"]*)">([^<]*)</span>',fix_label,body)
    # dialog headers: smaller title, drop helper sentence, slimmer bar
    body=re.sub(r'(<span style="font-size: 20px; font-weight: 600;">[^<]*</span>)\n(\s*)<span style="font-size: 13px; color: #8e9096;">[^<]*</span>',r'\1',body)
    body=body.replace('<span style="font-size: 20px; font-weight: 600;">','<span style="font-size: 16px; font-weight: 600;">')
    body=re.sub(r'<div style="height: 64px; flex-shrink: 0; display: flex; align-items: center;','<div style="height: 52px; flex-shrink: 0; display: flex; align-items: center;',body)
    s=body+'<script type="text/x-dc"'+script
    s=calm_weights(s)
    s=s.replace('#1d3b40','#243039').replace('#dff4f6','#ffffff')
    open(f,'w').write(s)
print('calmed',len(sys.argv)-1)
