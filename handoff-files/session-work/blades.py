import math,sys
def P(r,a): a=math.radians(a); return (24+r*math.cos(a),24+r*math.sin(a))
def f(p): return f'{p[0]:.2f} {p[1]:.2f}'
def blades(R=20, r=11.5, gap=10, twist=22, dot=5.2, C=('#4fb3bf','#fff','#fff'), O=('1','0.75','0.45'), red='#e5483c'):
    out=''
    for i in range(3):
        a=-90+gap/2+120*i; b=-90-gap/2+120*(i+1)
        out+=f'<path d="M{f(P(R,a))} A{R} {R} 0 0 1 {f(P(R,b))} L{f(P(r,b+twist))} A{r} {r} 0 0 0 {f(P(r,a+twist))} Z" fill="{C[i]}" opacity="{O[i]}"></path>'
    return out+f'<circle cx="24" cy="24" r="{dot}" fill="{red}"></circle>'
if __name__=='__main__':
    vs=[dict(), dict(r=10,twist=30,gap=8), dict(r=12,twist=0,gap=12), dict(R=21,r=10.5,twist=40,gap=9), dict(R=21,r=11,twist=18,gap=11,dot=5.8)]
    h='<body style="margin:0;background:#101216;display:flex;gap:30px;padding:30px">'+''.join(f'<div style="display:flex;flex-direction:column;gap:20px;align-items:center"><svg width="220" height="220" viewBox="0 0 48 48">{blades(**v)}</svg><svg width="24" height="24" viewBox="0 0 48 48">{blades(**v)}</svg><span style="color:#aaa;font:12px sans-serif">{i}</span></div>' for i,v in enumerate(vs))+'</body>'
    open('render/blades.html','w').write(h)
