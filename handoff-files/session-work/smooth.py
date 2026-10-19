import re
p='index.html'; s=open(p).read()
GLIDE=['zoom','panX','panY','hue','sat','con','glow','trail','echo','echoRot','rgb','pix','vig','scan','ov']
def rep(a,b,count=1):
    global s
    n=s.count(a); assert n==count, (a[:60], n); s=s.replace(a,b)
n=s.count('tb*spd'); assert n==55; s=s.replace('tb*spd','spd')
rep('uniform vec2 uRes; uniform float uBeat; uniform float uPulse; uniform float uMix;\n',
    'uniform vec2 uRes; uniform float uBeat; uniform float uPulse; uniform float uMix;\nuniform float uB0; uniform float uB1; uniform float uB2;\n')
rep('vec3 scene(int m, vec2 uv, float tb, float spd, float pu, mat3 P){',
    '// tb = this scene\'s own beat clock, spd = its speed-scaled phase (both advance smoothly, never jump)\nvec3 scene(int m, vec2 uv, float tb, float spd, float pu, mat3 P){')
rep('c0=scene(uM0,uv/(1.+uK0*pu*.18),uBeat,uS0,pu,uP0)','c0=scene(uM0,uv/(1.+uK0*pu*.18),uB0,uS0,pu,uP0)')
rep('c1=scene(uM1,uv/(1.+uK1*pu*.18),uBeat,uS1,pu,uP1)','c1=scene(uM1,uv/(1.+uK1*pu*.18),uB1,uS1,pu,uP1)')
rep('scene(uM2,uv/(1.+uK2*pu*.18),uBeat,uS2,pu,uP2)','scene(uM2,uv/(1.+uK2*pu*.18),uB2,uS2,pu,uP2)')
rep("const A=mk(SCENE_FS,['uRes','uBeat',","const A=mk(SCENE_FS,['uRes','uBeat','uB0','uB1','uB2',")
rep('gl.uniform1f(a.uBeat,u.beat);','gl.uniform1f(a.uBeat,u.beat); gl.uniform1f(a.uB0,u.b0); gl.uniform1f(a.uB1,u.b1); gl.uniform1f(a.uB2,u.b2);')
rep('  col=mix(col,vec3(1.),uWhite);\n  col*=1.-uBlack;',
    '  col=mix(col,vec3(1.),uWhite);\n  col+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.; // dither: no banding in dark gradients\n  col*=1.-uBlack;')
rep("const blankU=()=>({beat:0,pulse:0,mix:1,","const blankU=()=>({beat:0,b0:0,b1:0,b2:0,r0:0,r1:0,r2:0,pulse:0,mix:1,")
rep("if(!last.frozen) u.beat+=(epoch()-last.sentAt)*last.bpm/60000; draw(u);",
    "if(!last.frozen){ const d=clamp((epoch()-last.sentAt)*last.bpm/60000,0,.5); u.beat+=d; u.b0+=d; u.b1+=d; u.b2+=d; u.s0+=d*u.r0; u.s1+=d*u.r1; u.s2+=d*u.r2; } draw(u);")
rep("let lastDot=-1, lastRb=null, rotAcc=0, hueAcc=0;",
"""let lastDot=-1, lastRb=null, rotAcc=0, hueAcc=0, lastT=null;
// Smoothness: every scene runs on its own clock (so speed changes and clock resyncs never make it jump),
// continuous settings glide instead of snapping, and palette changes blend over PAL_MS.
const clocks=new Map(), G={}, GLIDE=%s;
let speedV=S.speed, brightV=S.bright, palMode=S.pal, palFrom=null, palAt=0;
const PAL_MS=700, smooth01=x=>x*x*(3-2*x);
const refKey=r=>r.b+':'+r.i;""" % str(GLIDE))
rep("""  const dB=lastRb===null?0:clamp(rb-lastRb,-1,1); lastRb=rb;""",
"""  const dB=lastRb===null?0:clamp(rb-lastRb,-1,1); lastRb=rb;
  const dt=lastT===null?0:clamp((t-lastT)/1000,0,.1); lastT=t; const k60=dt*60;
  const ease=tc=>1-Math.exp(-dt/tc), decay=(v,f)=>v*Math.pow(f,k60), approach=(v,to,f)=>v+(to-v)*(1-Math.pow(1-f,k60));
  const gk=ease(.12); for(const key of GLIDE) G[key]=G[key]===undefined?F[key]:G[key]+(F[key]-G[key])*gk;
  speedV+=(S.speed-speedV)*ease(.25); brightV+=(S.bright-brightV)*gk;""")
rep("  kick*=.9; noteFlash*=.88; whiteFlash*=.85;",
    "  kick=decay(kick,.9); noteFlash=decay(noteFlash,.88); whiteFlash=decay(whiteFlash,.85);")
rep("  fx.blackV+=((fx.black?1:0)-fx.blackV)*(S.blackFade==='slow'?.03:.15);\n  textV+=((T.on?1:0)-textV)*.12;",
    "  fx.blackV=approach(fx.blackV,fx.black?1:0,S.blackFade==='slow'?.03:.15);\n  textV=approach(textV,T.on?1:0,.12);")
rep("""  const mix=prev&&fadeLen>0?clamp((beat-fadeStart)/fadeLen,0,1):1;
  const s1=sceneOf(cur), s0=prev?sceneOf(prev):s1;
  const s2=(BANKS[F.ovB]&&BANKS[F.ovB].scenes[F.ovI])||s1;
  const pk=sc=>S.pal==='scene'?sc[2]:S.pal;""",
"""  const mix=prev&&fadeLen>0?clamp((beat-fadeStart)/fadeLen,0,1):1, mixE=smooth01(mix);
  const s1=sceneOf(cur), s0=prev?sceneOf(prev):s1;
  const ovRef=okScene({b:F.ovB,i:F.ovI})?{b:F.ovB,i:F.ovI}:cur, s2=sceneOf(ovRef);
  const refs=[prev||cur,cur,ovRef], rates=[s0[3]*speedV,s1[3]*speedV,s2[3]*speedV], adv=clamp(dB,0,.5), seen=new Set();
  const clk=refs.map((r,n)=>{ const k=refKey(r); let c=clocks.get(k);
    if(!c){ c={lb:((rb%64)+64)%64,ph:0}; c.ph=c.lb*rates[n]; clocks.set(k,c); }
    if(!seen.has(k)){ seen.add(k); c.lb+=adv; c.ph+=adv*rates[n]; } return c; });
  for(const k of clocks.keys()) if(!seen.has(k)) clocks.delete(k);
  if(S.pal!==palMode){ palFrom=palMode; palMode=S.pal; palAt=t; }
  const pe=palFrom===null?1:smooth01(clamp((t-palAt)/PAL_MS,0,1)); if(pe>=1) palFrom=null;
  const pkey=(mode,sc)=>mode==='scene'?sc[2]:mode;
  const pmat=sc=>{ const a=palMat(pkey(palMode,sc)); if(palFrom===null) return a;
    const b=palMat(pkey(palFrom,sc)); return a.map((v,i)=>b[i]+(v-b[i])*pe); };""")
i0=s.index("  const u={beat:rb,pulse,mix,"); i1=s.index("  if(draw) draw(u);",i0)
u=s[i0:i1]
for a,b in [("const u={beat:rb,pulse,mix,","const u={beat:rb,b0:clk[0].lb,b1:clk[1].lb,b2:clk[2].lb,r0:rates[0],r1:rates[1],r2:rates[2],pulse,mix:mixE,"),
 ("p0:palMat(pk(s0)),p1:palMat(pk(s1)),p2:palMat(pk(s2))","p0:pmat(s0),p1:pmat(s1),p2:pmat(s2)"),
 ("s0:s0[3]*S.speed,s1:s1[3]*S.speed,s2:s2[3]*S.speed","s0:clk[0].ph,s1:clk[1].ph,s2:clk[2].ph"),
 ("bright:S.bright","bright:brightV")]:
    assert a in u, a; u=u.replace(a,b)
for k in GLIDE: u=re.sub(r'F\.'+k+r'\b','G.'+k,u)
s=s[:i0]+u+s[i1:]
open(p,'w').write(s)
print('ok')
